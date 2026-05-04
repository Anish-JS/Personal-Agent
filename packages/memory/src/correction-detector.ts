/**
 * Feedback Loop 2 — Correction loop
 *   User says "shorter" / "different tone" / "no actually" →
 *   Haiku extracts preference → stored immediately as high-confidence memory
 *
 * Feedback Loop 3 — Implicit behavior loop
 *   Haiku scans conversation for behavioral overrides →
 *   Counted across sessions → stored as preference after threshold (3 occurrences)
 */

import Anthropic from '@anthropic-ai/sdk';
import { db } from './db.js';
import { embed, toVectorLiteral } from './embedding.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Signals that indicate an explicit correction (Loop 2)
const CORRECTION_PATTERNS = [
  /\bshorter\b/i,
  /\blonger\b/i,
  /\bdifferent tone\b/i,
  /\bdon'?t say\b/i,
  /\bno,?\s+actually\b/i,
  /\bthat'?s wrong\b/i,
  /\bredo\b/i,
  /\brephrase\b/i,
  /\bnot like that\b/i,
  /\bmore concise\b/i,
  /\btoo formal\b/i,
  /\btoo casual\b/i,
  /\bstop (saying|using|doing)\b/i,
  /\bplease (don'?t|avoid)\b/i,
];

// ─────────────────────────────────────────────
// Loop 2: Explicit correction detection
// ─────────────────────────────────────────────

export async function detectCorrectionSignals(
  userMessage: string,
  sessionId: string
): Promise<void> {
  const isCorrecting = CORRECTION_PATTERNS.some((re) => re.test(userMessage));
  if (!isCorrecting) return;

  // Mark session as corrected for quality score
  await db.query(`UPDATE sessions SET was_corrected = TRUE WHERE id = $1`, [sessionId]);

  // Ask Haiku to extract the concrete preference
  const extraction = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [
      {
        role: 'user',
        content: `The user sent a correction message: "${userMessage}"

Extract a single durable style preference from this correction.
Return JSON only: { "preference": "string describing the preference" }
If no clear durable preference, return: { "preference": null }`,
      },
    ],
  });

  const raw = extraction.content[0].type === 'text' ? extraction.content[0].text : '{}';
  let pref: string | null = null;
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) as {
      preference: string | null;
    };
    pref = parsed.preference;
  } catch {
    return;
  }

  if (!pref) return;

  // Store immediately with high confidence — injected into next session prompt
  try {
    const embedding = await embed(pref);
    await db.query(
      `INSERT INTO memories (text, embedding, source_id, category, confidence)
       VALUES ($1, $2::vector, $3, 'correction', 1.0)`,
      [pref, toVectorLiteral(embedding), sessionId]
    );
    console.info('correction loop: stored new preference', { pref });
  } catch (err) {
    console.warn('correction loop: failed to store preference', { err, pref });
  }
}

// ─────────────────────────────────────────────
// Loop 3: Implicit behavioral pattern detection
// ─────────────────────────────────────────────

// Minimum recurrences before a pattern is promoted to a stored preference
const PATTERN_THRESHOLD = 3;

export async function detectImplicitPatterns(
  userMessage: string,
  agentReply: string,
  sessionId: string
): Promise<void> {
  // Ask Haiku to identify behavioral override signals in the conversation
  const analysis = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: `Analyze this conversation for implicit behavioral patterns — things the user does that override or adjust the agent's suggestions (e.g., changing a suggested time, declining a proposed format, choosing a different tool than suggested).

User: ${userMessage}
Agent: ${agentReply}

Return JSON only:
{ "pattern": "short description of behavioral signal", "has_pattern": true/false }

Only return has_pattern: true if a concrete behavioral override is present.`,
      },
    ],
  });

  const raw = analysis.content[0].type === 'text' ? analysis.content[0].text : '{}';
  let signal: { pattern: string | null; has_pattern: boolean } = {
    pattern: null,
    has_pattern: false,
  };
  try {
    signal = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return;
  }

  if (!signal.has_pattern || !signal.pattern) return;

  // Count how many times a semantically similar pattern has been observed
  const embedding = await embed(signal.pattern);
  const similar = await db.query(
    `SELECT id, text FROM memories
     WHERE category = 'pattern'
     AND embedding <=> $1::vector < 0.25
     ORDER BY embedding <=> $1::vector
     LIMIT 10`,
    [toVectorLiteral(embedding)]
  );

  const occurrences = (similar.rows as Array<{ id: number; text: string }>).length;

  if (occurrences === 0) {
    // First sighting — store as an unconfirmed pattern candidate
    await db.query(
      `INSERT INTO memories (text, embedding, source_id, category, confidence)
       VALUES ($1, $2::vector, $3, 'pattern', 0.3)`,
      [signal.pattern, toVectorLiteral(embedding), sessionId]
    );
  } else {
    // Update confidence on existing cluster
    const newConfidence = Math.min(1.0, 0.3 + occurrences * 0.2);
    await db.query(
      `UPDATE memories SET confidence = $1 WHERE id = $2`,
      [newConfidence, (similar.rows as Array<{ id: number }>)[0].id]
    );

    // Threshold reached → promote to high-confidence preference
    if (occurrences + 1 >= PATTERN_THRESHOLD) {
      const preference = `Implicit preference: ${signal.pattern}`;
      const prefEmbedding = await embed(preference);

      // Check not already stored as preference to avoid duplicates
      const existing = await db.query(
        `SELECT id FROM memories
         WHERE category = 'preference' AND embedding <=> $1::vector < 0.15
         LIMIT 1`,
        [toVectorLiteral(prefEmbedding)]
      );

      if (!(existing.rows as unknown[]).length) {
        await db.query(
          `INSERT INTO memories (text, embedding, source_id, category, confidence)
           VALUES ($1, $2::vector, $3, 'preference', 0.9)`,
          [preference, toVectorLiteral(prefEmbedding), sessionId]
        );
        console.info('implicit loop: pattern promoted to preference', { preference });
      }
    }
  }
}

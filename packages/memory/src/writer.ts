import Anthropic from '@anthropic-ai/sdk';
import { db } from './db.js';
import { embed } from './embedding.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function processSessionAsync(
  sessionId: string,
  userMessage: string,
  agentReply: string
): Promise<void> {
  // 1. Save to episodic layer
  await db.query(
    `INSERT INTO sessions (id, user_message, agent_reply) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [sessionId, userMessage, agentReply]
  );

  // 2. Extract facts using Haiku (cheap — ~$0.001 per session)
  const extraction = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `Extract factual statements and preferences from this conversation.
Return JSON only: { "facts": ["string"], "preferences": ["string"] }
Only include durable facts — not task-specific ephemeral details.

User: ${userMessage}
Assistant: ${agentReply}`,
      },
    ],
  });

  const raw = extraction.content[0].type === 'text' ? extraction.content[0].text : '{}';
  let parsed: { facts?: string[]; preferences?: string[] } = {};
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    // Malformed response — skip extraction this session
  }

  // 3. Embed and store extracted facts
  const facts = parsed.facts ?? [];
  const preferences = parsed.preferences ?? [];

  for (const fact of facts) {
    const embedding = await embed(fact);
    await db.query(
      `INSERT INTO memories (text, embedding, source_id, category) VALUES ($1, $2, $3, 'fact')`,
      [fact, JSON.stringify(embedding), sessionId]
    );
  }

  for (const pref of preferences) {
    const embedding = await embed(pref);
    await db.query(
      `INSERT INTO memories (text, embedding, source_id, category) VALUES ($1, $2, $3, 'preference')`,
      [pref, JSON.stringify(embedding), sessionId]
    );
  }

  // 4. Update rolling style signals
  await updateStyleSignals(userMessage);
}

async function updateStyleSignals(userMessage: string): Promise<void> {
  const msgLen = userMessage.length;

  // Exponential moving average for message length (α = 0.1)
  await db.query(
    `UPDATE working_style SET
       avg_message_length = COALESCE(avg_message_length, $1) * 0.9 + $1 * 0.1,
       updated_at = now()
     WHERE id = 1`,
    [msgLen]
  );

  // Track hour-of-day activity for peak hours inference
  const hour = new Date().getHours();
  await db.query(
    `INSERT INTO session_hours (hour, count) VALUES ($1, 1)
     ON CONFLICT (hour) DO UPDATE SET count = session_hours.count + 1`,
    [hour]
  );
}

// Called by Slack reaction_added handler to record thumbs feedback
export async function recordFeedback(payload: {
  message_ts: string;
  reaction: '+1' | '-1';
}): Promise<void> {
  const score = payload.reaction === '+1' ? 1 : -1;
  await db.query(
    `UPDATE sessions SET feedback = $1 WHERE id = $2`,
    [score, payload.message_ts]
  );
}

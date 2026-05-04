#!/usr/bin/env tsx
/**
 * Eval runner — executes golden test cases against the Managed Agent.
 * Exits with code 1 on any failure (blocks CI).
 *
 * Run: pnpm --filter evals run eval
 */

import Anthropic from '@anthropic-ai/sdk';
import { goldenSet, type EvalCase } from './golden-set.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BETA_HEADER = { 'anthropic-beta': 'managed-agents-2026-04-01' };
const AGENT_ID = process.env.AGENT_ID;

// Max poll attempts: 30 × 10 s cap ≈ 5 minutes per case
const MAX_POLL_ATTEMPTS = 30;

if (!AGENT_ID) {
  console.error('AGENT_ID environment variable is required');
  process.exit(1);
}

interface EvalResult {
  session_id?: string;
  output_text: string;
  tools_called: string[];
}

async function runEvalSession(input: string): Promise<EvalResult> {
  const session = await (client.beta as any).agents.sessions.create(
    {
      agent_id: AGENT_ID,
      messages: [{ role: 'user', content: input }],
    },
    { headers: BETA_HEADER }
  );

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(Math.min(1000 * 2 ** attempt, 10_000));

    const result = await (client.beta as any).agents.sessions.retrieve(session.id, {
      headers: BETA_HEADER,
    });

    if (result.status === 'completed') {
      return {
        session_id: session.id,
        output_text: result.output_text ?? '',
        tools_called: extractToolNames(result),
      };
    }

    if (result.status === 'failed') {
      throw new Error(`Session failed: ${result.error ?? 'unknown'}`);
    }
  }

  throw new Error(`Session timed out after ${MAX_POLL_ATTEMPTS} poll attempts`);
}

function extractToolNames(result: Record<string, unknown>): string[] {
  const events = (result.events as Array<Record<string, unknown>> | undefined) ?? [];
  return events
    .filter((e) => e.type === 'tool_call')
    .map((e) => e.tool_name as string)
    .filter(Boolean);
}

function assertCase(testCase: EvalCase, result: EvalResult): string | null {
  const { assert } = testCase;

  if (assert.tools_must_include) {
    const missing = assert.tools_must_include.filter((t) => !result.tools_called.includes(t));
    if (missing.length > 0) {
      return `missing tools: ${missing.join(', ')} (got: [${result.tools_called.join(', ')}])`;
    }
  }

  if (assert.response_must_contain) {
    if (!result.output_text.toLowerCase().includes(assert.response_must_contain.toLowerCase())) {
      return `response must contain "${assert.response_must_contain}"`;
    }
  }

  if (assert.response_must_not_contain) {
    if (result.output_text.includes(assert.response_must_not_contain)) {
      return `response must not contain "${assert.response_must_not_contain}"`;
    }
  }

  return null;
}

async function runEvals() {
  console.log(`Running ${goldenSet.length} eval cases against agent ${AGENT_ID}\n`);

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const testCase of goldenSet) {
    try {
      const result = await runEvalSession(testCase.input);
      const failure = assertCase(testCase, result);

      if (!failure) {
        passed++;
        console.log(`✓ ${testCase.description}`);
      } else {
        failed++;
        const msg = `✗ ${testCase.description} — ${failure}`;
        failures.push(msg);
        console.log(msg);
      }
    } catch (err) {
      failed++;
      const msg = `✗ ${testCase.description} — threw: ${err}`;
      failures.push(msg);
      console.log(msg);
    }
  }

  console.log(`\n${passed}/${goldenSet.length} passed`);

  if (failed > 0) {
    console.error('\nFailures:\n' + failures.join('\n'));
    process.exit(1);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

runEvals();

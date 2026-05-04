import Anthropic from '@anthropic-ai/sdk';
import { tracer, meter } from './telemetry.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BETA_HEADER = { 'anthropic-beta': 'managed-agents-2026-04-01' };

const sessionDuration = meter.createHistogram('session.duration_ms');
const sessionCost = meter.createCounter('session.cost_usd');
const sessionErrors = meter.createCounter('session.errors');

export async function runSession(userMessage: string, slackTs: string): Promise<string> {
  return tracer.startActiveSpan('agent.session', async (span) => {
    const start = Date.now();

    try {
      // Inject working style context if available (memory package wired in Phase 4)
      const enrichedMessage = await enrichWithStyleContext(userMessage);

      // Create session — Managed Agents handles everything from here
      const session = await (client.beta as any).agents.sessions.create(
        {
          agent_id: process.env.AGENT_ID!,
          messages: [{ role: 'user', content: enrichedMessage }],
          // Thread continuity: same slack thread → same session context
          metadata: { slack_ts: slackTs },
        },
        { headers: BETA_HEADER }
      );

      span.setAttribute('session.id', session.id);

      // Poll until complete with exponential backoff (cap 10 s)
      let attempt = 0;
      while (true) {
        await sleep(Math.min(1000 * 2 ** attempt, 10_000));
        attempt++;

        const result = await (client.beta as any).agents.sessions.retrieve(session.id, {
          headers: BETA_HEADER,
        });

        if (result.status === 'completed') {
          const durationMs = Date.now() - start;

          sessionDuration.record(durationMs, { status: 'success' });

          if (result.usage) {
            const costUsd = calcCost(result.usage);
            sessionCost.add(costUsd);
            span.setAttribute('session.cost_usd', costUsd);
            span.setAttribute('session.input_tokens', result.usage.input_tokens);
            span.setAttribute('session.output_tokens', result.usage.output_tokens);
          }

          // Async memory processing — non-blocking, wired in Phase 4
          scheduleMemoryProcessing(session.id, userMessage, result.output_text ?? '');

          return result.output_text ?? 'Done.';
        }

        if (result.status === 'failed') {
          sessionErrors.add(1);
          throw new Error(`Session failed: ${result.error ?? 'unknown'}`);
        }
      }
    } catch (err) {
      span.recordException(err as Error);
      sessionErrors.add(1, { status: 'error' });
      throw err;
    } finally {
      span.end();
    }
  });
}

// Enriches the message with working style context.
// Stub until Phase 4 wires in the memory package.
async function enrichWithStyleContext(userMessage: string): Promise<string> {
  try {
    const { getWorkingStyleContext } = await import('../../memory/src/retrieval.js');
    const styleContext = await getWorkingStyleContext();
    if (styleContext) {
      return `${userMessage}\n\n---\n_Context: ${styleContext}_`;
    }
  } catch {
    // Memory package not yet available — no-op
  }
  return userMessage;
}

// Kicks off async memory writer — non-blocking.
function scheduleMemoryProcessing(sessionId: string, userMessage: string, agentReply: string) {
  import('../../memory/src/writer.js')
    .then(({ processSessionAsync }) => processSessionAsync(sessionId, userMessage, agentReply))
    .catch((err) => console.error('memory writer failed:', err));
}

function calcCost(usage: { input_tokens: number; output_tokens: number }): number {
  // Sonnet 4.6: $3/M input, $15/M output
  return (usage.input_tokens / 1_000_000) * 3 + (usage.output_tokens / 1_000_000) * 15;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

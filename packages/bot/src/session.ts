import Anthropic from '@anthropic-ai/sdk';
import { tracer, meter, logSession } from './telemetry.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BETA_HEADER = { 'anthropic-beta': 'managed-agents-2026-04-01' };

// Max poll attempts before giving up: 30 × 10 s cap ≈ 5 minutes
const MAX_POLL_ATTEMPTS = 30;

const sessionDuration = meter.createHistogram('session.duration_ms');
const sessionCost = meter.createCounter('session.cost_usd');
const sessionErrors = meter.createCounter('session.errors');

export async function runSession(userMessage: string, slackTs: string): Promise<string> {
  return tracer.startActiveSpan('agent.session', async (span) => {
    const start = Date.now();

    try {
      const enrichedMessage = await enrichWithStyleContext(userMessage);

      const session = await (client.beta as any).agents.sessions.create(
        {
          agent_id: process.env.AGENT_ID!,
          messages: [{ role: 'user', content: enrichedMessage }],
          metadata: { slack_ts: slackTs },
        },
        { headers: BETA_HEADER }
      );

      span.setAttribute('session.id', session.id);

      // Poll until complete with exponential backoff (cap 10 s, max 30 attempts)
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await sleep(Math.min(1000 * 2 ** attempt, 10_000));

        const result = await (client.beta as any).agents.sessions.retrieve(session.id, {
          headers: BETA_HEADER,
        });

        if (result.status === 'completed') {
          const durationMs = Date.now() - start;
          const toolsCalled: string[] = extractToolNames(result);

          sessionDuration.record(durationMs, { status: 'success' });

          let costUsd = 0;
          if (result.usage) {
            costUsd = calcCost(result.usage);
            sessionCost.add(costUsd);
          }

          span.setAttribute('session.cost_usd', costUsd);
          span.setAttribute('session.input_tokens', result.usage?.input_tokens ?? 0);
          span.setAttribute('session.output_tokens', result.usage?.output_tokens ?? 0);
          span.setAttribute('session.tools_called', toolsCalled.join(','));

          logSession({
            session_id: session.id,
            duration_ms: durationMs,
            input_tokens: result.usage?.input_tokens ?? 0,
            output_tokens: result.usage?.output_tokens ?? 0,
            tools_called: toolsCalled,
            cost_usd: costUsd,
            status: 'success',
          });

          // Non-blocking async memory processing
          scheduleMemoryProcessing(session.id, userMessage, result.output_text ?? '', toolsCalled);

          return result.output_text ?? 'Done.';
        }

        if (result.status === 'failed') {
          throw new Error(`Session failed: ${result.error ?? 'unknown'}`);
        }
      }

      throw new Error(`Session timed out after ${MAX_POLL_ATTEMPTS} poll attempts`);
    } catch (err) {
      span.recordException(err as Error);
      sessionErrors.add(1, { status: 'error' });
      logSession({
        session_id: 'unknown',
        duration_ms: Date.now() - start,
        input_tokens: 0,
        output_tokens: 0,
        tools_called: [],
        cost_usd: 0,
        status: 'error',
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

// Enrich message with working style context from memory package (gracefully degrades)
async function enrichWithStyleContext(userMessage: string): Promise<string> {
  try {
    const { getWorkingStyleContext } = await import('../../memory/src/retrieval.js');
    const styleContext = await getWorkingStyleContext();
    if (styleContext) {
      return `${userMessage}\n\n---\n_Context: ${styleContext}_`;
    }
  } catch {
    // Memory package unavailable — continue without enrichment
  }
  return userMessage;
}

// Kick off async memory writer — non-blocking, errors are logged not thrown
function scheduleMemoryProcessing(
  sessionId: string,
  userMessage: string,
  agentReply: string,
  toolsCalled: string[]
) {
  import('../../memory/src/writer.js')
    .then(({ processSessionAsync }) =>
      processSessionAsync(sessionId, userMessage, agentReply, toolsCalled)
    )
    .catch((err) => console.error('memory writer failed:', err));
}

// Extract tool names from session event log
function extractToolNames(result: Record<string, unknown>): string[] {
  const events = (result.events as Array<Record<string, unknown>> | undefined) ?? [];
  return events
    .filter((e) => e.type === 'tool_call')
    .map((e) => e.tool_name as string)
    .filter(Boolean);
}

function calcCost(usage: { input_tokens: number; output_tokens: number }): number {
  // Sonnet 4.6: $3/M input, $15/M output
  return (usage.input_tokens / 1_000_000) * 3 + (usage.output_tokens / 1_000_000) * 15;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

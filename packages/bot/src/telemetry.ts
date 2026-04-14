// Stub — full OTel init in Phase 5
// Provides tracer/meter/logger so imports don't break in Phase 2-4

import { trace, metrics } from '@opentelemetry/api';
import pino from 'pino';

export const tracer = trace.getTracer('personal-agent');
export const meter = metrics.getMeter('personal-agent');

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export function logSession(data: {
  session_id: string;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  tools_called: string[];
  cost_usd: number;
  status: 'success' | 'error';
}) {
  logger.info({ event: 'session_complete', ...data });
}

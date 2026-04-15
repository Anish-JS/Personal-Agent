import { trace, metrics } from '@opentelemetry/api';
import pino from 'pino';

const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

// OTel SDK is initialized in telemetry-init.ts (loaded first in index.ts).
export const tracer = trace.getTracer('personal-agent');
export const meter = metrics.getMeter('personal-agent');

// Pino with two transports:
//   1. stdout (always) for Railway logs / local dev
//   2. pino-opentelemetry-transport → OTel Collector → Grafana Loki (when running)
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: {
    targets: [
      {
        target: 'pino/file',
        level: process.env.LOG_LEVEL ?? 'info',
        options: { destination: 1 }, // stdout
      },
      {
        target: 'pino-opentelemetry-transport',
        level: process.env.LOG_LEVEL ?? 'info',
        options: {
          endpoint: `${OTEL_ENDPOINT}/v1/logs`,
          resourceAttributes: { 'service.name': 'personal-agent-bot' },
        },
      },
    ],
  },
});

// Structured session telemetry — called after every completed session
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

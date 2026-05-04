import { db } from '../../memory/src/db.js';
import { runSession } from './session.js';

interface DLQPayload {
  session_id?: string;
  user_message: string;
  slack_channel: string;
  slack_thread_ts: string;
  error: string;
  attempt: number;
}

// Enqueue a failed session for retry
export async function enqueue(payload: DLQPayload): Promise<void> {
  await db.query(
    `INSERT INTO dlq (payload, next_retry_at) VALUES ($1, now() + interval '5 min')`,
    [JSON.stringify(payload)]
  );
}

// Cron: retry failed sessions every 5 minutes, max 3 attempts
export async function retryDLQ(
  postMessage: (channel: string, threadTs: string, text: string) => Promise<void>
): Promise<void> {
  const rows = await db.query(
    `SELECT * FROM dlq WHERE attempts < 3 AND next_retry_at < now() ORDER BY created_at LIMIT 10`
  );

  for (const row of rows.rows as Array<{ id: number; payload: string; attempts: number }>) {
    const payload: DLQPayload = JSON.parse(row.payload);

    try {
      const reply = await runSession(payload.user_message, payload.slack_thread_ts);
      await postMessage(payload.slack_channel, payload.slack_thread_ts, `_(retried)_ ${reply}`);
      await db.query('DELETE FROM dlq WHERE id = $1', [row.id]);
    } catch {
      await db.query(
        `UPDATE dlq SET
           attempts = attempts + 1,
           next_retry_at = now() + interval '5 min'
         WHERE id = $1`,
        [row.id]
      );
    }
  }
}

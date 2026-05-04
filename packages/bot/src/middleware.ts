// Token bucket rate limiter: max 10 messages per minute per user
const buckets = new Map<string, { tokens: number; lastRefill: number }>();

export function rateLimitMiddleware(userId: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(userId) ?? { tokens: 10, lastRefill: now };

  // Refill tokens based on time elapsed (minutes)
  const elapsed = (now - bucket.lastRefill) / 60_000;
  bucket.tokens = Math.min(10, bucket.tokens + elapsed * 10);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) return false; // Rate limited

  bucket.tokens -= 1;
  buckets.set(userId, bucket);
  return true;
}

// Delegates to memory writer for DB persistence
export async function recordFeedback(payload: {
  message_ts: string;
  reaction: '+1' | '-1';
}): Promise<void> {
  const { recordFeedback: dbRecord } = await import('../../memory/src/writer.js');
  await dbRecord(payload);
}

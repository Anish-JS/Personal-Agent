// Voyage AI embeddings via REST API (voyage-3-lite, 1024 dims)
// Requires VOYAGE_API_KEY env var — get one at dash.voyageai.com (free tier available)

const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

// In-process cache keyed on first 200 chars — avoids redundant API calls within a session
const cache = new Map<string, number[]>();

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { total_tokens: number };
}

export async function embed(text: string): Promise<number[]> {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is not set');
  }

  const cacheKey = text.slice(0, 200);
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const res = await fetch(VOYAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: 'voyage-3-lite', input: [text] }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage AI embedding failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as VoyageResponse;
  const embedding = data.data[0].embedding;

  cache.set(cacheKey, embedding);
  return embedding;
}

// Convert number[] to pgvector literal string compatible with $1::vector parameter binding
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cache embeddings within the process to avoid redundant API calls
const cache = new Map<string, number[]>();

export async function embed(text: string): Promise<number[]> {
  const key = text.slice(0, 200); // Truncate cache key for long texts
  if (cache.has(key)) return cache.get(key)!;

  // Use voyage-3-lite via Anthropic embeddings endpoint
  const response = await (client as any).embeddings.create({
    model: 'voyage-3-lite',
    input: text,
  });

  const embedding: number[] = response.embeddings[0].embedding;
  cache.set(key, embedding);
  return embedding;
}

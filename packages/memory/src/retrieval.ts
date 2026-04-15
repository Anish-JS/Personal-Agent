import { db } from './db.js';
import { embed, toVectorLiteral } from './embedding.js';

// Called before every session — builds personalized context block
export async function getWorkingStyleContext(): Promise<string | null> {
  const result = await db.query('SELECT * FROM working_style WHERE id = 1');
  const ws = result.rows[0];
  if (!ws) return null;

  const lines = [
    ws.peak_hours && `Active hours: ${ws.peak_hours}`,
    ws.format_preference && `Format preference: ${ws.format_preference}`,
    ws.top_task_types?.length && `Common tasks: ${(ws.top_task_types as string[]).join(', ')}`,
    ws.frequent_contacts?.length && `Key people: ${(ws.frequent_contacts as string[]).join(', ')}`,
    ws.domain_terms?.length && `Domain terms: ${(ws.domain_terms as string[]).join(', ')}`,
    ws.confirm_before?.length &&
      `Always confirm before: ${(ws.confirm_before as string[]).join(', ')}`,
  ].filter(Boolean);

  return lines.length ? lines.join('\n') : null;
}

// Semantic search over memories — returns task-relevant facts and preferences
export async function retrieveRelevantMemories(query: string, limit = 5): Promise<string[]> {
  const embedding = await embed(query);
  // pgvector expects the literal form '[0.1,0.2,...]'::vector via cast — pass as typed literal
  const result = await db.query(
    `SELECT text FROM memories
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [toVectorLiteral(embedding), limit]
  );
  return (result.rows as Array<{ text: string }>).map((r) => r.text);
}

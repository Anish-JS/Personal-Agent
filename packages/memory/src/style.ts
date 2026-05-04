import { db } from './db.js';

// Nightly job: rebuilds working style profile from session history
export async function rebuildWorkingStyleProfile(): Promise<void> {
  // Peak hours: top 2 most active hours by message volume
  const peakResult = await db.query(
    `SELECT hour, count FROM session_hours ORDER BY count DESC LIMIT 2`
  );
  const peakHours =
    peakResult.rows.length > 0
      ? (peakResult.rows as Array<{ hour: number }>)
          .map((r) => `${r.hour}:00`)
          .join(', ')
      : null;

  // Top task types: aggregate by session intent category stored in memories
  const taskResult = await db.query(
    `SELECT category, count(*) as n FROM memories
     WHERE category NOT IN ('fact', 'preference', 'correction', 'pattern')
     GROUP BY category ORDER BY n DESC LIMIT 5`
  );
  const topTaskTypes = (taskResult.rows as Array<{ category: string }>).map((r) => r.category);

  // Frequent contacts: extract capitalized names from recent fact memories
  const contactResult = await db.query(
    `SELECT text FROM memories WHERE category = 'fact' ORDER BY created_at DESC LIMIT 50`
  );
  const contactMentions: Record<string, number> = {};
  for (const row of contactResult.rows as Array<{ text: string }>) {
    const matches = row.text.match(/\b([A-Z][a-z]{2,})\b/g) ?? [];
    for (const name of matches) {
      contactMentions[name] = (contactMentions[name] ?? 0) + 1;
    }
  }
  const frequentContacts = Object.entries(contactMentions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  // Tools by frequency — aggregate from session tools_called
  const toolResult = await db.query(
    `SELECT unnest(tools_called) as tool, count(*) as n
     FROM sessions WHERE tools_called IS NOT NULL
     GROUP BY tool ORDER BY n DESC`
  );
  const toolsByFrequency: Record<string, number> = {};
  for (const row of toolResult.rows as Array<{ tool: string; n: string }>) {
    // count(*) from pg driver comes back as string — parseInt converts it
    toolsByFrequency[row.tool] = parseInt(row.n, 10);
  }

  await db.query(
    `UPDATE working_style SET
       peak_hours         = COALESCE($1, peak_hours),
       top_task_types     = COALESCE($2, top_task_types),
       frequent_contacts  = COALESCE($3, frequent_contacts),
       tools_by_frequency = COALESCE($4, tools_by_frequency),
       updated_at         = now()
     WHERE id = 1`,
    [
      peakHours,
      topTaskTypes.length ? topTaskTypes : null,
      frequentContacts.length ? frequentContacts : null,
      Object.keys(toolsByFrequency).length ? JSON.stringify(toolsByFrequency) : null,
    ]
  );
}

export interface SessionRecord {
  feedback: number | null;
  was_corrected: boolean;
  status: string;
}

// Quality score formula — called nightly from cron or on-demand
export function computeQualityScore(sessions: SessionRecord[]): number {
  const last30 = sessions.slice(-30);
  const thumbsUp = last30.filter((s) => s.feedback === 1).length;
  const thumbsDown = last30.filter((s) => s.feedback === -1).length;
  const corrections = last30.filter((s) => s.was_corrected).length;
  const total = last30.length || 1;

  const reactionScore = ((thumbsUp - thumbsDown) / total + 1) / 2 * 40;      // 0–40
  const correctionScore = (1 - corrections / total) * 40;                      // 0–40
  const completionScore = last30.filter((s) => s.status === 'completed').length / total * 20; // 0–20

  return Math.round(reactionScore + correctionScore + completionScore); // 0–100
}

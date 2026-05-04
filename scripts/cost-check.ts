#!/usr/bin/env tsx
/**
 * Daily cost alert — run as a cron job (e.g. "0 9 * * *" via Railway cron).
 * If today's API spend exceeds COST_ALERT_THRESHOLD, DMs you on Slack.
 *
 * Uses the Slack Web API directly (no socket mode — safe to run as a cron script).
 *
 * Run:
 *   doppler run -- pnpm cost-check
 */

const DAILY_THRESHOLD_USD = parseFloat(process.env.COST_ALERT_THRESHOLD ?? '2.00');
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const TARGET_USER_ID = process.env.ALLOWED_SLACK_USER_ID;

if (!SLACK_BOT_TOKEN || !TARGET_USER_ID) {
  console.error('SLACK_BOT_TOKEN and ALLOWED_SLACK_USER_ID are required');
  process.exit(1);
}

async function getDailyCostUsd(): Promise<number> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const res = await fetch(
    `https://api.anthropic.com/v1/usage?start_date=${today}&end_date=${today}`,
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Usage API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { total_cost_usd?: number };
  return data.total_cost_usd ?? 0;
}

async function sendSlackDM(text: string): Promise<void> {
  // Open a DM channel with the user first
  const openRes = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ users: TARGET_USER_ID }),
  });

  const openData = (await openRes.json()) as { ok: boolean; channel?: { id: string } };
  if (!openData.ok || !openData.channel?.id) {
    throw new Error(`Failed to open DM channel: ${JSON.stringify(openData)}`);
  }

  // Post the message
  const postRes = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel: openData.channel.id,
      text,
    }),
  });

  const postData = (await postRes.json()) as { ok: boolean; error?: string };
  if (!postData.ok) {
    throw new Error(`Failed to send Slack DM: ${postData.error}`);
  }
}

async function main() {
  const costUsd = await getDailyCostUsd();
  console.log(`Today's cost: $${costUsd.toFixed(4)} (threshold: $${DAILY_THRESHOLD_USD.toFixed(2)})`);

  if (costUsd > DAILY_THRESHOLD_USD) {
    await sendSlackDM(
      `Cost alert: $${costUsd.toFixed(2)} spent today (threshold: $${DAILY_THRESHOLD_USD.toFixed(2)})`
    );
    console.log('Alert sent to Slack');
  }
}

main().catch((err) => {
  console.error('cost-check failed:', err);
  process.exit(1);
});

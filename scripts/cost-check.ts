#!/usr/bin/env tsx
/**
 * Daily cost alert — runs as a cron job (e.g. "0 9 * * *").
 * If today's API spend exceeds $2.00, DMs you on Slack.
 *
 * Set up as Railway cron or system cron:
 *   doppler run -- tsx scripts/cost-check.ts
 */

import { App } from '@slack/bolt';

const DAILY_THRESHOLD_USD = parseFloat(process.env.COST_ALERT_THRESHOLD ?? '2.00');

async function getDailyCostUsd(): Promise<number> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const res = await fetch(`https://api.anthropic.com/v1/usage?start_date=${today}&end_date=${today}`, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
  });

  if (!res.ok) {
    throw new Error(`Usage API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { total_cost_usd?: number };
  return data.total_cost_usd ?? 0;
}

async function main() {
  const costUsd = await getDailyCostUsd();
  console.log(`Today's cost: $${costUsd.toFixed(4)}`);

  if (costUsd > DAILY_THRESHOLD_USD) {
    const app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      socketMode: false,
    });

    await app.client.chat.postMessage({
      channel: process.env.ALLOWED_SLACK_USER_ID!,
      text: `Cost alert: $${costUsd.toFixed(2)} spent today (threshold: $${DAILY_THRESHOLD_USD.toFixed(2)})`,
    });

    console.log('Alert sent to Slack');
  }
}

main().catch((err) => {
  console.error('cost-check failed:', err);
  process.exit(1);
});

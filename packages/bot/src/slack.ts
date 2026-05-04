import { App } from '@slack/bolt';
import { rateLimitMiddleware, recordFeedback } from './middleware.js';
import { runSession } from './session.js';
import { enqueue } from './dlq.js';

export const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // No public URL needed
  appToken: process.env.SLACK_APP_TOKEN,
});

// Allowlist: only handle messages from your own Slack user
app.use(async ({ payload, next }) => {
  const userId = (payload as Record<string, unknown>).user as string | undefined;
  if (userId && userId !== process.env.ALLOWED_SLACK_USER_ID) return;
  await next();
});

// Handle direct messages
app.event('message', async ({ event, client }) => {
  const msg = event as Record<string, unknown>;
  if (msg.channel_type !== 'im') return;
  if (msg.bot_id) return; // Ignore own messages

  const userId = msg.user as string;
  const channel = msg.channel as string;
  const ts = msg.ts as string;
  const threadTs = (msg.thread_ts as string | undefined) ?? ts;
  const text = (msg.text as string | undefined) ?? '';

  if (!rateLimitMiddleware(userId)) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: 'Slow down — too many messages. Try again in a minute.',
    });
    return;
  }

  try {
    const reply = await runSession(text, ts);

    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: reply,
      mrkdwn: true,
    });
  } catch (err) {
    console.error({ err, session_ts: ts }, 'session failed');
    // Enqueue for retry — DLQ retrier runs every 5 min
    await enqueue({
      user_message: text,
      slack_channel: channel,
      slack_thread_ts: threadTs,
      error: String(err),
      attempt: 1,
    });
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "Something went wrong — I've queued it for retry.",
    });
  }
});

// Thumbs reaction → feedback signal
app.event('reaction_added', async ({ event }) => {
  if (event.reaction === '+1' || event.reaction === '-1') {
    await recordFeedback({
      message_ts: (event.item as Record<string, string>).ts,
      reaction: event.reaction as '+1' | '-1',
    });
  }
});

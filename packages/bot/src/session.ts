// Stub — full implementation in Phase 3
// Exported so Phase 2 smoke test can import it

export async function runSession(userMessage: string, _slackTs: string): Promise<string> {
  if (userMessage.trim().toLowerCase() === 'ping') return 'pong';
  return `[stub] Echo: ${userMessage}`;
}

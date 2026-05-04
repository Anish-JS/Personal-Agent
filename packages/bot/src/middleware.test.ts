import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimitMiddleware } from './middleware.js';

describe('rateLimitMiddleware', () => {
  beforeEach(() => {
    // Reset module state between tests by using distinct user IDs
  });

  it('allows the first 10 messages', () => {
    const userId = 'test-user-' + Math.random();
    for (let i = 0; i < 10; i++) {
      expect(rateLimitMiddleware(userId)).toBe(true);
    }
  });

  it('blocks the 11th message within the same minute', () => {
    const userId = 'test-user-' + Math.random();
    for (let i = 0; i < 10; i++) {
      rateLimitMiddleware(userId);
    }
    expect(rateLimitMiddleware(userId)).toBe(false);
  });

  it('allows different users independently', () => {
    const user1 = 'user-a-' + Math.random();
    const user2 = 'user-b-' + Math.random();
    for (let i = 0; i < 10; i++) {
      rateLimitMiddleware(user1);
    }
    // user2 should still be allowed
    expect(rateLimitMiddleware(user2)).toBe(true);
  });
});

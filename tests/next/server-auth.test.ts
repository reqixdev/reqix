import { describe, it, expect, vi } from 'vitest';
import { getServerAuth, createServerAuthFactory } from '../../src/next/server-auth.js';
import type { CookieStoreLike } from '../../src/next/types.js';

describe('Next.js Server Auth Helper', () => {
  it('getServerAuth returns a working Auth instance connected to cookies', async () => {
    const mockCookies: CookieStoreLike = {
      get: (name) => (name === 'access_token' ? { name, value: 'server-token' } : undefined),
      set: vi.fn(),
      delete: vi.fn(),
    };

    const auth = getServerAuth({
      cookies: mockCookies,
      refreshSession: vi.fn(),
    });

    const session = await auth.getSession();
    expect(session?.accessToken).toBe('server-token');
    expect(await auth.isAuthenticated()).toBe(true);
  });

  it('createServerAuthFactory creates cached factory function', () => {
    const mockCookies: CookieStoreLike = {
      get: () => undefined,
      set: vi.fn(),
      delete: vi.fn(),
    };

    const factory = createServerAuthFactory({
      cookies: mockCookies,
      refreshSession: vi.fn(),
    });

    const auth1 = factory();
    const auth2 = factory();

    expect(auth1).toBeDefined();
    expect(auth2).toBeDefined();
  });
});

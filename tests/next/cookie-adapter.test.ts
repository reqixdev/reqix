import { describe, it, expect, vi } from 'vitest';
import { createCookieSessionAdapter } from '../../src/next/cookie-adapter.js';
import type { CookieStoreLike, CookieOptions } from '../../src/next/types.js';

describe('Next.js Cookie Session Adapter', () => {
  it('reads session from cookie store', async () => {
    const store: Record<string, string> = {
      access_token: 'acc-123',
      refresh_token: 'ref-456',
      expires_at: '1800000000000',
    };

    const mockCookies: CookieStoreLike = {
      get: (name) => (store[name] ? { name, value: store[name]! } : undefined),
      set: vi.fn(),
      delete: vi.fn(),
    };

    const adapter = createCookieSessionAdapter({ cookies: mockCookies });
    const session = await adapter.getSession();

    expect(session).toEqual({
      accessToken: 'acc-123',
      refreshToken: 'ref-456',
      expiresAt: 1800000000000,
    });
  });

  it('saves session with correct cookie options and attributes', async () => {
    const store = new Map<string, { value: string; options?: CookieOptions | undefined }>();
    const mockCookies: CookieStoreLike = {
      get: (name) => {
        const item = store.get(name);
        return item ? { name, value: item.value } : undefined;
      },
      set: (name, value, options) => {
        store.set(name, { value, options });
      },
      delete: (name) => {
        store.delete(name);
      },
    };

    const adapter = createCookieSessionAdapter({
      cookies: mockCookies,
      options: { sameSite: 'strict', path: '/' },
    });

    await adapter.saveSession({
      accessToken: 'fresh-acc',
      refreshToken: 'fresh-ref',
      expiresAt: Date.now() + 300_000,
    });

    expect(store.get('access_token')?.value).toBe('fresh-acc');
    expect(store.get('refresh_token')?.value).toBe('fresh-ref');
    expect(store.get('access_token')?.options?.sameSite).toBe('strict');
    expect(store.get('access_token')?.options?.httpOnly).toBe(true);
  });

  it('handles write-blocked Server Component error without throwing and triggers callback', async () => {
    const onWriteBlocked = vi.fn();
    const mockCookies: CookieStoreLike = {
      get: () => ({ name: 'access_token', value: 'token' }),
      set: () => {
        throw new Error('Cookies can only be modified in a Server Action or Route Handler');
      },
      delete: () => {
        throw new Error('Cookies can only be modified in a Server Action or Route Handler');
      },
    };

    const adapter = createCookieSessionAdapter({
      cookies: mockCookies,
      onWriteBlocked,
    });

    // Both saveSession and clearSession must not crash the render
    await expect(adapter.saveSession({ accessToken: 'new' })).resolves.toBeUndefined();
    await expect(adapter.clearSession()).resolves.toBeUndefined();

    expect(onWriteBlocked).toHaveBeenCalledTimes(2);
  });
});

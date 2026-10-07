import { describe, it, expect, vi } from 'vitest';
import { createAuth } from '../../src/auth/create-auth.js';
import { AuthError, Session } from '../../src/auth/types.js';

describe('Auth Deep Coverage', () => {
  it('reactive refresh in auth.fetch retries and succeeds', async () => {
    let fetchCalls = 0;
    let session: Session | null = {
      accessToken: 'stale-token',
      expiresAt: Date.now() + 60_000,
    };

    const mockFetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
      fetchCalls++;
      const headers = new Headers(init.headers);
      if (headers.get('authorization') === 'Bearer new-fetch-token') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(new Response('Unauthorized', { status: 401 }));
    });

    const auth = createAuth({
      getSession: () => session,
      saveSession: (s) => {
        session = s;
      },
      clearSession: () => {
        session = null;
      },
      refreshSession: async () => {
        session = { accessToken: 'new-fetch-token', expiresAt: Date.now() + 60_000 };
        return session;
      },
      fetch: mockFetch as unknown as typeof fetch,
    });

    const res = await auth.fetch('https://api.example.com/fetch-refresh');
    expect(res.status).toBe(200);
    expect(fetchCalls).toBe(2);
  });

  it('handles error thrown in clearSession or saveSession gracefully', async () => {
    let session: Session | null = { accessToken: 'token-1', expiresAt: Date.now() - 1000 };

    const auth = createAuth({
      getSession: () => session,
      saveSession: () => {
        throw new Error('Disk full');
      },
      clearSession: () => {
        throw new Error('Database locked');
      },
      refreshSession: async () => ({ accessToken: 'token-2', expiresAt: Date.now() + 60_000 }),
      fetch: vi.fn() as unknown as typeof fetch,
    });

    // saveSession throwing should not prevent refresh from returning session
    const refreshed = await auth.refresh();
    expect(refreshed.accessToken).toBe('token-2');

    // clearSession throwing should not prevent logout from completing
    await expect(auth.logout()).resolves.toBeUndefined();
  });

  it('rejects invalid session returned from refreshSession and isolates onRefreshError failure', async () => {
    let session: Session | null = { accessToken: 'token-1', expiresAt: Date.now() - 1000 };

    const auth = createAuth({
      getSession: () => session,
      saveSession: vi.fn(),
      clearSession: vi.fn(),
      refreshSession: async () => ({ accessToken: '' }), // Invalid: empty string
      onRefreshError: () => {
        throw new Error('Sentry crash');
      },
      fetch: vi.fn() as unknown as typeof fetch,
    });

    await expect(auth.refresh()).rejects.toThrow(AuthError);
  });

  it('uses default attachToken and default shouldRefresh when options are omitted', async () => {
    let capturedHeaders: Headers | undefined;
    const mockFetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
      capturedHeaders = new Headers(init.headers);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const auth = createAuth({
      getSession: () => ({ accessToken: 'default-tok' }),
      saveSession: vi.fn(),
      clearSession: vi.fn(),
      refreshSession: vi.fn(),
      fetch: mockFetch as unknown as typeof fetch,
    });

    await auth.client.get('https://api.example.com/defaults');
    expect(capturedHeaders?.get('authorization')).toBe('Bearer default-tok');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createAuth, publicFetch } from '../../src/auth/create-auth.js';
import { AuthError, Session } from '../../src/auth/types.js';
import { createMemoryLock } from '../../src/auth/locks.js';

describe('createAuth Core Behavior Guarantees', () => {
  it('10 parallel requests with expired token: refreshSession called once, all 10 succeed', async () => {
    let refreshCalls = 0;
    let currentSession: Session | null = {
      accessToken: 'expired-token',
      expiresAt: Date.now() - 1000, // Expired
    };

    const refreshSession = vi.fn().mockImplementation(async () => {
      refreshCalls++;
      await new Promise((r) => setTimeout(r, 20)); // Small latency
      currentSession = {
        accessToken: 'fresh-token',
        expiresAt: Date.now() + 60_000,
      };
      return currentSession;
    });

    const mockFetch = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const headers = new Headers(init.headers);
      const auth = headers.get('authorization');
      if (auth === 'Bearer fresh-token') {
        return new Response(JSON.stringify({ data: 'ok' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    });

    const auth = createAuth({
      getSession: () => currentSession,
      saveSession: (s) => {
        currentSession = s;
      },
      clearSession: () => {
        currentSession = null;
      },
      refreshSession,
      fetch: mockFetch as unknown as typeof fetch,
      lock: createMemoryLock(),
    });

    // Fire 10 requests concurrently
    const promises = Array.from({ length: 10 }).map((_, i) =>
      auth.client.get<{ data: string }>(`https://api.example.com/data/${i}`)
    );

    const results = await Promise.all(promises);

    expect(refreshCalls).toBe(1);
    expect(results).toHaveLength(10);
    for (const res of results) {
      expect(res.data).toEqual({ data: 'ok' });
    }
  });

  it('refresh fails: all 10 parallel requests reject without hanging, onRefreshError/clearSession/onLogout called once', async () => {
    let currentSession: Session | null = {
      accessToken: 'bad-token',
      expiresAt: Date.now() - 1000,
    };

    const clearSession = vi.fn().mockImplementation(async () => {
      currentSession = null;
    });
    const onRefreshError = vi.fn();
    const onLogout = vi.fn();

    const refreshSession = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      throw new Error('Refresh token revoked');
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response('401', { status: 401 }));

    const auth = createAuth({
      getSession: () => currentSession,
      saveSession: vi.fn(),
      clearSession,
      refreshSession,
      onRefreshError,
      onLogout,
      fetch: mockFetch as unknown as typeof fetch,
      lock: createMemoryLock(),
    });

    const promises = Array.from({ length: 10 }).map((_, i) =>
      auth.client.get(`https://api.example.com/item/${i}`)
    );

    const outcomes = await Promise.allSettled(promises);

    expect(outcomes).toHaveLength(10);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(AuthError);
        expect((outcome.reason as AuthError).code).toBe('REFRESH_FAILED');
      }
    }

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(onRefreshError).toHaveBeenCalledTimes(1);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledWith('refresh_failed');
  });

  it('proactive refresh occurs before token expiry', async () => {
    let refreshCalled = false;
    // Token expires in 10s. Default threshold is 30s + 5s = 35s. So it is near expiry!
    let session: Session | null = {
      accessToken: 'old-token',
      expiresAt: Date.now() + 10_000,
    };

    const mockFetch = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(headers.get('authorization')).toBe('Bearer proactive-token');
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
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
        refreshCalled = true;
        session = { accessToken: 'proactive-token', expiresAt: Date.now() + 3600_000 };
        return session;
      },
      fetch: mockFetch as unknown as typeof fetch,
    });

    await auth.client.get('https://api.example.com/proactive');
    expect(refreshCalled).toBe(true);
  });

  it('stale-401 protection: request sent with old token retries with latest token without second refresh', async () => {
    let refreshCalls = 0;
    let session: Session | null = {
      accessToken: 'token-v1',
      expiresAt: Date.now() + 60_000,
    };

    const mockFetch = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const headers = new Headers(init.headers);
      const token = headers.get('authorization');
      if (token === 'Bearer token-v1') {
        // While this request was in flight, another operation already updated the session to token-v2
        session = { accessToken: 'token-v2', expiresAt: Date.now() + 60_000 };
        return new Response('Unauthorized', { status: 401 });
      }
      if (token === 'Bearer token-v2') {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response('Unauthorized', { status: 401 });
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
        refreshCalls++;
        session = { accessToken: 'token-v3', expiresAt: Date.now() + 60_000 };
        return session;
      },
      fetch: mockFetch as unknown as typeof fetch,
    });

    const res = await auth.client.get<{ success: boolean }>('https://api.example.com/stale-check');
    expect(res.data).toEqual({ success: true });
    // refreshSession was NEVER called because token-v2 was already ready!
    expect(refreshCalls).toBe(0);
  });

  it('loop protection: backend always returns 401 -> exactly one refresh and one retry, then errors', async () => {
    let refreshCalls = 0;
    let fetchCalls = 0;
    let session: Session | null = {
      accessToken: 'token-initial',
      expiresAt: Date.now() + 60_000,
    };

    const mockFetch = vi.fn().mockImplementation(async () => {
      fetchCalls++;
      return new Response('401 Unauthorized', { status: 401 });
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
        refreshCalls++;
        session = { accessToken: 'token-refreshed', expiresAt: Date.now() + 60_000 };
        return session;
      },
      fetch: mockFetch as unknown as typeof fetch,
      maxRefreshAttemptsPerRequest: 1,
    });

    await expect(auth.client.get('https://api.example.com/loop-test')).rejects.toThrow();
    expect(refreshCalls).toBe(1);
    expect(fetchCalls).toBe(2); // Initial attempt + 1 retry
  });

  it('logout during in-flight refresh discards refreshed session', async () => {
    let session: Session | null = {
      accessToken: 'initial-token',
      expiresAt: Date.now() - 1000,
    };
    const saveSessionSpy = vi.fn();

    const auth = createAuth({
      getSession: () => session,
      saveSession: saveSessionSpy,
      clearSession: () => {
        session = null;
      },
      refreshSession: async () => {
        // Simulate delayed backend call
        await new Promise((r) => setTimeout(r, 30));
        return { accessToken: 'delayed-refreshed', expiresAt: Date.now() + 60_000 };
      },
      fetch: vi.fn() as unknown as typeof fetch,
    });

    // Start refresh in background
    const refreshPromise = auth.refresh();

    // Trigger logout while refresh is still in flight
    await auth.logout({ reason: 'manual' });

    // Await refresh completion; it must throw error and not save
    await expect(refreshPromise).rejects.toThrow(AuthError);
    expect(saveSessionSpy).not.toHaveBeenCalled();
    expect(await auth.getSession()).toBeNull();
  });

  it('logout aborts in-flight requests, double logout is safe, failing onLogout does not break cleanup', async () => {
    let session: Session | null = { accessToken: 'valid-token', expiresAt: Date.now() + 60_000 };
    const clearSessionSpy = vi.fn().mockImplementation(() => {
      session = null;
    });
    const onLogoutSpy = vi.fn().mockRejectedValue(new Error('Logout webhook failed'));

    const mockFetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init.signal?.aborted) {
          reject(new Error('Aborted'));
          return;
        }
        init.signal?.addEventListener('abort', () => {
          reject(new Error('Aborted'));
        });
      });
    });

    const auth = createAuth({
      getSession: () => session,
      saveSession: vi.fn(),
      clearSession: clearSessionSpy,
      refreshSession: vi.fn(),
      onLogout: onLogoutSpy,
      fetch: mockFetch as unknown as typeof fetch,
    });

    const fetchPromise = auth.fetch('https://api.example.com/long-lived');

    // Call logout
    await auth.logout();
    await expect(fetchPromise).rejects.toThrow();

    // Double logout should be safe and idempotent
    await expect(auth.logout()).resolves.toBeUndefined();

    expect(clearSessionSpy).toHaveBeenCalledTimes(2);
    expect(session).toBeNull();
  });

  it('skipAuth / shouldSkip bypasses token attachment and refresh', async () => {
    let session: Session | null = {
      accessToken: 'valid-token',
      expiresAt: Date.now() + 60_000,
    };

    let capturedHeaders: Headers | undefined;
    const mockFetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
      capturedHeaders = new Headers(init.headers);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const auth = createAuth({
      getSession: () => session,
      saveSession: vi.fn(),
      clearSession: vi.fn(),
      refreshSession: vi.fn(),
      shouldSkip: (url) => url.includes('/public/'),
      fetch: mockFetch as unknown as typeof fetch,
    });

    await auth.client.get('https://api.example.com/public/items');
    expect(capturedHeaders?.has('authorization')).toBe(false);

    await auth.fetch('https://api.example.com/other', { skipAuth: true });
    expect(capturedHeaders?.has('authorization')).toBe(false);
  });

  it('lock: second simulated tab sees fresh session after lock and skips refresh', async () => {
    let refreshCalls = 0;
    let sharedStorage: Session | null = {
      accessToken: 'tab1-old',
      expiresAt: Date.now() - 5000,
    };

    const lock = createMemoryLock();

    const createTabAuth = () =>
      createAuth({
        getSession: () => sharedStorage,
        saveSession: (s) => {
          sharedStorage = s;
        },
        clearSession: () => {
          sharedStorage = null;
        },
        refreshSession: async () => {
          refreshCalls++;
          await new Promise((r) => setTimeout(r, 20));
          sharedStorage = { accessToken: 'tab-refreshed', expiresAt: Date.now() + 60_000 };
          return sharedStorage;
        },
        fetch: vi.fn() as unknown as typeof fetch,
        lock,
      });

    const tab1 = createTabAuth();
    const tab2 = createTabAuth();

    // Both tabs trigger refresh at the same time
    const [res1, res2] = await Promise.all([tab1.refresh(), tab2.refresh()]);

    expect(refreshCalls).toBe(1);
    expect(res1.accessToken).toBe('tab-refreshed');
    expect(res2.accessToken).toBe('tab-refreshed');
  });

  it('default cache: no-store is applied; publicFetch does not attach token', async () => {
    let capturedInit: RequestInit | undefined;
    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      capturedInit = init;
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const auth = createAuth({
      getSession: () => ({ accessToken: 'my-token' }),
      saveSession: vi.fn(),
      clearSession: vi.fn(),
      refreshSession: vi.fn(),
      fetch: mockFetch as unknown as typeof fetch,
    });

    await auth.fetch('https://api.example.com/cached-test');
    expect(capturedInit?.cache).toBe('no-store');

    // Test publicFetch
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('pub', { status: 200 }));
    await publicFetch('https://api.example.com/public-data');
    expect(globalFetchSpy).toHaveBeenCalledTimes(1);
  });
});

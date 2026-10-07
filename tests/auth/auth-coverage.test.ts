import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../src/auth/events.js';
import { createWebLock, CrossTabSync } from '../../src/auth/locks.js';
import { SingleFlight } from '../../src/auth/single-flight.js';
import { createAuth } from '../../src/auth/create-auth.js';
import { isAuthError, AuthError, Session } from '../../src/auth/types.js';

describe('Auth Additional Coverage', () => {
  it('EventEmitter subscribe, emit, error isolation, clear and size', () => {
    const emitter = new EventEmitter<number>();
    expect(emitter.size).toBe(0);

    const values: number[] = [];
    const unsub = emitter.subscribe((v) => values.push(v));
    expect(emitter.size).toBe(1);

    // Failing subscriber should not crash emit
    emitter.subscribe(() => {
      throw new Error('Subscriber failure');
    });

    emitter.emit(42);
    expect(values).toEqual([42]);

    unsub();
    expect(emitter.size).toBe(1);

    emitter.clear();
    expect(emitter.size).toBe(0);
  });

  it('SingleFlight isInFlight reports status correctly', async () => {
    const flight = new SingleFlight<string>();
    expect(flight.isInFlight()).toBe(false);

    const p = flight.do(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'done';
    });

    expect(flight.isInFlight()).toBe(true);
    await p;
    expect(flight.isInFlight()).toBe(false);
  });

  it('CrossTabSync handles message dispatch and close gracefully', () => {
    const sync = new CrossTabSync('test-channel');
    expect(() => sync.post('logout')).not.toThrow();
    expect(() => sync.close()).not.toThrow();
  });

  it('createWebLock falls back to memory lock when navigator.locks is unavailable', async () => {
    const lock = createWebLock();
    const res = await lock.run('test-fallback', async () => 999);
    expect(res).toBe(999);
  });

  it('createAuth setSession, subscribe, and isAuthenticated work as expected', async () => {
    let session: Session | null = null;
    const auth = createAuth({
      getSession: () => session,
      saveSession: (s) => {
        session = s;
      },
      clearSession: () => {
        session = null;
      },
      refreshSession: vi.fn(),
      fetch: vi.fn() as unknown as typeof fetch,
    });

    expect(await auth.isAuthenticated()).toBe(false);

    const observed: (Session | null)[] = [];
    const unsub = auth.subscribe((s) => observed.push(s));

    await auth.setSession({ accessToken: 'valid-new-token' });

    expect(await auth.isAuthenticated()).toBe(true);
    expect(observed.length).toBe(1);
    expect(observed[0]?.accessToken).toBe('valid-new-token');

    unsub();

    // Rejects invalid session in setSession
    await expect(auth.setSession({ accessToken: '' })).rejects.toThrow(AuthError);
  });

  it('isAuthError identifies AuthError instances', () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(new Error('std'))).toBe(false);
    expect(isAuthError(new AuthError('REFRESH_FAILED', 'fail'))).toBe(true);
  });
});

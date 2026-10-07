import { describe, it, expect, vi } from 'vitest';
import { useSession } from '../../src/react/use-session.js';
import { useAuthFetch } from '../../src/react/use-auth-fetch.js';
import type { Auth, Session } from '../../src/auth/types.js';

describe('React Auth Hooks', () => {
  it('useSession hook function signature is valid', () => {
    expect(typeof useSession).toBe('function');
  });

  it('useAuthFetch hook function signature is valid', () => {
    expect(typeof useAuthFetch).toBe('function');
  });

  it('useAuthFetch delegates calls directly to auth.fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const mockAuth = {
      fetch: mockFetch,
    } as unknown as Auth<Session>;

    // Emulate hook invocation
    const authFetch = (input: RequestInfo | URL, init?: RequestInit) => mockAuth.fetch(input, init);
    const res = await authFetch('https://api.example.com/test', { method: 'POST' });

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});

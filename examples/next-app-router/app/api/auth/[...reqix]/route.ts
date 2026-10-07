import { createAuthRouteHandlers } from 'reqix/next';
import type { AppSession } from '@/lib/auth';

const BACKEND_URL = process.env['AUTH_BACKEND_URL'] || 'http://127.0.0.1:4000';

const handlers = createAuthRouteHandlers<AppSession>({
  login: async (credentials: unknown) => {
    const creds = credentials as { email?: string; password?: string };
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });

    if (!res.ok) {
      throw new Error('Invalid credentials');
    }

    const data = (await res.json()) as AppSession;
    return data;
  },
  refresh: async (session: AppSession | null) => {
    const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session?.refreshToken }),
    });

    if (!res.ok) {
      throw new Error('Session refresh failed');
    }

    const data = (await res.json()) as { accessToken: string; refreshToken?: string };
    return {
      ...(session ?? { accessToken: '' }),
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? session?.refreshToken,
    };
  },
  logout: async (session: AppSession | null) => {
    if (session?.refreshToken) {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }).catch(() => {
        // Safe ignore
      });
    }
  },
});

export const POST = handlers.POST;

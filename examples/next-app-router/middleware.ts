import { createAuthMiddleware } from 'reqix/next';
import type { AppSession } from './lib/auth';

const BACKEND_URL = process.env['AUTH_BACKEND_URL'] || 'http://127.0.0.1:4000';

export const middleware = createAuthMiddleware<AppSession>({
  loginUrl: '/login',
  publicPaths: ['/', '/login', '/api/auth'],
  refresh: async (session: AppSession) => {
    const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });

    if (!res.ok) {
      throw new Error('Middleware refresh failed');
    }

    const data = (await res.json()) as { accessToken: string; refreshToken?: string };
    return {
      ...session,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? session.refreshToken,
    };
  },
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

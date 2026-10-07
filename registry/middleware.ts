import { createAuthMiddleware } from 'reqix/next';
import type { Session } from 'reqix';

export interface AppSession extends Session {
  accessToken: string;
  refreshToken?: string;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  [key: string]: unknown;
}

const BACKEND_URL = process.env.AUTH_BACKEND_URL || 'http://localhost:4000';

export const middleware = createAuthMiddleware<AppSession>({
  loginUrl: '/login',
  publicPaths: ['/', '/login', '/signup', '/api/auth'],
  protectedPaths: ['/dashboard', '/account', '/settings'],
  refresh: async (session: AppSession) => {
    const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });

    if (!res.ok) {
      throw new Error('Middleware token refresh rejected');
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

import { cookies } from 'next/headers';
import { getServerAuth } from 'reqix/next';
import type { Session } from 'reqix';

export interface AppUser {
  id: string;
  email: string;
  name: string;
}

export interface AppSession extends Session {
  accessToken: string;
  refreshToken?: string;
  user?: AppUser;
  [key: string]: unknown;
}

const BACKEND_URL = process.env['AUTH_BACKEND_URL'] || 'http://127.0.0.1:4000';

export function getAppAuth() {
  const cookieStore = cookies();

  return getServerAuth<AppSession>({
    cookies: cookieStore,
    refreshSession: async (session: AppSession) => {
      const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });

      if (!res.ok) {
        throw new Error(`Refresh failed with HTTP ${res.status}`);
      }

      const data = (await res.json()) as { accessToken: string; refreshToken?: string };
      return {
        ...session,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? session.refreshToken,
      };
    },
  });
}

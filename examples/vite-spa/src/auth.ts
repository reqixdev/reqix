import { createAuth, createWebLock, type Session } from 'reqix';

export interface SpaSession extends Session {
  accessToken: string;
  refreshToken?: string;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  [key: string]: unknown;
}

const STORAGE_KEY = 'reqix_spa_session';

export const auth = createAuth<SpaSession>({
  getSession: () => {
    if (typeof window === 'undefined') return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SpaSession;
    } catch {
      return null;
    }
  },
  saveSession: (session) => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
  },
  clearSession: () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  },
  lock: createWebLock(),
  enableCrossTabSync: true,
  refreshSession: async (current) => {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed with status ${res.status}`);
    }

    const data = (await res.json()) as { accessToken: string; refreshToken?: string };
    return {
      ...current,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? current.refreshToken,
    };
  },
});

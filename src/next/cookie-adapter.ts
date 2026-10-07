import type { Session } from '../auth/types.js';
import type {
  CookieAdapterOptions,
  CookieOptions,
  CookieStoreLike,
  NormalizedCookieNames,
  SessionAdapter,
} from './types.js';

const DEFAULT_COOKIE_NAMES: NormalizedCookieNames = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
  expiresAt: 'expires_at',
};

const DEFAULT_COOKIE_OPTIONS: CookieOptions = {
  path: '/',
  httpOnly: true,
  secure: typeof process !== 'undefined' && process.env['NODE_ENV'] === 'production',
  sameSite: 'lax',
};

async function resolveCookieStore(cookies: CookieAdapterOptions['cookies']): Promise<CookieStoreLike> {
  if (typeof cookies === 'function') {
    return await cookies();
  }
  return cookies;
}

/**
 * Creates a Next.js cookie session adapter compatible with `createAuth`.
 *
 * Implements safe error handling when invoked inside Server Components
 * where cookies are read-only and write calls throw errors.
 */
export function createCookieSessionAdapter<S extends Session = Session>(
  options: CookieAdapterOptions
): SessionAdapter<S> {
  const names: NormalizedCookieNames = {
    accessToken: options.names?.accessToken ?? DEFAULT_COOKIE_NAMES.accessToken,
    refreshToken: options.names?.refreshToken ?? DEFAULT_COOKIE_NAMES.refreshToken,
    expiresAt: options.names?.expiresAt ?? DEFAULT_COOKIE_NAMES.expiresAt,
  };

  const baseOptions: CookieOptions = {
    ...DEFAULT_COOKIE_OPTIONS,
    ...options.options,
  };

  return {
    async getSession(): Promise<S | null> {
      try {
        const store = await resolveCookieStore(options.cookies);
        const accessCookie = await store.get(names.accessToken);
        if (!accessCookie || !accessCookie.value) {
          return null;
        }

        const refreshCookie = await store.get(names.refreshToken);
        const expiresCookie = await store.get(names.expiresAt);

        let expiresAt: number | undefined;
        if (expiresCookie?.value) {
          const parsed = parseInt(expiresCookie.value, 10);
          if (Number.isFinite(parsed)) {
            expiresAt = parsed;
          }
        }

        const session = {
          accessToken: accessCookie.value,
          refreshToken: refreshCookie?.value ?? undefined,
          expiresAt,
        } as unknown as S;

        return session;
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[reqix] Failed to read cookies for session:', err);
        }
        return null;
      }
    },

    async saveSession(session: S): Promise<void> {
      try {
        const store = await resolveCookieStore(options.cookies);

        // Derive maxAge for access token if expiresAt is available
        let accessMaxAge = baseOptions.maxAge;
        if (session.expiresAt) {
          const remainingSec = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
          accessMaxAge = remainingSec;
        }

        await store.set(names.accessToken, session.accessToken, {
          ...baseOptions,
          maxAge: accessMaxAge,
        });

        if (session.refreshToken) {
          // Default refresh token expiry: 30 days if not explicitly configured
          const refreshMaxAge = baseOptions.maxAge ?? 30 * 24 * 60 * 60;
          await store.set(names.refreshToken, session.refreshToken, {
            ...baseOptions,
            maxAge: refreshMaxAge,
          });
        }

        if (session.expiresAt) {
          await store.set(names.expiresAt, String(session.expiresAt), {
            ...baseOptions,
            maxAge: accessMaxAge,
          });
        }
      } catch (err) {
        // Next.js throws an error when attempting to modify cookies during Server Component rendering
        if (options.onWriteBlocked) {
          try {
            options.onWriteBlocked(err);
          } catch {
            // Ignore callback errors
          }
        }
      }
    },

    async clearSession(): Promise<void> {
      try {
        const store = await resolveCookieStore(options.cookies);
        await store.delete(names.accessToken);
        await store.delete(names.refreshToken);
        await store.delete(names.expiresAt);
      } catch (err) {
        // Next.js throws when deleting cookies during Server Component render
        if (options.onWriteBlocked) {
          try {
            options.onWriteBlocked(err);
          } catch {
            // Ignore callback errors
          }
        }
      }
    },
  };
}

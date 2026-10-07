import { NextResponse } from 'next/server.js';
import type { Session } from '../auth/types.js';
import { assertSameOrigin, validateRedirectUrl } from './utils.js';
import type { CookieOptions, NormalizedCookieNames, RouteHandlerOptions } from './types.js';

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

function parseCookiesFromHeader(cookieHeader: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      // Cookie headers are untrusted input. A malformed percent escape must not
      // turn an auth endpoint into a 500 response.
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        // Ignore only the malformed cookie and continue parsing the header.
      }
    }
  }
  return result;
}

function setSessionCookies(
  res: NextResponse,
  session: Session,
  names: NormalizedCookieNames,
  cookieOpts: CookieOptions
): void {
  let accessMaxAge = cookieOpts.maxAge;
  if (session.expiresAt) {
    accessMaxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  }

  res.cookies.set(names.accessToken, session.accessToken, {
    ...cookieOpts,
    maxAge: accessMaxAge,
  });

  if (session.refreshToken) {
    const refreshMaxAge = cookieOpts.maxAge ?? 30 * 24 * 60 * 60;
    res.cookies.set(names.refreshToken, session.refreshToken, {
      ...cookieOpts,
      maxAge: refreshMaxAge,
    });
  }

  if (session.expiresAt) {
    res.cookies.set(names.expiresAt, String(session.expiresAt), {
      ...cookieOpts,
      maxAge: accessMaxAge,
    });
  }
}

function clearSessionCookies(res: NextResponse, names: NormalizedCookieNames): void {
  res.cookies.delete(names.accessToken);
  res.cookies.delete(names.refreshToken);
  res.cookies.delete(names.expiresAt);
}

/**
 * Creates route handlers for /api/auth/login, /api/auth/refresh, and /api/auth/logout.
 */
export function createAuthRouteHandlers<S extends Session = Session>(
  options: RouteHandlerOptions<S>
): {
  POST: (req: Request) => Promise<Response>;
} {
  const names: NormalizedCookieNames = {
    accessToken: options.cookieNames?.accessToken ?? DEFAULT_COOKIE_NAMES.accessToken,
    refreshToken: options.cookieNames?.refreshToken ?? DEFAULT_COOKIE_NAMES.refreshToken,
    expiresAt: options.cookieNames?.expiresAt ?? DEFAULT_COOKIE_NAMES.expiresAt,
  };

  const cookieOpts = {
    ...DEFAULT_COOKIE_OPTIONS,
    ...options.cookieOptions,
  };

  return {
    async POST(req: Request): Promise<Response> {
      // 1. CSRF Protection: Validate same-origin for state-changing requests
      if (!assertSameOrigin(req)) {
        return new Response(JSON.stringify({ error: 'Forbidden: Invalid request origin' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const url = new URL(req.url);
      const action = url.pathname.split('/').pop(); // 'login' | 'refresh' | 'logout'

      const rawCookies = parseCookiesFromHeader(req.headers.get('cookie'));
      const accessVal = rawCookies[names.accessToken];
      const refreshVal = rawCookies[names.refreshToken];
      const expiresVal = rawCookies[names.expiresAt];

      const currentSession: S | null = accessVal
        ? ({
            accessToken: accessVal,
            refreshToken: refreshVal,
            expiresAt: expiresVal ? parseInt(expiresVal, 10) : undefined,
          } as unknown as S)
        : null;

      // Handle Login
      if (action === 'login' && options.login) {
        let body: unknown = undefined;
        try {
          body = await req.json();
        } catch {
          // Empty or non-json body
        }

        try {
          const session = await options.login(body, req);
          const nextParam = url.searchParams.get('next');
          const safeRedirect = nextParam ? validateRedirectUrl(nextParam) : options.defaultRedirectUrl;

          let res: NextResponse;
          if (safeRedirect && (req.headers.get('accept') || '').includes('text/html')) {
            res = NextResponse.redirect(new URL(safeRedirect, req.url));
          } else {
            res = NextResponse.json({ ok: true, session: { ...session, accessToken: undefined, refreshToken: undefined } });
          }

          setSessionCookies(res, session, names, cookieOpts);
          return res;
        } catch (err) {
          if (options.onLoginError) {
            return options.onLoginError(err, req);
          }
          return new Response(JSON.stringify({ error: 'Login failed' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Handle Refresh
      if (action === 'refresh' && options.refresh) {
        if (!currentSession) {
          return new Response(JSON.stringify({ error: 'No active session to refresh' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        try {
          const session = await options.refresh(currentSession, req);
          const nextParam = url.searchParams.get('next');
          const safeRedirect = nextParam ? validateRedirectUrl(nextParam) : undefined;

          let res: NextResponse;
          if (safeRedirect) {
            res = NextResponse.redirect(new URL(safeRedirect, req.url));
          } else {
            res = NextResponse.json({ ok: true });
          }

          setSessionCookies(res, session, names, cookieOpts);
          return res;
        } catch (err) {
          if (options.onRefreshError) {
            return options.onRefreshError(err, req);
          }
          const res = NextResponse.json({ error: 'Refresh failed' }, { status: 401 });
          clearSessionCookies(res, names);
          return res;
        }
      }

      // Handle Logout
      if (action === 'logout') {
        try {
          if (options.logout) {
            await options.logout(currentSession, req);
          }
        } catch (err) {
          if (typeof console !== 'undefined' && console.error) {
            console.error('[reqix] Error in logout handler:', err);
          }
        }

        const nextParam = url.searchParams.get('next');
        const safeRedirect = nextParam ? validateRedirectUrl(nextParam) : options.defaultRedirectUrl;

        let res: NextResponse;
        if (safeRedirect && (req.headers.get('accept') || '').includes('text/html')) {
          res = NextResponse.redirect(new URL(safeRedirect, req.url));
        } else {
          res = NextResponse.json({ ok: true });
        }

        clearSessionCookies(res, names);
        return res;
      }

      return new Response(JSON.stringify({ error: `Not found: action ${action}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}

import { NextResponse, type NextRequest } from 'next/server.js';
import type { Session } from '../auth/types.js';
import { getSessionExpiry, isNearExpiry } from '../auth/session.js';
import type { AuthMiddlewareOptions, CookieOptions, NormalizedCookieNames } from './types.js';

const STATIC_EXTENSIONS = /\.(ico|png|jpg|jpeg|gif|svg|css|js|woff|woff2|ttf|eot|webp|avif)$/i;

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

/**
 * Matches either an exact public path or one of its path-segment descendants.
 * A plain `startsWith` would make `/login-anything` public when `/login` is
 * configured, which is especially dangerous for auth middleware.
 */
function isPublicPath(pathname: string, publicPath: string): boolean {
  const normalized = publicPath.endsWith('/') && publicPath !== '/' ? publicPath.slice(0, -1) : publicPath;
  return normalized === '/' ? pathname === '/' : pathname === normalized || pathname.startsWith(`${normalized}/`);
}

function redirectToLogin(req: NextRequest, loginUrl: string): NextResponse {
  const redirectUrl = new URL(loginUrl, req.url);
  redirectUrl.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(redirectUrl);
}

/**
 * Creates an Edge-compatible Next.js middleware that proactively validates and refreshes
 * tokens, setting updated cookies on the response AND forwarding them to downstream Server Components.
 */
export function createAuthMiddleware<S extends Session = Session>(
  options: AuthMiddlewareOptions<S>
): (req: NextRequest) => Promise<NextResponse> {
  const names: NormalizedCookieNames = {
    accessToken: options.cookieNames?.accessToken ?? DEFAULT_COOKIE_NAMES.accessToken,
    refreshToken: options.cookieNames?.refreshToken ?? DEFAULT_COOKIE_NAMES.refreshToken,
    expiresAt: options.cookieNames?.expiresAt ?? DEFAULT_COOKIE_NAMES.expiresAt,
  };

  const cookieOpts: CookieOptions = {
    ...DEFAULT_COOKIE_OPTIONS,
    ...options.cookieOptions,
  };

  const refreshBeforeSec = options.refreshBeforeExpirySec ?? 30;
  const clockSkewSec = options.clockSkewSec ?? 5;

  return async function authMiddleware(req: NextRequest): Promise<NextResponse> {
    const pathname = req.nextUrl.pathname;

    // 1. Skip Next.js internal paths and static assets
    if (
      pathname.startsWith('/_next') ||
      pathname.startsWith('/api/') ||
      pathname === '/favicon.ico' ||
      STATIC_EXTENSIONS.test(pathname)
    ) {
      return NextResponse.next();
    }

    // 2. Check custom user filter
    if (options.shouldRun && !options.shouldRun(req)) {
      return NextResponse.next();
    }

    // 3. Check public paths. They deliberately override protectedPaths.
    if (options.publicPaths && options.publicPaths.some((p) => isPublicPath(pathname, p))) {
      return NextResponse.next();
    }

    const isProtected = options.protectedPaths?.some((p) => isPublicPath(pathname, p)) ?? false;

    // 4. Read cookies from incoming request
    const accessCookie = req.cookies.get(names.accessToken);
    const refreshCookie = req.cookies.get(names.refreshToken);
    const expiresCookie = req.cookies.get(names.expiresAt);

    if (!accessCookie || !accessCookie.value) {
      // Enforce explicit protection even before a token exists. Without this,
      // `protectedPaths` in the public API would only be documentation.
      if (isProtected && options.loginUrl) {
        return redirectToLogin(req, options.loginUrl);
      }
      return NextResponse.next();
    }

    let expiresAt: number | undefined;
    if (expiresCookie?.value) {
      const parsed = parseInt(expiresCookie.value, 10);
      if (Number.isFinite(parsed)) {
        expiresAt = parsed;
      }
    }

    const currentSession = {
      accessToken: accessCookie.value,
      refreshToken: refreshCookie?.value,
      expiresAt,
    } as unknown as S;

    const expiry = getSessionExpiry(currentSession);
    const needsRefresh = isNearExpiry(expiry, refreshBeforeSec, clockSkewSec);

    if (!needsRefresh) {
      return NextResponse.next();
    }

    // 5. Token is expired or near expiry: refresh in middleware
    try {
      const freshSession = await options.refresh(currentSession);

      // Clone request headers to forward updated cookies to downstream Server Components
      const requestHeaders = new Headers(req.headers);

      // Construct updated Cookie header string
      const cookiesMap = new Map<string, string>();
      req.cookies.getAll().forEach((c) => cookiesMap.set(c.name, c.value));
      cookiesMap.set(names.accessToken, freshSession.accessToken);
      if (freshSession.refreshToken) {
        cookiesMap.set(names.refreshToken, freshSession.refreshToken);
      }
      if (freshSession.expiresAt) {
        cookiesMap.set(names.expiresAt, String(freshSession.expiresAt));
      }

      const cookieHeaderStr = Array.from(cookiesMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

      requestHeaders.set('cookie', cookieHeaderStr);

      // Create response with modified request headers
      const res = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });

      // Also set fresh cookies on the response for the browser
      let accessMaxAge = cookieOpts.maxAge;
      if (freshSession.expiresAt) {
        accessMaxAge = Math.max(0, Math.floor((freshSession.expiresAt - Date.now()) / 1000));
      }

      res.cookies.set(names.accessToken, freshSession.accessToken, {
        ...cookieOpts,
        maxAge: accessMaxAge,
      });

      if (freshSession.refreshToken) {
        const refreshMaxAge = cookieOpts.maxAge ?? 30 * 24 * 60 * 60;
        res.cookies.set(names.refreshToken, freshSession.refreshToken, {
          ...cookieOpts,
          maxAge: refreshMaxAge,
        });
      }

      if (freshSession.expiresAt) {
        res.cookies.set(names.expiresAt, String(freshSession.expiresAt), {
          ...cookieOpts,
          maxAge: accessMaxAge,
        });
      }

      return res;
    } catch (refreshErr) {
      // 6. Refresh failed: clear cookies and redirect/handle error
      if (options.onRefreshError) {
        const customRes = await options.onRefreshError(refreshErr, req);
        customRes.cookies.delete(names.accessToken);
        customRes.cookies.delete(names.refreshToken);
        customRes.cookies.delete(names.expiresAt);
        return customRes;
      }

      if (options.loginUrl) {
        const res = redirectToLogin(req, options.loginUrl);
        res.cookies.delete(names.accessToken);
        res.cookies.delete(names.refreshToken);
        res.cookies.delete(names.expiresAt);
        return res;
      }

      const res = NextResponse.next();
      res.cookies.delete(names.accessToken);
      res.cookies.delete(names.refreshToken);
      res.cookies.delete(names.expiresAt);
      return res;
    }
  };
}

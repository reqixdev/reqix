import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server.js';
import { createAuthMiddleware } from '../../src/next/middleware.js';

describe('Next.js Auth Middleware', () => {
  it('skips static assets and internal Next.js paths', async () => {
    const refreshSpy = vi.fn();
    const middleware = createAuthMiddleware({
      refresh: refreshSpy,
    });

    const staticReq = new NextRequest('https://example.com/_next/static/chunk.js');
    const res = await middleware(staticReq);

    expect(res.status).toBe(200);
    expect(refreshSpy).not.toHaveBeenCalled();

    const iconReq = new NextRequest('https://example.com/favicon.ico');
    await middleware(iconReq);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('skips configurable public paths', async () => {
    const refreshSpy = vi.fn();
    const middleware = createAuthMiddleware({
      refresh: refreshSpy,
      publicPaths: ['/public', '/login'],
    });

    const req = new NextRequest('https://example.com/public/about');
    await middleware(req);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('does not treat similarly prefixed paths as public', async () => {
    const refreshSpy = vi.fn();
    const middleware = createAuthMiddleware({
      refresh: refreshSpy,
      publicPaths: ['/login'],
    });

    const req = new NextRequest('https://example.com/login-private', {
      headers: { cookie: 'access_token=expired-token; expires_at=1000' },
    });
    await middleware(req);

    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  it('redirects unauthenticated requests on configured protected paths', async () => {
    const middleware = createAuthMiddleware({
      refresh: vi.fn(),
      loginUrl: '/login',
      protectedPaths: ['/dashboard'],
    });

    const res = await middleware(new NextRequest('https://example.com/dashboard/settings?tab=profile'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Fdashboard%2Fsettings%3Ftab%3Dprofile');
  });

  it('does not protect similarly prefixed paths', async () => {
    const middleware = createAuthMiddleware({
      refresh: vi.fn(),
      loginUrl: '/login',
      protectedPaths: ['/dashboard'],
    });

    const res = await middleware(new NextRequest('https://example.com/dashboard-preview'));

    expect(res.status).toBe(200);
  });

  it('refreshes expired token, sets response cookies, and forwards to downstream request headers', async () => {
    const middleware = createAuthMiddleware({
      refresh: async () => ({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: Date.now() + 60_000,
      }),
    });

    const req = new NextRequest('https://example.com/dashboard', {
      headers: {
        cookie: 'access_token=expired-token; expires_at=1000',
      },
    });

    const res = await middleware(req);

    // 1. Response cookies set for browser
    const setCookies = res.cookies.getAll();
    expect(setCookies.some((c) => c.name === 'access_token' && c.value === 'new-access-token')).toBe(true);
    expect(setCookies.some((c) => c.name === 'refresh_token' && c.value === 'new-refresh-token')).toBe(true);

    // 2. Modified request headers forwarded downstream to Server Components
    expect(res.headers.has('x-middleware-override-headers')).toBe(true);
  });

  it('clears cookies and redirects on refresh failure when loginUrl is specified', async () => {
    const middleware = createAuthMiddleware({
      refresh: async () => {
        throw new Error('Refresh revoked');
      },
      loginUrl: '/login',
    });

    const req = new NextRequest('https://example.com/protected-page', {
      headers: {
        cookie: 'access_token=revoked-token; expires_at=1000',
      },
    });

    const res = await middleware(req);

    expect(res.status).toBe(307); // NextResponse.redirect
    expect(res.headers.get('location')).toContain('/login?next=%2Fprotected-page');

    // Cleared cookies
    const clearedCookies = res.cookies.getAll();
    expect(clearedCookies.some((c) => c.name === 'access_token' && (c.value === '' || c.maxAge === 0))).toBe(true);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createAuthRouteHandlers } from '../../src/next/route-handlers.js';
import { validateRedirectUrl, assertSameOrigin } from '../../src/next/utils.js';

describe('Next.js Route Handlers & Security Utils', () => {
  describe('Open Redirect Protection', () => {
    it('accepts safe relative paths', () => {
      expect(validateRedirectUrl('/dashboard')).toBe('/dashboard');
      expect(validateRedirectUrl('/settings/profile?tab=1')).toBe('/settings/profile?tab=1');
    });

    it('rejects protocol-relative URLs (//evil.com)', () => {
      expect(validateRedirectUrl('//evil.com')).toBe('/');
      expect(validateRedirectUrl('/\\evil.com')).toBe('/');
    });

    it('rejects dangerous URI schemes', () => {
      expect(validateRedirectUrl('javascript:alert(1)')).toBe('/');
      expect(validateRedirectUrl('data:text/html,...')).toBe('/');
    });

    it('rejects external absolute URLs', () => {
      expect(validateRedirectUrl('https://evil.com/phish')).toBe('/');
    });
  });

  describe('Same Origin Assertion (CSRF)', () => {
    it('returns true when Origin matches Host', () => {
      const req = new Request('https://app.example.com/api/auth/login', {
        headers: {
          host: 'app.example.com',
          origin: 'https://app.example.com',
        },
      });
      expect(assertSameOrigin(req)).toBe(true);
    });

    it('returns false when Origin does not match Host', () => {
      const req = new Request('https://app.example.com/api/auth/login', {
        headers: {
          host: 'app.example.com',
          origin: 'https://attacker.com',
        },
      });
      expect(assertSameOrigin(req)).toBe(false);
    });
  });

  describe('Route Handlers', () => {
    it('does not crash on a malformed cookie escape sequence', async () => {
      const handlers = createAuthRouteHandlers({ logout: vi.fn() });
      const req = new Request('https://app.example.com/api/auth/logout', {
        method: 'POST',
        headers: {
          host: 'app.example.com',
          origin: 'https://app.example.com',
          cookie: 'access_token=%E0%A4%A',
        },
      });

      await expect(handlers.POST(req)).resolves.toHaveProperty('status', 200);
    });

    it('rejects requests from untrusted origins with 403', async () => {
      const handlers = createAuthRouteHandlers({
        login: vi.fn(),
      });

      const req = new Request('https://app.example.com/api/auth/login', {
        method: 'POST',
        headers: {
          host: 'app.example.com',
          origin: 'https://malicious.com',
        },
      });

      const res = await handlers.POST(req);
      expect(res.status).toBe(403);
    });

    it('login sets cookies and returns ok JSON', async () => {
      const handlers = createAuthRouteHandlers({
        login: async () => ({
          accessToken: 'login-acc',
          refreshToken: 'login-ref',
          expiresAt: Date.now() + 60_000,
        }),
      });

      const req = new Request('https://app.example.com/api/auth/login', {
        method: 'POST',
        headers: {
          host: 'app.example.com',
          origin: 'https://app.example.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ username: 'user', password: 'pass' }),
      });

      const res = await handlers.POST(req);
      expect(res.status).toBe(200);

      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie).toContain('access_token=login-acc');
      expect(setCookie).toContain('HttpOnly');
    });

    it('logout clears cookies', async () => {
      const handlers = createAuthRouteHandlers({
        logout: vi.fn(),
      });

      const req = new Request('https://app.example.com/api/auth/logout', {
        method: 'POST',
        headers: {
          host: 'app.example.com',
          origin: 'https://app.example.com',
          cookie: 'access_token=token-to-clear',
        },
      });

      const res = await handlers.POST(req);
      expect(res.status).toBe(200);

      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie).toContain('access_token=;');
    });
  });
});

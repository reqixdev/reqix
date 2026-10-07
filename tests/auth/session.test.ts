import { describe, it, expect } from 'vitest';
import { decodeJwtExp, isNearExpiry, getSessionExpiry, isValidSession } from '../../src/auth/session.js';

describe('Auth Session Utilities', () => {
  describe('decodeJwtExp', () => {
    it('decodes exp claim from a valid JWT', () => {
      // payload: { "sub": "123", "exp": 1893456000 } -> 2030-01-01
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: '123', exp: 1893456000 })).toString('base64url');
      const token = `${header}.${payload}.signature`;

      const expMs = decodeJwtExp(token);
      expect(expMs).toBe(1893456000 * 1000);
    });

    it('returns null on invalid or non-JWT strings', () => {
      expect(decodeJwtExp('not-a-token')).toBeNull();
      expect(decodeJwtExp('a.b')).toBeNull();
      expect(decodeJwtExp('a.not_json.c')).toBeNull();
    });

    it('returns null if exp is missing or not a number', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: '123' })).toString('base64url');
      const token = `${header}.${payload}.sig`;

      expect(decodeJwtExp(token)).toBeNull();
    });
  });

  describe('isNearExpiry', () => {
    it('returns true when current time is past expiry', () => {
      const pastTime = Date.now() - 5000;
      expect(isNearExpiry(pastTime, 30, 5)).toBe(true);
    });

    it('returns true within threshold (30s + 5s = 35s)', () => {
      const nearFuture = Date.now() + 20_000; // 20s in future
      expect(isNearExpiry(nearFuture, 30, 5)).toBe(true);
    });

    it('returns false when well into the future', () => {
      const farFuture = Date.now() + 60_000; // 60s in future
      expect(isNearExpiry(farFuture, 30, 5)).toBe(false);
    });

    it('returns false for null or undefined', () => {
      expect(isNearExpiry(null)).toBe(false);
      expect(isNearExpiry(undefined)).toBe(false);
    });
  });

  describe('getSessionExpiry', () => {
    it('uses session.expiresAt if explicitly provided', () => {
      const session = { accessToken: 'xyz', expiresAt: 1700000000000 };
      expect(getSessionExpiry(session)).toBe(1700000000000);
    });

    it('falls back to JWT exp decode when expiresAt is not provided', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ exp: 1750000000 })).toString('base64url');
      const token = `${header}.${payload}.sig`;

      const session = { accessToken: token };
      expect(getSessionExpiry(session)).toBe(1750000000 * 1000);
    });
  });

  describe('isValidSession', () => {
    it('validates correct session objects', () => {
      expect(isValidSession({ accessToken: 'valid-token' })).toBe(true);
      expect(isValidSession({ accessToken: 'valid-token', refreshToken: 'ref' })).toBe(true);
    });

    it('rejects invalid sessions', () => {
      expect(isValidSession(null)).toBe(false);
      expect(isValidSession({})).toBe(false);
      expect(isValidSession({ accessToken: '' })).toBe(false);
      expect(isValidSession({ accessToken: '   ' })).toBe(false);
      expect(isValidSession({ accessToken: 123 })).toBe(false);
    });
  });
});

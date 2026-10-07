import type { Session } from './types.js';

/**
 * Safely decodes base64url string across browser, Node, and Edge runtimes.
 */
function base64UrlDecode(str: string): string {
  // Replace base64url characters with base64 characters
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if missing
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  if (typeof atob === 'function') {
    return atob(base64);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('binary');
  }

  throw new Error('No base64 decoder available');
}

/**
 * Decodes the `exp` claim from a JWT without verifying the signature.
 *
 * NOTE: This function does NOT perform cryptographic verification!
 * It is solely used to read expiration time for proactive refresh heuristics.
 *
 * @param token JWT string
 * @returns Expiration time in epoch milliseconds, or null if missing/invalid
 */
export function decodeJwtExp(token: string): number | null {
  if (typeof token !== 'string') return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payloadRaw = parts[1];
    if (!payloadRaw) {
      return null;
    }

    const decoded = base64UrlDecode(payloadRaw);
    const parsed = JSON.parse(decoded) as Record<string, unknown>;

    if (typeof parsed['exp'] === 'number' && Number.isFinite(parsed['exp'])) {
      // JWT exp claim is in seconds; convert to epoch milliseconds
      return parsed['exp'] * 1000;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Checks if a session or expiration timestamp is expired or within the proactive refresh window.
 *
 * @param expiresAt Epoch milliseconds when the token expires
 * @param refreshBeforeExpirySec Proactive threshold in seconds (default 30)
 * @param clockSkewSec Permitted clock skew allowance in seconds (default 5)
 */
export function isNearExpiry(
  expiresAt: number | null | undefined,
  refreshBeforeExpirySec = 30,
  clockSkewSec = 5
): boolean {
  if (expiresAt === null || expiresAt === undefined || !Number.isFinite(expiresAt)) {
    return false;
  }

  const thresholdMs = (refreshBeforeExpirySec + clockSkewSec) * 1000;
  return expiresAt - Date.now() <= thresholdMs;
}

/**
 * Resolves the expiration timestamp (epoch ms) from a session.
 * Uses session.expiresAt if defined; otherwise attempts to decode JWT `exp` from accessToken.
 */
export function getSessionExpiry(session: Session): number | undefined {
  if (typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt)) {
    return session.expiresAt;
  }

  const jwtExp = decodeJwtExp(session.accessToken);
  if (jwtExp !== null) {
    return jwtExp;
  }

  return undefined;
}

/**
 * Validates that an object conforms to the minimum required Session contract.
 * A session must have a non-empty string `accessToken`.
 */
export function isValidSession(session: unknown): session is Session {
  if (typeof session !== 'object' || session === null) {
    return false;
  }

  const candidate = session as Record<string, unknown>;
  return typeof candidate['accessToken'] === 'string' && candidate['accessToken'].trim().length > 0;
}

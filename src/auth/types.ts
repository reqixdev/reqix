import type { HttpClient } from '../core/http-client.js';
import type { RequestConfig } from '../core/types.js';

export interface Session {
  accessToken: string;
  refreshToken?: string | undefined;
  /** epoch ms. If missing, library tries to read `exp` from a JWT access token (decode only, never verify). */
  expiresAt?: number | undefined;
  [key: string]: unknown;
}

export type LogoutReason = 'manual' | 'refresh_failed' | 'unauthorized';

export interface RefreshLock {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export interface AuthOptions<S extends Session = Session> {
  // ---- user-owned callbacks (all may be sync or async) ----
  getSession: () => S | null | undefined | Promise<S | null | undefined>;
  saveSession: (session: S) => void | Promise<void>;
  clearSession: () => void | Promise<void>;
  /** User calls THEIR backend here and returns the new session. Throw to signal failure. */
  refreshSession: (current: S) => S | Promise<S>;

  // ---- optional user hooks ----
  onLogout?: ((reason: LogoutReason) => void | Promise<void>) | undefined;
  onRefreshError?: ((error: unknown) => void) | undefined;
  onSessionChange?: ((session: S | null) => void) | undefined;
  attachToken?: ((headers: Headers, session: S) => void) | undefined;
  shouldRefreshOnResponse?: ((res: Response) => boolean) | undefined;
  shouldSkip?: ((url: string, init?: RequestInit) => boolean) | undefined;

  // ---- behavior knobs (safe defaults) ----
  baseURL?: string | undefined;
  refreshBeforeExpirySec?: number | undefined; // default 30
  clockSkewSec?: number | undefined; // default 5
  maxRefreshAttemptsPerRequest?: number | undefined; // default 1
  fetch?: typeof fetch | undefined;
  http?: Partial<RequestConfig> | undefined;
  lock?: RefreshLock | undefined;
  /** Enable cross-tab BroadcastChannel session synchronization in browser (default: true if available) */
  enableCrossTabSync?: boolean | undefined;
}

export interface Auth<S extends Session = Session> {
  fetch(input: RequestInfo | URL, init?: RequestInit & { skipAuth?: boolean | undefined }): Promise<Response>;
  client: HttpClient;
  getSession(): Promise<S | null>;
  setSession(session: S): Promise<void>;
  refresh(): Promise<S>;
  logout(opts?: { reason?: LogoutReason | undefined }): Promise<void>;
  subscribe(fn: (session: S | null) => void): () => void;
  isAuthenticated(): Promise<boolean>;
}

export type AuthErrorCode = 'REFRESH_FAILED' | 'UNAUTHORIZED' | 'INVALID_SESSION';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly isAuthError = true;
  readonly cause?: unknown;

  constructor(code: AuthErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return typeof error === 'object' && error !== null && (error as AuthError).isAuthError === true;
}

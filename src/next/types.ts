import type { NextRequest, NextResponse } from 'next/server.js';
import type { Session, AuthOptions } from '../auth/types.js';

export interface CookieNamesConfig {
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  expiresAt?: string | undefined;
}

export interface NormalizedCookieNames {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface CookieOptions {
  path?: string | undefined;
  domain?: string | undefined;
  maxAge?: number | undefined; // seconds
  expires?: Date | undefined;
  httpOnly?: boolean | undefined;
  secure?: boolean | undefined;
  sameSite?: 'lax' | 'strict' | 'none' | boolean | undefined;
}

export interface CookieStoreLike {
  get(name: string): { name: string; value: string } | undefined | Promise<{ name: string; value: string } | undefined>;
  set(name: string, value: string, options?: CookieOptions): void | Promise<void> | unknown;
  delete(name: string): void | Promise<void> | unknown;
}

export type CookieGetter = () => CookieStoreLike | Promise<CookieStoreLike>;

export interface CookieAdapterOptions {
  cookies: CookieStoreLike | CookieGetter;
  names?: CookieNamesConfig | undefined;
  options?: CookieOptions | undefined;
  onWriteBlocked?: ((error: unknown) => void) | undefined;
}

export interface SessionAdapter<S extends Session = Session> {
  getSession: () => Promise<S | null>;
  saveSession: (session: S) => Promise<void>;
  clearSession: () => Promise<void>;
}

export interface AuthMiddlewareOptions<S extends Session = Session> {
  refresh: (session: S) => S | Promise<S>;
  cookieNames?: CookieNamesConfig | undefined;
  cookieOptions?: CookieOptions | undefined;
  shouldRun?: ((req: NextRequest) => boolean) | undefined;
  publicPaths?: string[] | undefined;
  /** Routes that require an access-token cookie. Requires `loginUrl` to redirect unauthenticated users. */
  protectedPaths?: string[] | undefined;
  loginUrl?: string | undefined;
  onRefreshError?: ((error: unknown, req: NextRequest) => NextResponse | Promise<NextResponse>) | undefined;
  refreshBeforeExpirySec?: number | undefined;
  clockSkewSec?: number | undefined;
}

export interface RouteHandlerOptions<S extends Session = Session> {
  login?: ((body: unknown, req: Request) => S | Promise<S>) | undefined;
  refresh?: ((current: S, req: Request) => S | Promise<S>) | undefined;
  logout?: ((current: S | null, req: Request) => void | Promise<void>) | undefined;
  cookieNames?: CookieNamesConfig | undefined;
  cookieOptions?: CookieOptions | undefined;
  defaultRedirectUrl?: string | undefined;
  onLoginError?: ((error: unknown, req: Request) => Response | Promise<Response>) | undefined;
  onRefreshError?: ((error: unknown, req: Request) => Response | Promise<Response>) | undefined;
}

export interface ServerAuthOptions<S extends Session = Session> extends Omit<AuthOptions<S>, 'getSession' | 'saveSession' | 'clearSession'> {
  cookies: CookieStoreLike | CookieGetter;
  cookieNames?: CookieNamesConfig | undefined;
  cookieOptions?: CookieOptions | undefined;
  onWriteBlocked?: ((error: unknown) => void) | undefined;
}

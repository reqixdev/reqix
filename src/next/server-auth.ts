import * as React from 'react';
import { createAuth } from '../auth/create-auth.js';
import { createCookieSessionAdapter } from './cookie-adapter.js';
import type { Session, Auth } from '../auth/types.js';
import type { ServerAuthOptions } from './types.js';

/**
 * Creates a per-request cached Auth instance for Next.js Server Components.
 * Wrapped in React's `cache()` to share state and deduplicate token refreshes
 * across multiple Server Components rendered in the same request.
 */
export function createServerAuthFactory<S extends Session = Session>(
  options: ServerAuthOptions<S>
): () => Auth<S> {
  const factory = (): Auth<S> => {
    const adapter = createCookieSessionAdapter<S>({
      cookies: options.cookies,
      names: options.cookieNames,
      options: options.cookieOptions,
      onWriteBlocked: options.onWriteBlocked,
    });

    return createAuth<S>({
      ...options,
      getSession: adapter.getSession,
      saveSession: adapter.saveSession,
      clearSession: adapter.clearSession,
    });
  };

  // In Next.js RSC runtime, React.cache is available. In unit tests / client bundles, fall back safely.
  const reactCache = (React as unknown as { cache?: <T extends (...args: unknown[]) => unknown>(fn: T) => T }).cache;
  if (typeof reactCache === 'function') {
    return reactCache(factory) as () => Auth<S>;
  }

  let cachedInstance: Auth<S> | null = null;
  return () => {
    if (!cachedInstance) {
      cachedInstance = factory();
    }
    return cachedInstance;
  };
}

/**
 * Convenience helper to instantiate an Auth instance from cookies and server options.
 */
export function getServerAuth<S extends Session = Session>(
  options: ServerAuthOptions<S>
): Auth<S> {
  const adapter = createCookieSessionAdapter<S>({
    cookies: options.cookies,
    names: options.cookieNames,
    options: options.cookieOptions,
    onWriteBlocked: options.onWriteBlocked,
  });

  return createAuth<S>({
    ...options,
    getSession: adapter.getSession,
    saveSession: adapter.saveSession,
    clearSession: adapter.clearSession,
  });
}

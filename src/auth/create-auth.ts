import { createHttpClient } from '../core/http-client.js';
import type { RequestConfig, InternalRequestConfig } from '../core/types.js';
import { HttpError } from '../core/errors.js';
import {
  Auth,
  AuthError,
  AuthOptions,
  LogoutReason,
  Session,
} from './types.js';
import { SingleFlight } from './single-flight.js';
import { EventEmitter } from './events.js';
import { createWebLock, CrossTabSync } from './locks.js';
import { getSessionExpiry, isNearExpiry, isValidSession } from './session.js';

/**
 * Public fetch helper for unauthenticated, shared or cacheable data.
 */
export async function publicFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return globalThis.fetch(input, init);
}

/**
 * Creates a headless auth coordinator instance.
 *
 * The library manages concurrency, proactive/reactive refreshes, retry loops,
 * and cancellation, while delegating storage and token exchange to user-supplied callbacks.
 */
export function createAuth<S extends Session = Session>(options: AuthOptions<S>): Auth<S> {
  const refreshBeforeExpirySec = options.refreshBeforeExpirySec ?? 30;
  const clockSkewSec = options.clockSkewSec ?? 5;
  const maxRefreshAttempts = options.maxRefreshAttemptsPerRequest ?? 1;
  const lock = options.lock ?? createWebLock();
  const fetchFn = options.fetch ?? globalThis.fetch;

  const defaultAttachToken = (headers: Headers, session: S) => {
    headers.set('authorization', `Bearer ${session.accessToken}`);
  };
  const attachToken = options.attachToken ?? defaultAttachToken;

  const defaultShouldRefresh = (res: Response) => res.status === 401;
  const shouldRefreshOnResponse = options.shouldRefreshOnResponse ?? defaultShouldRefresh;

  // Single-flight coordinator for refresh operations
  const refreshFlight = new SingleFlight<S>();

  // Event subscribers for session changes
  const sessionEmitter = new EventEmitter<S | null>();

  // In-flight AbortControllers registry for immediate cancellation on logout
  const activeControllers = new Set<AbortController>();

  // Monotonic generation counter to prevent race conditions during logout / setSession
  let generation = 0;

  // Optional cross-tab broadcaster in browser environments
  let crossTab: CrossTabSync<S> | null = null;
  if (options.enableCrossTabSync !== false) {
    crossTab = new CrossTabSync<S>('reqix_auth_sync', (msg) => {
      if (msg.type === 'logout') {
        sessionEmitter.emit(null);
        if (options.onSessionChange) {
          options.onSessionChange(null);
        }
      } else if (msg.type === 'session_change' && msg.payload) {
        sessionEmitter.emit(msg.payload);
        if (options.onSessionChange) {
          options.onSessionChange(msg.payload);
        }
      }
    });
  }

  /**
   * Safe logout sequence guaranteeing step isolation.
   */
  async function performLogout(reason: LogoutReason): Promise<void> {
    // Increment generation to invalidate any currently executing refresh operations
    generation++;

    // 1. Abort all in-flight requests started through this auth instance
    for (const controller of activeControllers) {
      try {
        controller.abort('Auth logged out');
      } catch {
        // Ignore controller abort errors
      }
    }
    activeControllers.clear();

    // 2. Reset the refresh promise
    refreshFlight.reset();

    // 3. Clear session storage
    try {
      await options.clearSession();
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[reqix] Error in clearSession during logout:', err);
      }
    }

    // 4. Emit onSessionChange(null) + notify subscribers
    try {
      sessionEmitter.emit(null);
      if (options.onSessionChange) {
        options.onSessionChange(null);
      }
      crossTab?.post('logout');
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[reqix] Error notifying session listeners:', err);
      }
    }

    // 5. Invoke onLogout callback
    try {
      if (options.onLogout) {
        await options.onLogout(reason);
      }
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[reqix] Error in onLogout callback:', err);
      }
    }
  }

  /**
   * Performs single-flight token refresh across parallel requests and cross-tab lock.
   */
  async function executeRefresh(triggeredBySession?: S): Promise<S> {
    return refreshFlight.do(async () => {
      const startGen = generation;

      return lock.run('reqix-refresh-lock', async () => {
        // Re-read session after acquiring the lock to check if another tab refreshed
        const latest = await options.getSession();
        if (latest) {
          const exp = getSessionExpiry(latest);
          // If triggered by a specific stale session, check if a newer session is already stored
          if (triggeredBySession) {
            if (latest.accessToken !== triggeredBySession.accessToken && !isNearExpiry(exp, refreshBeforeExpirySec, clockSkewSec)) {
              return latest;
            }
          } else {
            // Proactive refresh: if no longer near expiry, skip refresh
            if (!isNearExpiry(exp, refreshBeforeExpirySec, clockSkewSec)) {
              return latest;
            }
          }
        }

        const currentSession = latest || (await options.getSession());
        if (!currentSession) {
          const err = new AuthError('UNAUTHORIZED', 'No existing session available to refresh');
          await handleRefreshFailure(err);
          throw err;
        }

        let newSession: S;
        try {
          newSession = await options.refreshSession(currentSession);
        } catch (err) {
          const authErr = new AuthError('REFRESH_FAILED', 'Failed to refresh session', err);
          await handleRefreshFailure(authErr);
          throw authErr;
        }

        if (!isValidSession(newSession)) {
          const authErr = new AuthError(
            'INVALID_SESSION',
            'Session returned from refreshSession is missing a valid accessToken'
          );
          await handleRefreshFailure(authErr);
          throw authErr;
        }

        // Check generation: if logout() or setSession() happened during refresh, discard result
        if (startGen !== generation) {
          const staleErr = new AuthError(
            'REFRESH_FAILED',
            'Refresh result was discarded due to concurrent session change or logout'
          );
          throw staleErr;
        }

        // Persist fresh session
        try {
          await options.saveSession(newSession);
        } catch (saveErr) {
          if (typeof console !== 'undefined' && console.error) {
            console.error('[reqix] Error saving refreshed session:', saveErr);
          }
        }

        // Notify listeners
        sessionEmitter.emit(newSession);
        if (options.onSessionChange) {
          options.onSessionChange(newSession);
        }
        crossTab?.post('session_change', newSession);

        return newSession;
      });
    });
  }

  async function handleRefreshFailure(error: AuthError): Promise<void> {
    if (options.onRefreshError) {
      try {
        options.onRefreshError(error);
      } catch (cbErr) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[reqix] Error in onRefreshError callback:', cbErr);
        }
      }
    }
    await performLogout('refresh_failed');
  }

  /**
   * Pre-request check: proactive refresh if token is missing or near expiry.
   */
  async function ensureFreshSession(): Promise<S | null> {
    const session = await options.getSession();
    if (!session) {
      return null;
    }

    const expiry = getSessionExpiry(session);
    if (isNearExpiry(expiry, refreshBeforeExpirySec, clockSkewSec)) {
      return executeRefresh();
    }

    return session;
  }

  // --- Initialize underlying HttpClient ---
  const clientConfig: RequestConfig = {
    baseURL: options.baseURL,
    fetch: fetchFn,
    cache: 'no-store', // Cache safety default
    ...options.http,
  };

  const client = createHttpClient(clientConfig);

  // Hook 1: Before each attempt, attach fresh token and check proactive expiry
  client.defaults._beforeAttempt = async (config: InternalRequestConfig) => {
    if (config.skipAuth) {
      return;
    }

    if (options.shouldSkip && options.shouldSkip(config.url)) {
      return;
    }

    const session = await ensureFreshSession();
    if (session) {
      attachToken(config.headers, session);
      // Track which accessToken was attached for stale 401 detection
      config._sentWithToken = session.accessToken;
    }
  };

  // Hook 2: On response error, check reactive refresh (e.g. 401)
  client.defaults._onResponseError = async (error: unknown, config: InternalRequestConfig) => {
    if (!(error instanceof HttpError) || !error.response) {
      return;
    }

    if (config.skipAuth || (options.shouldSkip && options.shouldSkip(config.url))) {
      return;
    }

    if (!shouldRefreshOnResponse(error.response)) {
      return;
    }

    const currentAttempts = config._authRetryCount ?? 0;
    if (currentAttempts >= maxRefreshAttempts) {
      return; // Prevent infinite loop
    }

    // Stale 401 protection:
    // If token was already refreshed by another request while this request was in flight,
    // retry immediately with latest session without refreshing again!
    const sentToken = config._sentWithToken;
    const latest = await options.getSession();

    let freshSession: S;
    if (latest && sentToken && latest.accessToken !== sentToken) {
      freshSession = latest;
    } else {
      freshSession = await executeRefresh(latest ?? undefined);
    }

    // Retry request with fresh token
    const retryConfig: InternalRequestConfig = {
      ...config,
      _authRetryCount: currentAttempts + 1,
      _authAttempted: true,
      _sentWithToken: freshSession.accessToken,
    };
    attachToken(retryConfig.headers, freshSession);

    return client.request(retryConfig);
  };

  // --- auth.fetch implementation ---
  async function authFetch(
    input: RequestInfo | URL,
    init?: RequestInit & { skipAuth?: boolean | undefined }
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const shouldSkip = init?.skipAuth || (options.shouldSkip && options.shouldSkip(url, init));

    // Create coordinated AbortController so logout can cancel this fetch
    const authController = new AbortController();
    activeControllers.add(authController);

    const onUserAbort = () => {
      authController.abort(init?.signal?.reason);
    };

    if (init?.signal) {
      if (init.signal.aborted) {
        authController.abort(init.signal.reason);
      } else {
        init.signal.addEventListener('abort', onUserAbort, { once: true });
      }
    }

    try {
      let headers = new Headers(init?.headers);

      let sentWithToken: string | undefined;
      if (!shouldSkip) {
        const session = await ensureFreshSession();
        if (session) {
          attachToken(headers, session);
          sentWithToken = session.accessToken;
        }
      }

      // Default cache: 'no-store' unless caller passed explicit cache or next
      const requestInit: RequestInit = {
        cache: 'no-store',
        ...init,
        headers,
        signal: authController.signal,
      };

      if (authController.signal.aborted) {
        throw new Error('Request aborted: Auth logged out');
      }

      let response = await fetchFn(input, requestInit);

      // Reactive refresh check
      if (!shouldSkip && shouldRefreshOnResponse(response)) {
        let freshSession: S;
        const latest = await options.getSession();
        if (latest && sentWithToken && latest.accessToken !== sentWithToken) {
          freshSession = latest;
        } else {
          freshSession = await executeRefresh(latest ?? undefined);
        }

        // Retry once with new token
        headers = new Headers(init?.headers);
        attachToken(headers, freshSession);
        const retryInit: RequestInit = {
          ...requestInit,
          headers,
        };
        response = await fetchFn(input, retryInit);
      }

      return response;
    } finally {
      activeControllers.delete(authController);
      if (init?.signal) {
        init.signal.removeEventListener('abort', onUserAbort);
      }
    }
  }

  return {
    fetch: authFetch,
    client,
    async getSession(): Promise<S | null> {
      const s = await options.getSession();
      return s ?? null;
    },
    async setSession(session: S): Promise<void> {
      if (!isValidSession(session)) {
        throw new AuthError('INVALID_SESSION', 'Cannot set invalid session');
      }
      generation++;
      await options.saveSession(session);
      sessionEmitter.emit(session);
      if (options.onSessionChange) {
        options.onSessionChange(session);
      }
      crossTab?.post('session_change', session);
    },
    async refresh(): Promise<S> {
      return executeRefresh();
    },
    async logout(opts?: { reason?: LogoutReason | undefined }): Promise<void> {
      await performLogout(opts?.reason ?? 'manual');
    },
    subscribe(fn: (session: S | null) => void): () => void {
      return sessionEmitter.subscribe(fn);
    },
    async isAuthenticated(): Promise<boolean> {
      const session = await options.getSession();
      return Boolean(session && isValidSession(session));
    },
  };
}

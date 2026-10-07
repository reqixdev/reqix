import { useState, useEffect } from 'react';
import type { Session, Auth } from '../auth/types.js';

export interface UseSessionResult<S extends Session = Session> {
  session: S | null;
  loading: boolean;
  isAuthenticated: boolean;
}

/**
 * React hook to observe session state changes from an Auth instance.
 * Automatically synchronizes with logins, logouts, refreshes, and cross-tab events.
 */
export function useSession<S extends Session = Session>(auth: Auth<S>): UseSessionResult<S> {
  const [session, setSession] = useState<S | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // 1. Fetch initial session
    auth
      .getSession()
      .then((initial) => {
        if (isMounted) {
          setSession(initial);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSession(null);
          setLoading(false);
        }
      });

    // 2. Subscribe to subsequent session updates
    const unsubscribe = auth.subscribe((updated) => {
      if (isMounted) {
        setSession(updated);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [auth]);

  return {
    session,
    loading,
    isAuthenticated: Boolean(session && session.accessToken),
  };
}

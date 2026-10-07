import { useState, useEffect } from 'react';
import type { Auth, Session } from 'reqix';

export interface UseSessionReturn<S extends Session = Session> {
  session: S | null;
  loading: boolean;
  isAuthenticated: boolean;
}

/**
 * React hook that subscribes to a reqix Auth instance.
 */
export function useSession<S extends Session = Session>(auth: Auth<S>): UseSessionReturn<S> {
  const [session, setSession] = useState<S | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;

    // Load initial session
    auth
      .getSession()
      .then((s) => {
        if (mounted) {
          setSession(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setSession(null);
          setLoading(false);
        }
      });

    // Subscribe to session mutations (refresh, logout, setSession)
    const unsubscribe = auth.subscribe((s) => {
      if (mounted) {
        setSession(s);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [auth]);

  return {
    session,
    loading,
    isAuthenticated: session !== null,
  };
}

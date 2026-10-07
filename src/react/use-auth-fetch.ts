import { useCallback } from 'react';
import type { Session, Auth } from '../auth/types.js';

/**
 * React hook returning a stable authenticated fetch function.
 */
export function useAuthFetch<S extends Session = Session>(
  auth: Auth<S>
): (input: RequestInfo | URL, init?: RequestInit & { skipAuth?: boolean | undefined }) => Promise<Response> {
  return useCallback(
    (input: RequestInfo | URL, init?: RequestInit & { skipAuth?: boolean | undefined }) => {
      return auth.fetch(input, init);
    },
    [auth]
  );
}

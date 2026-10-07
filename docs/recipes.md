# Integration Recipes 🍲

Practical patterns for integrating `reqix` with popular backends, storage layers, and state management libraries.

---

## 1. Custom Storage Adapters

### Recipe: Redis / Database-Backed Server Sessions (Node.js)
If you run a Node.js API server or SSR server that keeps user sessions in Redis:

```typescript
import { createAuth, type Session } from 'reqix';
import type { Redis } from 'ioredis';

export function createRedisAuth(redis: Redis, sessionId: string) {
  return createAuth({
    getSession: async () => {
      const raw = await redis.get(`session:${sessionId}`);
      return raw ? JSON.parse(raw) : null;
    },
    saveSession: async (session) => {
      await redis.set(`session:${sessionId}`, JSON.stringify(session), 'EX', 7 * 86400);
    },
    clearSession: async () => {
      await redis.del(`session:${sessionId}`);
    },
    refreshSession: async (current) => {
      const res = await fetch('https://identity.corp.internal/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken!,
        }),
      });
      if (!res.ok) throw new Error('Token refresh failed');
      const data = await res.json();
      return {
        ...current,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? current.refreshToken,
      };
    },
  });
}
```

---

## 2. Backend Integrations

### Recipe: FastAPI / Python JWT Backend
FastAPI often expects `Authorization: Bearer <token>` and returns `{ "access_token": "...", "token_type": "bearer", "refresh_token": "..." }`:

```typescript
import { createAuth } from 'reqix';

export const apiAuth = createAuth({
  getSession: () => loadTokens(),
  saveSession: (s) => persistTokens(s),
  clearSession: () => deleteTokens(),
  refreshSession: async (session) => {
    const res = await fetch('https://api.yourdomain.com/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });

    if (!res.ok) throw new Error('FastAPI refresh rejected');

    const data = await res.json();
    return {
      ...session,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    };
  },
});
```

### Recipe: Django REST Framework (SimpleJWT)
Django SimpleJWT issues a refresh token to `/api/token/refresh/`:

```typescript
import { createAuth } from 'reqix';

export const djangoAuth = createAuth({
  getSession: () => getTokens(),
  saveSession: (s) => setTokens(s),
  clearSession: () => dropTokens(),
  refreshSession: async (current) => {
    const res = await fetch('https://django.backend.com/api/token/refresh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: current.refreshToken }),
    });

    if (!res.ok) throw new Error('SimpleJWT refresh failed');

    const data = await res.json();
    return {
      ...current,
      accessToken: data.access, // SimpleJWT returns 'access'
    };
  },
});
```

---

## 3. Data Fetching Libraries

### Recipe: TanStack Query (React Query)
Pass `useAuthFetch` or `auth.fetch` directly into query functions:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from 'reqix/react';
import { auth } from '@/lib/auth';

export function UserMetrics() {
  const authFetch = useAuthFetch(auth);

  const { data, isLoading, error } = useQuery({
    queryKey: ['user-metrics'],
    queryFn: async () => {
      const res = await authFetch('/api/metrics');
      if (!res.ok) throw new Error(`Metrics failed: ${res.status}`);
      return res.json();
    },
  });

  if (isLoading) return <div>Loading metrics...</div>;
  if (error) return <div>Error loading metrics</div>;

  return <div>Metrics: {JSON.stringify(data)}</div>;
}
```

### Recipe: SWR
Integrate with SWR's global fetcher:

```tsx
import useSWR from 'swr';
import { useAuthFetch } from 'reqix/react';
import { auth } from '@/lib/auth';

export function SWRProfile() {
  const authFetch = useAuthFetch(auth);

  const fetcher = async (url: string) => {
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Fetch failed');
    return res.json();
  };

  const { data, error } = useSWR('/api/user/profile', fetcher);

  if (error) return <div>Failed to load</div>;
  if (!data) return <div>Loading...</div>;
  return <div>Hello {data.name}!</div>;
}
```

---

## 4. Custom Header Formats

If your backend expects a custom header name or format instead of standard `Authorization: Bearer <token>`:

```typescript
import { createAuth } from 'reqix';

export const customHeaderAuth = createAuth({
  getSession: () => getStoredSession(),
  saveSession: (s) => saveStoredSession(s),
  clearSession: () => clearStoredSession(),
  attachToken: (headers, session) => {
    // Custom header name and token format
    headers.set('X-Custom-Access-Token', session.accessToken);
    headers.set('X-Client-Version', '2.4.0');
  },
  refreshSession: async (session) => {
    // Refresh logic...
    return session;
  },
});
```

# Reqix ⚡

> **Headless, server-first auth and fetch orchestration for Next.js and modern TypeScript runtimes.**  
> Zero runtime dependencies in core. Built for custom JWT backends.

[![npm version](https://img.shields.io/badge/npm-v0.1.0-blue.svg)](https://npmjs.com/package/reqix)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript: Strict](https://img.shields.io/badge/TypeScript-Strict-3178C6.svg)](tsconfig.json)
[![Coverage: >90%](https://img.shields.io/badge/Coverage-%3E90%25-brightgreen.svg)](tests/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-orange.svg)](package.json)

---

## Why Reqix?

Modern web apps frequently communicate with **custom backend APIs** (FastAPI, Django, NestJS, Go, Spring, or Rails) that issue **short-lived access tokens** and **rotating refresh tokens**.

Existing libraries present serious friction:
- **Auth.js / NextAuth**: Geared towards OAuth providers and monolithic sessions. Fitting a custom JWT backend into its provider paradigm often requires awkward token rotation hacks in callbacks and leaks complexity.
- **axios-auth-refresh**: Client-only, binds you to `axios` (~40KB), lacks single-flight concurrency guarantees across parallel browser tabs, and cannot run in Next.js Server Components or Edge Middleware.
- **Custom `fetch` Wrappers**: Homegrown interceptors almost always suffer from **the thundering herd bug** (10 parallel requests firing 10 concurrent refresh calls, invalidating rotating refresh tokens) or fail to synchronize across browser tabs.

`reqix` solves this with a **headless, zero-dependency engine** that provides bulletproof guarantees while giving you 100% control over network calls and session storage:

```
┌─────────────────────────────────────────────────────────────┐
│                       reqix/react                        │
│                useSession, useAuthFetch                     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│                       reqix/next                         │
│  cookie-adapter  │  middleware  │  route-handlers  │ cache  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│                       reqix (core)                       │
│  createAuth  │  single-flight  │  locks  │  session  │ http │
└─────────────────────────────────────────────────────────────┘
```

---

## Comparison Matrix

| Feature | `reqix` | `Auth.js` (NextAuth) | `axios-auth-refresh` |
| :--- | :---: | :---: | :---: |
| **Core Runtime Dependencies** | **0 (Zero)** | 15+ | 1 (`axios`) |
| **Designed for Custom JWT Backends** | :white_check_mark: First-class | ⚠️ Clunky callbacks | :white_check_mark: |
| **Next.js Server Components (RSC)** | :white_check_mark: `getServerAuth` + `cache()` | :white_check_mark: | :x: Client only |
| **Edge Middleware Proactive Refresh** | :white_check_mark: Edge-compatible | ⚠️ Beta / Complex | :x: |
| **Single-Flight Parallel Deduplication** | :white_check_mark: Guaranteed | ⚠️ Session-level | :white_check_mark: In-tab only |
| **Cross-Tab Concurrency Sync** | :white_check_mark: Web Locks + BroadcastChannel | :x: | :x: |
| **Stale 401 Deduplication** | :white_check_mark: Built-in | :x: | :x: |
| **Generation Race Prevention** | :white_check_mark: Monotonic Gen IDs | :x: | :x: |
| **Token Redaction in Errors & Logs** | :white_check_mark: Strict `toJSON` filter | :x: | :x: |
| **Bundle Size** | **< 3.5 KB (Gzipped)** | ~25 KB | ~12 KB + Axios |

---

## Quickstart (Next.js App Router)

Install `reqix`:

```bash
npm install reqix
# or
pnpm add reqix
```

### 1. Configure Server Component Auth (`lib/auth.ts`)

```typescript
import { cookies } from 'next/headers';
import { getServerAuth, type Session } from 'reqix/next';

export interface AppSession extends Session {
  accessToken: string;
  refreshToken?: string;
  user?: { id: string; email: string; name: string };
}

export function getAppAuth() {
  const cookieStore = cookies();

  return getServerAuth<AppSession>({
    cookies: cookieStore,
    refreshSession: async (session) => {
      const res = await fetch('https://api.yourbackend.com/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });

      if (!res.ok) throw new Error('Token refresh failed');

      const data = await res.json();
      return {
        ...session,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      };
    },
  });
}
```

### 2. Edge Middleware Proactive Refresh (`middleware.ts`)

```typescript
import { createAuthMiddleware } from 'reqix/next';
import type { AppSession } from '@/lib/auth';

export const middleware = createAuthMiddleware<AppSession>({
  loginUrl: '/login',
  publicPaths: ['/', '/login', '/api/auth'],
  protectedPaths: ['/dashboard'],
  refresh: async (session) => {
    const res = await fetch('https://api.yourbackend.com/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });

    if (!res.ok) throw new Error('Middleware refresh failed');

    const data = await res.json();
    return {
      ...session,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
  },
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### 3. Auth Route Handlers (`app/api/auth/[...reqix]/route.ts`)

```typescript
import { createAuthRouteHandlers } from 'reqix/next';
import type { AppSession } from '@/lib/auth';

const handlers = createAuthRouteHandlers<AppSession>({
  login: async (credentials) => {
    const res = await fetch('https://api.yourbackend.com/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!res.ok) throw new Error('Invalid credentials');
    return res.json();
  },
  refresh: async (session) => {
    const res = await fetch('https://api.yourbackend.com/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session?.refreshToken }),
    });
    if (!res.ok) throw new Error('Refresh failed');
    return res.json();
  },
  logout: async (session) => {
    if (session?.refreshToken) {
      await fetch('https://api.yourbackend.com/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }).catch(() => {});
    }
  },
});

export const POST = handlers.POST;
```

### 4. Fetching in Server Components (`app/dashboard/page.tsx`)

```tsx
import { getAppAuth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const auth = getAppAuth();
  const session = await auth.getSession();

  if (!session) {
    redirect('/login');
  }

  // Token is automatically injected; proactive expiry checks performed
  const response = await auth.fetch('https://api.yourbackend.com/user/metrics');
  const metrics = await response.json();

  return (
    <div>
      <h1>Welcome {session.user?.name}</h1>
      <pre>{JSON.stringify(metrics, null, 2)}</pre>
    </div>
  );
}
```

---

## Standalone Client / React SPA Quickstart

In single-page applications (Vite, CRA, Remix, React Native), use `createAuth` + `reqix/react`:

```typescript
// lib/auth.ts
import { createAuth, createWebLock, type Session } from 'reqix';

export const auth = createAuth({
  getSession: () => JSON.parse(localStorage.getItem('session') || 'null'),
  saveSession: (s) => localStorage.setItem('session', JSON.stringify(s)),
  clearSession: () => localStorage.removeItem('session'),
  lock: createWebLock(), // Multi-tab mutual exclusion
  enableCrossTabSync: true, // Multi-tab broadcast channel sync
  refreshSession: async (session) => {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!res.ok) throw new Error('Refresh failed');
    return res.json();
  },
});
```

```tsx
// App.tsx
import { useSession, useAuthFetch } from 'reqix/react';
import { auth } from './lib/auth';

export function ProfileWidget() {
  const { session, isAuthenticated, loading } = useSession(auth);
  const authFetch = useAuthFetch(auth);

  if (loading) return <div>Loading session...</div>;
  if (!isAuthenticated) return <div>Please log in</div>;

  return (
    <div>
      <p>Logged in as {session?.user?.email}</p>
      <button onClick={() => authFetch('/api/protected/action')}>
        Perform Authorized Action
      </button>
      <button onClick={() => auth.logout()}>Sign Out</button>
    </div>
  );
}
```

---

## Core Behavior Guarantees

1. **Single-Flight Concurrency Guarantee**:
   If 10 requests fire concurrently and all detect that the token is expired (or receive a 401 response), `reqix` coalesces them into **exactly 1 network refresh call**. All 10 requests wait on the same promise and continue with the new token.
2. **Proactive & Reactive Expiry**:
   Tokens are refreshed *proactively* if they expire within `refreshBeforeExpirySec` (default: 30s). If a backend still returns a 401 reactively (e.g., token revocation), `reqix` executes a single-flight retry before failing.
3. **Stale 401 Deduplication**:
   If Request A and Request B fire simultaneously, Request A triggers a refresh, and Request B finishes with 401 using the *old* token, Request B checks the session store: if a newer token was already saved by Request A, Request B immediately retries with that token *without triggering a second refresh*.
4. **Generation Tracking (Race Prevention)**:
   Every `logout()` or explicit `setSession()` increments an internal generation counter. If a slow in-flight refresh completes after you logged out, the stale refresh result is discarded immediately.
5. **Cross-Tab Synchronization**:
   Uses the **Web Locks API** (`navigator.locks`) when available so only one browser tab refreshes at a time, and a **`BroadcastChannel`** to synchronize session changes across all active tabs in real-time.
6. **Zero Leaked Secrets**:
   Tokens and authorization headers are strictly redacted from error serializations, string representations, and logging mechanisms.

---

## Shadcn CLI Registry Integration

`reqix` provides Shadcn-compatible template components so you can own and customize the Next.js routes and middleware directly in your project:

```bash
npx shadcn add "https://raw.githubusercontent.com/reqixdev/reqix/main/registry/route-handler.json"
npx shadcn add "https://raw.githubusercontent.com/reqixdev/reqix/main/registry/middleware.json"
npx shadcn add "https://raw.githubusercontent.com/reqixdev/reqix/main/registry/login-form.json"
```

---

## Verification & E2E Proof

The repository includes a standalone test suite and end-to-end proof:

```bash
# Run 10-parallel-requests -> 1 refresh verification
pnpm test:parallel

# Run comprehensive test suite with coverage
pnpm test:coverage
```

Output:
```
Step 2: Firing 10 concurrent requests to protected endpoint with expired token...
  ⚡ [reqix] refreshSession invoked!
✅ All 10 concurrent requests completed in 39ms!

📊 Backend Statistics:
   - Protected data requests received: 10
   - Refresh token requests received:  1

🎉 PROOF VERIFIED: 10 parallel requests -> EXACTLY 1 token refresh!
```

---

## Documentation

Explore the detailed architecture guides in [`docs/`](docs/):
- [**Concepts & Concurrency**](docs/concepts.md): Single-flight mechanics, generation counters, and lock models.
- [**Next.js App Router Guide**](docs/nextjs.md): Cookie lifecycle, Edge middleware, RSC `cache()`, and Server Actions.
- [**Security & Threat Model**](docs/security.md): CSRF mitigation, open-redirect defenses, and redaction guarantees.
- [**Integration Recipes**](docs/recipes.md): Fastify, Django, NestJS, Expo, TanStack Query, and custom storage adapters.
- [**Architecture Decisions**](docs/decisions.md): Complete rationale for design choices and HTTP client bugs fixed.
- [**Next.js Version Compatibility**](docs/next-compat.md): Next.js 13.4 through 15+ support notes.

---

## License

[MIT](LICENSE) © ReqixDev Team

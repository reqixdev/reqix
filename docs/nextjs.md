# Next.js App Router Integration Guide ⚡

`reqix/next` provides primitives designed specifically for Next.js App Router, React Server Components (RSC), and Edge Middleware.

---

## 1. The Architecture of Next.js Auth

Next.js App Router splits execution across multiple distinct runtimes and phases:

```
                  ┌───────────────────────────────┐
                  │        Incoming Request       │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
               ┌─────────────────────────────────────┐
               │         Edge Middleware             │
               │  - Proactive token validation       │
               │  - Refreshes if near expiry         │
               │  - Writes response cookies          │
               │  - Forwards cookie header downstream│
               └──────────────────┬──────────────────┘
                                  │
            ┌─────────────────────┴─────────────────────┐
            │                                           │
            ▼                                           ▼
┌───────────────────────────────┐           ┌───────────────────────┐
│     Server Components (RSC)   │           │    Route Handlers     │
│  - Read cookies via cookies() │           │  - /api/auth/login    │
│  - Fetch with getServerAuth() │           │  - /api/auth/refresh  │
│  - React cache() deduplication│           │  - /api/auth/logout   │
└───────────────────────────────┘           └───────────────────────┘
```

---

## 2. Cookie Lifecycle & The RSC Constraint

### Why Server Components Cannot Write Cookies
In Next.js App Router, React Server Components stream HTML progressively to the browser. By the time a deep component finishes fetching data, the HTTP response headers may already have been sent.

Consequently, Next.js explicitly throws an error if code attempts to call `cookies().set()` inside a Server Component:
```
Error: Cookies can only be modified in a Server Action or Route Handler.
```

### How `createCookieSessionAdapter` Handles This
`createCookieSessionAdapter` wraps cookie writes with safe error detection:
```typescript
const adapter = createCookieSessionAdapter({
  cookies: cookies(),
  onWriteBlocked: (error) => {
    // Graceful notification: session updated in memory for this request,
    // but persistent cookie mutation must occur in Middleware or Route Handler
  },
});
```
- If a write is attempted inside an RSC, the error is caught and passed to `onWriteBlocked` rather than crashing the page render.
- The session is still cached in-memory for the remainder of that request.
- The primary responsibility for proactive token refreshing is delegated to **Edge Middleware** before RSC rendering begins.

---

## 3. Edge Middleware (`createAuthMiddleware`)

The optimal place to refresh tokens in Next.js is **Edge Middleware**. Because Middleware runs *before* any Server Component or page renders, it has full write access to both request headers and response headers.

`createAuthMiddleware` performs a three-way synchronization:
1. Reads existing session cookies from `req.cookies`.
2. Inspects token expiration:
   - If valid: lets the request proceed immediately.
   - If near expiry: executes `refresh(currentSession)`.
3. If refreshed:
   - Sets `Set-Cookie` on the outgoing `NextResponse`.
   - Modifies the **request's `cookie` header** passed downstream so that `cookies()` in Server Components receives the *new* access token immediately in the exact same render!

```typescript
// middleware.ts
import { createAuthMiddleware } from 'reqix/next';

export const middleware = createAuthMiddleware({
  loginUrl: '/login',
  publicPaths: ['/', '/login', '/api/auth'],
  protectedPaths: ['/dashboard', '/account'],
  refresh: async (session) => {
    const res = await fetch('https://api.backend.com/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!res.ok) throw new Error('Refresh failed');
    return res.json();
  },
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

---

## 4. Route Handlers (`createAuthRouteHandlers`)

For authentication endpoints invoked by client forms or third-party webhooks, use `createAuthRouteHandlers`:

```typescript
// app/api/auth/[...reqix]/route.ts
import { createAuthRouteHandlers } from 'reqix/next';

const handlers = createAuthRouteHandlers({
  login: async (credentials, req) => {
    const res = await fetch('https://api.backend.com/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!res.ok) throw new Error('Invalid credentials');
    return res.json(); // returns { accessToken, refreshToken, user }
  },
  refresh: async (session) => {
    const res = await fetch('https://api.backend.com/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session?.refreshToken }),
    });
    if (!res.ok) throw new Error('Refresh failed');
    return res.json();
  },
  logout: async (session) => {
    if (session?.refreshToken) {
      await fetch('https://api.backend.com/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }).catch(() => {});
    }
  },
});

export const POST = handlers.POST;
```

### Endpoints Created
- `POST /api/auth/login`: Accepts credentials, calls `options.login()`, and sets `HttpOnly` session cookies.
- `POST /api/auth/refresh`: Reads cookies, calls `options.refresh()`, and sets rotated cookies.
- `POST /api/auth/logout`: Clears session cookies and invokes `options.logout()`.

### Built-in Security Protections
- **CSRF Defense**: Rejects requests where `Origin` or `Referer` does not match the application origin (`assertSameOrigin`).
- **Open-Redirect Protection**: Any redirect URL provided in queries (`?callbackUrl=...`) is strictly checked by `validateRedirectUrl` to reject external domain redirection.

---

## 5. Server Component Data Fetching (`getServerAuth`)

To fetch protected data inside React Server Components:

```tsx
// app/dashboard/page.tsx
import { cookies } from 'next/headers';
import { getServerAuth } from 'reqix/next';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const auth = getServerAuth({
    cookies: cookies(),
    refreshSession: async (session) => {
      // Server-side fallback refresh
      const res = await fetch('https://api.backend.com/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      return res.json();
    },
  });

  const session = await auth.getSession();
  if (!session) {
    redirect('/login');
  }

  // Token is automatically injected in Authorization header
  const res = await auth.fetch('https://api.backend.com/user/metrics');
  const metrics = await res.json();

  return (
    <main>
      <h1>Metrics for {session.user?.name}</h1>
      <pre>{JSON.stringify(metrics, null, 2)}</pre>
    </main>
  );
}
```

### React `cache()` Optimization
`getServerAuth` uses React's `cache()` to deduplicate authentication resolution across parallel Server Components rendered during the same request lifecycle. Multiple components can call `getServerAuth()` without repeating cookie parsing or token decoding.

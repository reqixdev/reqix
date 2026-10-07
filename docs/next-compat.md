# Next.js Version Compatibility Guide 🌐

`reqix/next` is engineered to support the evolution of the Next.js App Router across major releases.

---

## 1. Compatibility Matrix

| Next.js Version | React Version | App Router Support | Edge Middleware | Server Components | Next.js Cookies API |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Next.js 13.4+** | 18.2+ | :white_check_mark: | :white_check_mark: | :white_check_mark: | Synchronous `cookies()` |
| **Next.js 14.x** | 18.2+ | :white_check_mark: | :white_check_mark: | :white_check_mark: | Synchronous `cookies()` |
| **Next.js 15.x** | 19.x | :white_check_mark: | :white_check_mark: | :white_check_mark: | Async `await cookies()` |

---

## 2. Supporting Both Sync and Async `cookies()`

In Next.js 15, `cookies()` from `next/headers` was updated to return a `Promise<ReadonlyRequestCookies>`. In Next.js 13 and 14, `cookies()` returned the cookie store synchronously.

`createCookieSessionAdapter` and `getServerAuth` natively support both patterns through union signatures:

```typescript
export interface CookieAdapterOptions {
  cookies: CookieStoreLike | CookieGetter | Promise<CookieStoreLike>;
  // ...
}
```

### Next.js 13 & 14 Pattern (Synchronous)
```typescript
import { cookies } from 'next/headers';
import { getServerAuth } from 'reqix/next';

export function getAuth() {
  const cookieStore = cookies();
  return getServerAuth({ cookies: cookieStore, ... });
}
```

### Next.js 15 Pattern (Asynchronous or Getter)
```typescript
import { cookies } from 'next/headers';
import { getServerAuth } from 'reqix/next';

// Option A: Passing the async promise directly
export async function getAuth() {
  const cookieStore = await cookies();
  return getServerAuth({ cookies: cookieStore, ... });
}

// Option B: Passing the getter function directly
export function getAuth() {
  return getServerAuth({ cookies: () => cookies(), ... });
}
```

`reqix` automatically detects whether the passed store is a Promise or a getter function and resolves it before attempting reads or writes.

---

## 3. Edge Runtime vs Node.js Runtime

| Feature | Edge Runtime | Node.js Runtime |
| :--- | :---: | :---: |
| **Middleware** | Default | Optional |
| **Route Handlers** | Optional (`export const runtime = 'edge'`) | Default |
| **Server Components** | N/A | Default |
| **`reqix` Compatibility** | 100% Native | 100% Native |

Because `reqix` relies exclusively on Web Standard APIs (`fetch`, `Headers`, `Request`, `Response`, `AbortController`, `btoa`/`atob`, Web Crypto), it operates identically across Node.js and Edge runtimes with zero polyfills.

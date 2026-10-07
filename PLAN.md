# Implementation Plan: reqix

A headless, server-first auth + fetch library for Next.js and modern TypeScript runtimes.

---

## 1. Architecture Overview

`reqix` is an open-source, zero-runtime-dependency TypeScript library providing:
- **Core HTTP Client (`reqix` core)**: An Axios-like client based on the Web Fetch standard with request/response interceptors, per-attempt timeout and cancel differentiation, exponential retry with jitter and `Retry-After`, and strict body/response serialization.
- **Headless Auth Orchestrator (`createAuth`)**: A policy-agnostic auth engine where the library guarantees behavior (single-flight concurrency, proactive refresh before token expiry, reactive retry on 401, stale-401 deduplication, generation-tracked logout/setSession race prevention, pluggable Web Locks & cross-tab sync) while the caller controls storage, network calls, and token policies through callbacks.
- **Next.js App Router Integration (`reqix/next`)**: Server-first primitives tailored to Next.js App Router and Edge runtime:
  - `createCookieSessionAdapter`: Reads/writes/clears cookies with robust handling for Server Components (safe fallback when write is blocked during rendering).
  - `createAuthMiddleware`: Edge-compatible middleware that proactively refreshes tokens, updates response cookies, and forwards updated `cookie` headers to downstream Server Components in the same request.
  - `createAuthRouteHandlers`: Secure Route Handler factories (`/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`) with CSRF/Origin validation (`assertSameOrigin`) and open-redirect protection.
  - `getServerAuth`: Per-request cached auth factory using React's `cache()` to deduplicate token state across Server Components.
- **React Client Hooks (`reqix/react`)**: Minimal hooks (`useSession`, `useAuthFetch`) built cleanly on top of `auth.subscribe`.

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

## 2. File Tree

```
reqix/
├── .changeset/
│   └── config.json
├── .github/
│   └── workflows/
│       └── ci.yml
├── docs/
│   ├── concepts.md
│   ├── decisions.md
│   ├── next-compat.md
│   ├── nextjs.md
│   ├── recipes.md
│   └── security.md
├── examples/
│   ├── next-app-router/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── next.config.mjs
│   │   ├── middleware.ts
│   │   ├── app/
│   │   │   ├── api/auth/[...reqix]/route.ts
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   └── dashboard/page.tsx
│   │   ├── lib/
│   │   │   ├── auth.ts
│   │   │   └── mock-backend.ts
│   │   └── scripts/
│   │       └── test-parallel-refresh.ts
│   └── vite-spa/
│       ├── package.json
│       ├── index.html
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           └── auth.ts
├── registry/
│   ├── registry.json
│   ├── middleware.ts
│   ├── route-handler.ts
│   ├── login-form.tsx
│   └── use-session.ts
├── src/
│   ├── index.ts
│   ├── core/
│   │   ├── errors.ts
│   │   ├── http-client.ts
│   │   ├── index.ts
│   │   └── types.ts
│   ├── auth/
│   │   ├── create-auth.ts
│   │   ├── events.ts
│   │   ├── index.ts
│   │   ├── locks.ts
│   │   ├── session.ts
│   │   ├── single-flight.ts
│   │   └── types.ts
│   ├── next/
│   │   ├── cookie-adapter.ts
│   │   ├── index.ts
│   │   ├── middleware.ts
│   │   ├── route-handlers.ts
│   │   ├── server-auth.ts
│   │   ├── types.ts
│   │   └── utils.ts
│   └── react/
│       ├── index.ts
│       ├── use-auth-fetch.ts
│       └── use-session.ts
├── tests/
│   ├── core/
│   │   └── http-client.test.ts
│   ├── auth/
│   │   ├── create-auth.test.ts
│   │   ├── locks.test.ts
│   │   └── session.test.ts
│   ├── next/
│   │   ├── cookie-adapter.test.ts
│   │   ├── middleware.test.ts
│   │   ├── route-handlers.test.ts
│   │   └── server-auth.test.ts
│   ├── react/
│   │   └── hooks.test.ts
│   └── mocks/
│       ├── handlers.ts
│       └── server.ts
├── .gitignore
├── CONTRIBUTING.md
├── LICENSE
├── package.json
├── PLAN.md
├── README.md
├── SECURITY.md
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

---

## 3. Public API Specification

### 3.1 `reqix` (Root Entrypoint)
- **Functions**:
  - `createAuth<S extends Session = Session>(options: AuthOptions<S>): Auth<S>`
  - `createHttpClient(config?: HttpClientConfig): HttpClient`
  - `publicFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>`
  - `decodeJwtExp(token: string): number | null` (Decode-only: reads `exp` claim, zero signature verification)
  - `isTokenExpired(expiresAt: number | null | undefined, thresholdSec?: number, clockSkewSec?: number): boolean`
  - `createWebLock(name?: string): RefreshLock`
  - `createNoopLock(): RefreshLock`
  - `createMemoryLock(): RefreshLock`
- **Classes**:
  - `HttpClient`
  - `HttpError` (subclass of Error with status, statusText, headers, data, config, request)
  - `AuthError` (subclass of Error with code: `'REFRESH_FAILED' | 'UNAUTHORIZED' | 'INVALID_SESSION'`, cause)
- **Types**:
  - `Session`, `LogoutReason`, `AuthOptions<S>`, `Auth<S>`, `RefreshLock`, `RequestConfig`, `ResponseData<T>`, `InterceptorManager`

### 3.2 `reqix/next` (Next.js Entrypoint)
- **Functions**:
  - `createCookieSessionAdapter(options: CookieAdapterOptions): SessionAdapter`
  - `createAuthMiddleware(options: AuthMiddlewareOptions): (req: NextRequest) => Promise<NextResponse>`
  - `createAuthRouteHandlers(options: RouteHandlerOptions): { POST: (req: Request) => Promise<Response> }`
  - `getServerAuth<S extends Session>(options: ServerAuthOptions<S>): Auth<S>`
  - `assertSameOrigin(request: Request | NextRequest): boolean`
  - `validateRedirectUrl(url: string, baseOrigin?: string): string` (Protects against open-redirects: allows relative `/path` without `//`, or verified same-origin)
- **Types**:
  - `CookieAdapterOptions`, `SessionAdapter`, `AuthMiddlewareOptions`, `RouteHandlerOptions`, `ServerAuthOptions`

### 3.3 `reqix/react` (React Hooks Entrypoint)
- **Hooks**:
  - `useSession<S extends Session = Session>(auth: Auth<S>): { session: S | null; loading: boolean; isAuthenticated: boolean }`
  - `useAuthFetch<S extends Session = Session>(auth: Auth<S>): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>`

---

## 4. Security & Verification Plan

In strict accordance with the **Mandatory Secure Web Skills**:
1. **Token Protection & Storage**:
   - `HttpOnly`, `Secure` (production), `SameSite=Lax`, and `path='/'` enforced by default in cookie adapters.
   - Docs explicitly warn against storing refresh tokens in `localStorage`.
   - Never log tokens: sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`) and fields (`accessToken`, `refreshToken`, `token`) are automatically redacted in error serializations (`toJSON`), debug logs, and string conversions.
2. **Open-Redirect & CSRF Prevention**:
   - `validateRedirectUrl` strictly enforces relative root paths starting with single `/` (rejects protocol-relative `//` and backslashes) or same origin matching.
   - `assertSameOrigin` validates `Origin` or `Referer` matches `Host` / `x-forwarded-host` on state-changing requests.
3. **JWT Decoding Safety**:
   - `decodeJwtExp` explicitly parses payload Base64URL string without `eval` or dynamic execution, parsing strictly the numeric `exp` claim. No verification claims are made.
4. **Edge Runtime Isolation**:
   - No Node-only native APIs (`fs`, `child_process`, `crypto` Node module); uses Web Standard APIs (`fetch`, `Headers`, `Request`, `Response`, `AbortController`, `btoa`/`atob`, `crypto.getRandomValues`).
5. **Testing Constraints**:
   - All tests bind strictly to `localhost` / `127.0.0.1`.

---

## 5. Implementation Phases & Verification Checkpoints

### Phase 1: Scaffold & Core HTTP Client
- Initialize package configuration (`package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, ESLint, Prettier).
- Implement `src/core/errors.ts`, `src/core/types.ts`, and `src/core/http-client.ts`.
- Implement full test suite in `tests/core/http-client.test.ts`.
- **Verification**: `pnpm typecheck`, `pnpm test tests/core`.

### Phase 2: `createAuth` Core Orchestrator
- Implement `src/auth/session.ts` (`decodeJwtExp`, expiry utilities).
- Implement `src/auth/single-flight.ts` (concurrency deduplication helper).
- Implement `src/auth/events.ts` (lightweight typed emitter).
- Implement `src/auth/locks.ts` (Web Locks adapter, memory lock, cross-tab BroadcastChannel).
- Implement `src/auth/create-auth.ts` (behavior guarantees 1 through 12).
- Implement comprehensive tests in `tests/auth/*.test.ts` (single-flight 10 parallel requests, proactive refresh, reactive retry, failure logout, lock simulation, generation counter).
- **Verification**: `pnpm typecheck`, `pnpm test tests/auth`.

### Phase 3: Next.js Helpers (`reqix/next`)
- Implement `src/next/cookie-adapter.ts` with safe error catching for Next.js Server Component render context.
- Implement `src/next/utils.ts` (`assertSameOrigin`, `validateRedirectUrl`).
- Implement `src/next/middleware.ts` for Edge-compatible proactive refresh and downstream cookie header forwarding.
- Implement `src/next/route-handlers.ts` for login, refresh, logout with safe redirect.
- Implement `src/next/server-auth.ts` with React `cache()`.
- Implement tests in `tests/next/*.test.ts`.
- **Verification**: `pnpm typecheck`, `pnpm test tests/next`.

### Phase 4: Examples & End-to-End Proof
- Create `examples/next-app-router` demonstrating App Router layout, Server Components, Route Handlers, Middleware, and a mock JWT backend.
- Create runnable e2e proof script (`examples/next-app-router/scripts/test-parallel-refresh.ts`) confirming 10 parallel requests trigger exactly 1 refresh.
- Create `examples/vite-spa` demonstrating client-only SPA usage.
- **Verification**: Run e2e script and check output.

### Phase 5: Documentation & Artifacts
- Create comprehensive documentation:
  - `README.md` (Product intro, quickstart, comparison with Auth.js and axios-auth-refresh, API reference).
  - `docs/concepts.md` (Architecture, single-flight, locking, concurrency).
  - `docs/nextjs.md` (Recommended App Router flow, cookie lifecycle).
  - `docs/security.md` (Threat model, CSRF, open redirects, token storage).
  - `docs/recipes.md` (Custom storage, NestJS/Django integration patterns).
  - `docs/decisions.md` (Design rationales, HTTP client improvements).
  - `docs/next-compat.md` (Next.js version compatibility).
  - `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE` (MIT).

### Phase 6: Registry & Distribution Readiness
- Setup `registry/registry.json` and shadcn-style component templates (`middleware.ts`, `route-handler.ts`, `login-form.tsx`, `use-session.ts`).
- Setup Changesets (`.changeset/config.json`) and GitHub Actions workflow (`.github/workflows/ci.yml`).
- Build package (`pnpm build`) and run typecheck, lint, test, and packaging verification.

### Phase 7: React Hooks (`reqix/react`)
- Implement `src/react/use-session.ts` and `src/react/use-auth-fetch.ts`.
- Add unit tests in `tests/react/hooks.test.ts`.
- **Final Verification**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passes with zero errors and >= 90% coverage on core & auth.

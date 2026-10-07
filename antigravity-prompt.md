# PROMPT FOR ANTIGRAVITY: Build a headless, server-first auth + fetch library for Next.js

> Attach `http-client.ts` (my existing file) to this prompt as the starting point for the HTTP core.
> Replace `{{PACKAGE_NAME}}` with the real package name before running.

---

## 0. Your role and how to work

You are a senior TypeScript library engineer. Build an open-source npm package called `{{PACKAGE_NAME}}`.

Working rules:

1. **Plan first.** Before writing code, produce `PLAN.md` with the architecture, file tree, public API, and phase list. Wait for no approval; continue after writing it, but follow it.
2. **Work in the phases defined in section 9.** After each phase: run `typecheck`, `lint`, and `test`, fix everything, then write a short summary of what changed.
3. **No placeholders.** No `TODO`, no `// implement later`, no pseudo-code, no fake APIs. Every file must be complete and working.
4. **Do not invent framework APIs.** For anything Next.js related (middleware / proxy file naming, `cookies()` behavior, Server Actions, Route Handlers), check the installed `next` package types and the official docs for the version in `devDependencies`. Next.js has renamed/changed some of these between versions. Note the verified version in `docs/next-compat.md`.
5. **Zero runtime dependencies** in the core. Dev dependencies only: `typescript`, `tsup`, `vitest`, `msw`, `eslint`, `prettier`, `@changesets/cli`, `next`/`react` (as peer + dev for the `next` subpath tests).
6. If a requirement is ambiguous, choose the safer option, document the decision in `docs/decisions.md`, and continue. Do not stop to ask unless blocked.

---

## 1. Product goal

A **headless** library for apps that use **Next.js (App Router)** with **their own JWT backend** (NestJS, Express, Django, Spring, etc.), for people who avoid Auth.js / next-auth and prefer plain `fetch`.

Core idea: **the library owns behavior guarantees; the user owns all policy decisions via callbacks.** The library never decides where tokens are stored, how login works, or what a logout redirects to. The user passes functions; the library orchestrates them correctly.

Target users: developers who currently write ad-hoc `fetch` + refresh logic and hit race conditions, cookie-setting limits in Server Components, and logout cleanup bugs.

Non-goals (do NOT build): OAuth/provider flows, user database, UI components for login, an Axios clone, upload progress, schema validation.

---

## 2. Package layout

Single package with subpath exports (ESM + CJS + `.d.ts`, built with `tsup`):

```
{{PACKAGE_NAME}}            -> core: http client + createAuth (runtime-agnostic)
{{PACKAGE_NAME}}/next       -> Next.js helpers (cookie adapter, middleware helper, route handler factories)
{{PACKAGE_NAME}}/react      -> optional: tiny client hooks (Phase 6, only if time permits)
```

Repo structure:

```
/src
  /core
    http-client.ts        (hardened from my attached file)
    errors.ts
    types.ts
  /auth
    create-auth.ts
    single-flight.ts
    session.ts            (expiry helpers, optional JWT exp decode WITHOUT verifying)
    events.ts             (tiny typed emitter)
    locks.ts              (pluggable lock; Web Locks adapter)
    types.ts
  /next
    cookie-adapter.ts
    middleware.ts
    route-handlers.ts
    index.ts
  /react (optional)
  index.ts
/tests (mirror src; msw handlers in /tests/mocks)
/examples
  /next-app-router        (full working demo + a tiny mock backend)
  /vite-spa               (client-only usage)
/registry                 (shadcn-style templates, see section 8)
/docs
package.json, tsconfig.json (strict), tsup.config.ts, vitest.config.ts, .eslintrc, .changeset/, LICENSE (MIT), README.md, SECURITY.md, CONTRIBUTING.md
```

TypeScript: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Target ES2020. Must run on Node 18+, modern browsers, and Next.js Edge runtime (no Node-only APIs in core or in `/next` middleware helper).

---

## 3. HTTP core requirements (`src/core/http-client.ts`)

Start from my attached `http-client.ts` and keep these guarantees (they are already implemented there; keep them, add tests):

- Axios-like API: `request/get/post/put/patch/delete/head/options`, `create()`, request/response interceptors with axios chain semantics (request interceptors run once per logical request, never again on retry/refresh).
- Per-attempt timeout (`0` = disabled) and user cancellation are distinct (`ECONNABORTED` vs `ERR_CANCELED`). Abort listeners are always cleaned up. Already-aborted signals are handled.
- Retry: idempotent methods only by default; exponential backoff + jitter; `Retry-After` support; configurable `retryMethods`, `retryStatusCodes`, `retryCondition`.
- Safe body serialization (JSON, FormData, Blob, URLSearchParams, string, buffers, streams). `Content-Type` only set for JSON bodies.
- Safe response parsing: 204/205/304/HEAD return `null`; empty body; malformed JSON -> `ERR_PARSE` on success status, raw text on error status; `responseType` option.
- Internal-only config keys must never reach `fetch()`.
- Next.js `next: { revalidate, tags }` and `cache` forwarded to `fetch` untouched.
- Accept an injectable `fetch` implementation (`options.fetch`) for testing and custom runtimes.
- Remove the old built-in refresh handler from the client; refresh now lives in `createAuth` (section 4). The client exposes a clean hook so auth can wrap it: either via interceptors or a dedicated internal `beforeRequest` / `onResponseError` extension point. Choose the cleanest design and document it.

Also review the attached file critically and fix any bug you find; list fixes in `docs/decisions.md`.

---

## 4. `createAuth`: the main feature (headless)

### 4.1 Types

```ts
export interface Session {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms. If missing, library tries to read `exp` from a JWT access token (decode only, never verify). */
  expiresAt?: number;
  [key: string]: unknown;
}

export type LogoutReason = 'manual' | 'refresh_failed' | 'unauthorized';

export interface AuthOptions<S extends Session = Session> {
  // ---- user-owned callbacks (all may be sync or async) ----
  getSession: () => S | null | undefined | Promise<S | null | undefined>;
  saveSession: (session: S) => void | Promise<void>;
  clearSession: () => void | Promise<void>;
  /** User calls THEIR backend here and returns the new session. Throw to signal failure. */
  refreshSession: (current: S) => S | Promise<S>;

  // ---- optional user hooks ----
  onLogout?: (reason: LogoutReason) => void | Promise<void>;
  onRefreshError?: (error: unknown) => void;
  onSessionChange?: (session: S | null) => void;
  attachToken?: (headers: Headers, session: S) => void;     // default: Authorization: Bearer <accessToken>
  shouldRefreshOnResponse?: (res: Response) => boolean;      // default: status === 401
  shouldSkip?: (url: string, init?: RequestInit) => boolean; // e.g. skip auth for public URLs

  // ---- behavior knobs (safe defaults) ----
  baseURL?: string;
  refreshBeforeExpirySec?: number;  // default 30. Proactive refresh.
  clockSkewSec?: number;            // default 5
  maxRefreshAttemptsPerRequest?: number; // default 1 (loop protection)
  fetch?: typeof fetch;
  http?: Partial<RequestConfig>;    // defaults passed to the underlying client (timeout, retries...)
  lock?: RefreshLock;               // optional cross-tab / cross-process lock (see 4.4)
}
```

### 4.2 Returned object

```ts
interface Auth<S extends Session = Session> {
  fetch(input: RequestInfo | URL, init?: RequestInit & { skipAuth?: boolean }): Promise<Response>;
  client: HttpClient;                 // same behavior, axios-like API, token handling built in
  getSession(): Promise<S | null>;
  setSession(session: S): Promise<void>;  // for login: user calls their backend, then passes result here
  refresh(): Promise<S>;               // forced single-flight refresh
  logout(opts?: { reason?: LogoutReason }): Promise<void>;
  subscribe(fn: (session: S | null) => void): () => void;
  isAuthenticated(): Promise<boolean>;
}
export function createAuth<S extends Session = Session>(options: AuthOptions<S>): Auth<S>;
```

### 4.3 Behavior guarantees (MUST be implemented and tested)

1. **Token attach:** every request gets the current token via `attachToken` unless `skipAuth` / `shouldSkip`.
2. **Proactive refresh:** before sending, if `expiresAt - now <= refreshBeforeExpirySec + clockSkew`, refresh first. `expiresAt` comes from the session or from decoding JWT `exp` (decode only; never trust or verify).
3. **Reactive refresh:** on `shouldRefreshOnResponse` (default 401), refresh once and retry the original request exactly once with the new token. Never loop (`maxRefreshAttemptsPerRequest`).
4. **Single-flight:** N parallel requests that need a refresh trigger exactly ONE `refreshSession` call. All others await the same promise.
5. **Stale 401 protection:** if a 401 arrives for a request that was sent with an old token and the session has already been refreshed since, retry with the latest session without refreshing again (compare token/generation).
6. **Failure semantics:** if `refreshSession` throws or returns an invalid session, then: call `onRefreshError`, run the logout sequence with reason `refresh_failed`, and reject EVERY waiting request (none may hang). The rejected error is a typed `AuthError` with `code: 'REFRESH_FAILED'` and `cause`.
7. **Logout sequence** (`logout()` and on refresh failure), in this order and each step isolated with try/catch so one failing callback never blocks the rest:
   1. abort all in-flight requests started through this auth instance (internal `AbortController` registry),
   2. reset the refresh promise,
   3. `clearSession()`,
   4. emit `onSessionChange(null)` + `subscribe` listeners,
   5. `onLogout(reason)`.
   Calling `logout()` twice must be safe (idempotent).
8. **Concurrency on `setSession`/`logout` during refresh:** if logout happens while a refresh is in flight, the refresh result MUST be discarded (do not save a session after logout). Use a generation counter.
9. **Session validation:** a session returned from `refreshSession` must have a non-empty `accessToken`; otherwise treat as failure.
10. **No global state.** All state is inside the instance created by `createAuth`. Document clearly: on the server, create the instance **per request** (cheap); a module-level singleton on the server is unsafe because it is shared across users.
11. **Cache safety:** requests made through `auth.fetch` / `auth.client` default to `cache: 'no-store'` unless the caller explicitly passes `cache` or `next.revalidate`. Add a separate exported `publicFetch` helper (no auth) for shared/cacheable data.
12. **Never log tokens.** If a debug logger option exists, redact `authorization`, `cookie`, `set-cookie`, and any field named like `token`.

### 4.4 Cross-tab / cross-process lock (pluggable)

```ts
interface RefreshLock {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
```
- Default in browsers: Web Locks API (`navigator.locks.request`) if available, else no-op (single-flight still works within one tab).
- After acquiring the lock, re-read `getSession()`; if another tab already refreshed (session changed / not near expiry anymore), skip calling `refreshSession` and use the fresh session. This avoids refresh-token-rotation races across tabs.
- Browser only: optional `BroadcastChannel` sync so logout/refresh in one tab updates `subscribe` listeners in the others. Must be feature-detected and off on the server.
- Document that serverless instances cannot share in-memory locks and explain mitigations (refresh early in middleware, backend grace window for the previous refresh token).

---

## 5. Next.js helpers (`/next` subpath)

Key Next.js constraints to honor (verify against the installed version):
- Cookies can be **read** in Server Components but **written only** in Route Handlers, Server Actions, and Middleware/Proxy.
- Calling `cookies()` makes a route dynamic; authenticated data must not use shared caching.

Build:

1. **`createCookieSessionAdapter({ cookies, names?, options? })`**: returns `{ getSession, saveSession, clearSession }` compatible with `createAuth`.
   - Defaults: `httpOnly: true`, `secure: true` in production, `sameSite: 'lax'`, `path: '/'`, `maxAge` derived from session expiry for the access cookie, longer for refresh.
   - Cookie names configurable (default `access_token`, `refresh_token`, `expires_at`). All options overridable.
   - In contexts where writing is not allowed (Server Component), `saveSession`/`clearSession` must not crash the render: catch the Next.js error, skip the write, and call an optional `onWriteBlocked()` callback. Document that the middleware/route handler is the place where refresh persists.
2. **`createAuthMiddleware({ refresh, shouldRun?, ... })`** helper that, per request: reads cookies from the `NextRequest`, checks expiry, and if the token is expired or near expiry calls the user's `refresh`, then **sets the new cookies on the response AND forwards them to the downstream request** so Server Components rendered in the same request see the fresh token. If refresh fails: clear cookies and optionally redirect (user callback). Must work in the Edge runtime. Skip static assets and configurable public paths.
3. **`createAuthRouteHandlers({ login, refresh, logout })`**: factory returning `{ POST }`-style handlers for `/api/auth/login|refresh|logout`. `login`/`refresh`/`logout` are **user functions** that talk to their backend and return a `Session`; the factory only handles cookie writing, response shape, and error codes. Support a `?next=` redirect for the "401 inside a Server Component -> redirect to refresh route -> come back" fallback; validate `next` to prevent open redirects (same-origin relative paths only).
4. **Server helper `getServerAuth(...)`**: convenience to build a per-request `createAuth` instance from `cookies()`, wrapped in React `cache()` so multiple Server Components in one render share one instance and dedupe refresh within the request.

Document the recommended architecture in `docs/nextjs.md`:
Middleware refreshes early -> Server Components just read cookie and fetch -> 401 fallback redirect to refresh route -> mutations via Server Actions/Route Handlers -> browser never sees the refresh token.

---

## 6. Security requirements (treat as acceptance criteria)

- httpOnly + Secure + SameSite defaults for cookies; docs warn loudly against storing refresh tokens in `localStorage`.
- Open-redirect protection on any `next`/redirect parameter.
- CSRF section in docs: SameSite defaults, Origin/Host check helper for state-changing route handlers (implement `assertSameOrigin(request)`).
- JWT decode is for reading `exp` only; never claim verification. Name it `decodeJwtExp` and document it.
- Tokens never appear in error messages, logs, or thrown `cause` serialization (`toJSON` on errors redacts config headers).
- No `eval`, no dynamic code, no network calls except the ones the user's callbacks make.
- Write `SECURITY.md` with the threat model and a responsible-disclosure contact placeholder.

---

## 7. Tests (Vitest + msw), required cases

Core client:
- timeout vs cancel produce different errors; listeners removed; pre-aborted signal
- retry: GET retries on 503, POST does not; backoff + `Retry-After`; `retryCondition`
- body serialization for each type; FormData has no manual content-type
- 204 / empty / malformed JSON on 200 and on 500
- interceptor chain order, eject, rejected-handler chaining, request interceptors run once across retries

Auth:
- 10 parallel requests with expired token -> `refreshSession` called exactly once, all 10 succeed with the new token
- refresh fails -> all 10 reject (no hang), `onRefreshError` once, `clearSession` once, `onLogout('refresh_failed')` once
- proactive refresh before expiry; JWT `exp` fallback; clock skew
- stale-401: late 401 after another request refreshed -> no second refresh
- loop protection: backend always returns 401 -> exactly one refresh + one retry, then error
- logout during in-flight refresh -> refreshed session is discarded, nothing saved
- logout aborts in-flight requests; double logout safe; failing `onLogout` doesn't break cleanup
- `skipAuth` / `shouldSkip`
- lock: second "tab" (simulated) sees fresh session after lock and skips refresh
- default `cache: 'no-store'` applied; `publicFetch` doesn't attach token
- tokens redacted in error serialization

Next:
- cookie adapter read/write/clear with a mocked cookie store; write-blocked path does not throw
- middleware: refreshes expired token, sets response cookies and forwards to downstream request, redirects/clears on failure, skips static paths
- route handlers: login/refresh/logout happy + error paths; open-redirect rejection; same-origin assertion

Coverage target: >= 90% lines on `/auth` and `/core`. Add a CI workflow (GitHub Actions): install, typecheck, lint, test, build, plus `publint` and `arethetypeswrong` checks on the built package.

---

## 8. Distribution

1. **npm package** (primary): `package.json` with correct `exports` map (types, import, require) for `.`, `./next`, optionally `./react`; `sideEffects: false`; `files` whitelist; `engines`; peer deps for `next`/`react` marked optional; Changesets for versioning; provenance-ready publish workflow.
2. **shadcn-style registry** (secondary, templates only): in `/registry`, create `registry.json` and items of type `registry:lib` / `registry:hook` / `registry:file` for things users should *own and edit*: the Next.js route handler files, the middleware file, a login form example, and `useSession` hook. These import from the npm package, so the security-sensitive core still receives updates through `npm update`. Verify the exact registry schema and `shadcn build` command against the current official shadcn registry docs before writing it; document the install command in the README.

---

## 9. Phases (stop and verify at the end of each)

1. **Scaffold + core client:** repo, tooling, hardened `http-client.ts`, tests for section 7 (core).
2. **`createAuth` core:** single-flight, proactive/reactive refresh, logout sequence, generation counter, locks, tests.
3. **Next.js helpers:** cookie adapter, middleware helper, route handlers, `getServerAuth`, tests.
4. **Examples:** `examples/next-app-router` with a runnable mock JWT backend (short-lived access token, rotating refresh token) demonstrating: Server Component fetch, middleware refresh, 401 fallback, logout, parallel requests. Include an e2e script that proves "10 parallel requests -> 1 refresh".
5. **Docs:** README (what/why/vs Auth.js and axios-auth-refresh, 5-minute quickstart), `docs/concepts.md`, `docs/nextjs.md`, `docs/security.md`, `docs/recipes.md` (custom storage adapters: cookie, DB-backed session, in-memory), API reference generated from TSDoc.
6. **Registry + release readiness:** registry templates, Changesets, CI, publish workflow, `publint`/`attw` clean.
7. *(Optional)* `/react` hooks: `useSession`, `useAuthFetch`, built on `subscribe`.

---

## 10. Definition of done

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass; coverage target met.
- The example app runs end to end and the "10 parallel requests -> 1 refresh" proof passes.
- Public API is fully TSDoc-documented; README quickstart works when copy-pasted.
- No `any` in the public API surface; no TODOs; no secrets in logs.
- `docs/decisions.md` lists every ambiguous choice and every bug fixed in the original `http-client.ts`.

Begin with `PLAN.md`, then Phase 1.

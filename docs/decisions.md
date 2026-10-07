# Architecture Decisions & Bug Fixes 📝

This document records the rationale behind key architectural decisions in `reqix` and details all security and robustness bugs fixed from standard HTTP client and interceptor designs.

---

## 1. Architectural Decisions & Ambiguous Choices

### Decision 1: Zero Runtime Dependencies in Core
- **Context**: Many libraries pull in packages for JWT parsing (e.g., `jsonwebtoken`, `jose`), locks (e.g., `web-locks-ponyfill`), or HTTP utilities.
- **Decision**: Zero external runtime dependencies in `reqix` core. Peer dependencies for Next.js and React are optional.
- **Rationale**: Keeps the bundle under ~3.5KB gzipped, eliminates supply-chain vulnerability vectors, ensures instant cold starts in Edge runtime (Vercel, Cloudflare Workers), and prevents version conflicts.

### Decision 2: Decode-Only JWT Helper (`decodeJwtExp`)
- **Context**: Determining when a token expires requires reading the `exp` claim.
- **Decision**: Provide a zero-dependency decode-only helper that parses the Base64URL payload and reads the numeric `exp` claim. Explicitly make zero claims of cryptographic signature verification.
- **Rationale**: Web apps must never trust client-side signature verification; the backend API authoritative server verifies signatures on each request. Bundling cryptographic verification libraries into client code bloats the bundle with zero added security.

### Decision 3: Callback Separation (`saveSession` vs `setSession`)
- **Context**: The naming of session management functions often causes ambiguity between user-provided persistence hooks and library-provided public methods.
- **Decision**: In `AuthOptions`, the callback is named `saveSession: (session: S) => void | Promise<void>`. On the instantiated `Auth<S>` object, the method is named `auth.setSession(session: S): Promise<void>`.
- **Rationale**: Clear semantic distinction between defining how the system stores sessions versus imperatively updating the session state from application code.

### Decision 4: Non-Crashing Server Component Cookie Writes
- **Context**: In Next.js App Router, calling `cookies().set()` inside a React Server Component throws an uncatchable Next.js error: `"Cookies can only be modified in a Server Action or Route Handler"`.
- **Decision**: Wrap cookie modifications in `createCookieSessionAdapter` with a safe catch block. If a write is blocked, invoke `onWriteBlocked(error)` and preserve the session in memory for the duration of the request.
- **Rationale**: Prevents unexpected crashes during SSR streaming while advising developers to delegate proactive refresh to Edge Middleware or Server Actions.

### Decision 5: Dual-Mode React `cache()` Feature Detection
- **Context**: React Server Components provide `React.cache()` to memoize data per request, but `cache()` does not exist in standard client bundles, Vite, or Node unit test runtimes.
- **Decision**: Dynamically detect `React.cache` in `getServerAuth`. If present, wrap the factory in `cache()`; if absent, fall back safely to local instance memoization.
- **Rationale**: Guarantees identical API ergonomics across production Server Components, client code, and automated Vitest suites.

### Decision 6: Monotonic Generation Counter for Logout Races
- **Context**: When a slow token refresh is in flight and the user clicks "Log Out", the pending refresh can resolve milliseconds later and overwrite the cleared session, causing a zombie login.
- **Decision**: Maintain a monotonic `generation` integer that increments on every `logout()` or explicit `setSession()`. When a refresh resolves, it compares `startGen === generation`; if different, the refreshed tokens are immediately discarded.
- **Rationale**: Completely eliminates zombie sessions and session corruption without requiring polling or complex state machines.

---

## 2. Robustness & Security Bugs Fixed in HTTP Client

### Bug 1: Secret Leakage in Error Objects & Logs
- **Issue**: Standard Axios or fetch wrappers log `error.config` or serialize error objects to JSON, dumping `Authorization: Bearer <secret>` and request cookies into Sentry, Datadog, or CloudWatch logs.
- **Fix**: Implemented strict redaction in `HttpError.prototype.toJSON()`. Headers (`authorization`, `cookie`, `set-cookie`) and sensitive body fields (`accessToken`, `refreshToken`, `password`) are replaced with `"[REDACTED]"`.

### Bug 2: Timeout vs. Explicit Cancellation Ambiguity
- **Issue**: Native `fetch` aborts reject with a generic `AbortError`. Developers cannot reliably distinguish whether a request timed out after 5000ms or was canceled because the user navigated away.
- **Fix**: Coordinated `AbortController` wrappers flag timeout triggers explicitly, setting `error.isTimeout = true` versus `error.isCanceled = true`.

### Bug 3: Global Timeout Breaking Retries
- **Issue**: When an HTTP client applies a 5000ms timeout at the top level and retry attempts take 2000ms each, the third attempt times out prematurely due to accumulated time.
- **Fix**: Applied timeouts **per-attempt** with a fresh timer for each retry, while still honoring the overall caller `signal`.

### Bug 4: Thundering Herd Retry Backoff (Missing Jitter)
- **Issue**: Pure exponential backoff ($2^n \times \text{delay}$) causes parallel failed requests to retry at the exact same millisecond, hammering a recovering backend.
- **Fix**: Added full randomized jitter: `delay * (0.5 + Math.random() * 0.5)`, smoothing traffic distribution during backend degradation.

### Bug 5: Ignoring `Retry-After` Headers
- **Issue**: Standard clients retry blindly against rate-limited (`429 Too Many Requests`) servers, worsening rate limits.
- **Fix**: Parsed both delta-seconds and HTTP-date formats in the `Retry-After` response header, sleeping until the server-instructed window before retrying.

### Bug 6: Node.js 18+ `ReadableStream` Duplex Error
- **Issue**: Streaming request bodies via native fetch in Node 18+ throws `TypeError: RequestInit: duplex option is required when sending a body`.
- **Fix**: Automatically detected `ReadableStream` request bodies and injected `duplex: 'half'` on Node.js runtimes.

### Bug 7: `exactOptionalPropertyTypes` Undefined Pollution
- **Issue**: When using TypeScript's strict `exactOptionalPropertyTypes`, merging `{ ...defaults, ...options }` spreads `undefined` values, overriding default options and corrupting cookie names.
- **Fix**: Implemented strict `NormalizedCookieNames` using nullish coalescing (`??`) to guarantee defined values.

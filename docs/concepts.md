# Core Architecture & Concepts 🧠

This document details the internal orchestration mechanics of `reqix`.

---

## 1. The Headless Philosophy

Many authentication libraries attempt to be an all-in-one identity provider, forcing specific database schemas, session formats, or UI components onto your stack.

`reqix` is intentionally **headless**:
- **You own the network requests**: You write the code that speaks to your backend (`refreshSession`, `login`, `logout`).
- **You own the session storage**: You choose whether sessions are kept in `HttpOnly` cookies, `sessionStorage`, IndexedDB, or an in-memory Map.
- **`reqix` guarantees the distributed systems behavior**: Concurrency deduplication, single-flight queuing, race prevention, tab synchronization, and token lifecycle management.

```
┌────────────────────────────────────────────────────────┐
│                   Your Application                     │
│  - Storage Callbacks (getSession, saveSession)         │
│  - Backend Network Call (refreshSession)               │
└──────────────────────────┬─────────────────────────────┘
                           │
             Inversion of Control (Callbacks)
                           │
┌──────────────────────────▼─────────────────────────────┐
│                   reqix Engine                      │
│  1. Single-Flight Promise Deduplication                │
│  2. Cross-Tab Mutual Exclusion (Web Locks)             │
│  3. Proactive Expiry vs Reactive 401 Retry             │
│  4. Stale-401 Detection & Generation Safety            │
│  5. Active Request Cancellation on Logout              │
└────────────────────────────────────────────────────────┘
```

---

## 2. Single-Flight Concurrency Guarantee

### The Problem: The Thundering Herd
When a page loads, a modern application fires multiple parallel network requests (e.g., user profile, notifications, navigation items, metrics). If the access token is expired or close to expiry:
- Naive interceptors fire a separate `/refresh` call for **every single request**.
- If the backend uses **rotating refresh tokens** (where using a refresh token invalidates it and issues a new one), the second refresh call fails with `invalid_grant` or triggers fraud detection, abruptly logging the user out.

### The Solution: `SingleFlight`
`reqix` implements an asynchronous `SingleFlight<T>` coordinator:

```typescript
export class SingleFlight<T> {
  private activeToken: object | null = null;
  private inFlightPromise: Promise<T> | null = null;

  async do(fn: () => Promise<T>): Promise<T> {
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }
    const currentToken = {};
    this.activeToken = currentToken;
    this.inFlightPromise = (async () => {
      try {
        return await fn();
      } finally {
        if (this.activeToken === currentToken) {
          this.activeToken = null;
          this.inFlightPromise = null;
        }
      }
    })();
    return this.inFlightPromise;
  }
}
```

When 10 parallel requests detect an expired token:
1. Request 1 acquires the single-flight slot and begins `options.refreshSession()`.
2. Requests 2 through 10 inspect the state, find `inFlightPromise` already active, and immediately attach to that same Promise.
3. When the refresh resolves, **all 10 requests receive the exact same new session** and proceed to execute their original HTTP calls with the newly acquired token.

---

## 3. Two-Tier Refresh: Proactive vs Reactive

`reqix` operates a two-tiered refresh model:

### Tier 1: Proactive Refresh (Pre-flight)
Before any request is sent, `reqix` checks the current token's expiration:
$$\text{now} \ge \text{exp} - (\text{refreshBeforeExpirySec} + \text{clockSkewSec})$$
- Default `refreshBeforeExpirySec`: 30 seconds.
- Default `clockSkewSec`: 5 seconds.
If true, `reqix` refreshes the token **before** making the request, preventing an unnecessary round-trip and avoiding a 401 error.

### Tier 2: Reactive Retry (Post-response)
If a backend rejects an access token with a `401 Unauthorized` (e.g., if the user's role changed, a secret was rotated, or clock skew exceeded the threshold):
1. `reqix` catches the 401.
2. Checks whether a refresh is already in-flight or if another request already refreshed the token (**Stale 401 check**).
3. If fresh token is available, retries immediately.
4. If not, invokes single-flight `refreshSession()`.
5. Upon successful refresh, retries the request exactly once with the new token.

---

## 4. Stale-401 Deduplication

Consider this sequence:
1. Request A and Request B fire at $t_0$.
2. Both send Token $X$.
3. Request A receives a 401, invokes `refreshSession()`, and stores new Token $Y$.
4. Request B receives a 401 shortly after Request A completed its refresh.

If Request B were to blindly call `refreshSession()` again, it would cause an unnecessary backend round-trip (and potentially invalidate Token $Y$ if tokens rotate).

`reqix` records the specific token that was attached to each outgoing request (`_sentWithToken`). When Request B receives a 401:
```typescript
const sentToken = config._sentWithToken;
const latest = await options.getSession();

if (latest && sentToken && latest.accessToken !== sentToken) {
  // Token was ALREADY refreshed while Request B was in flight!
  // Retry immediately using `latest` without refreshing again!
  retryWith(latest);
} else {
  // Genuinely stale; proceed to refresh
  const fresh = await executeRefresh();
  retryWith(fresh);
}
```

---

## 5. Generation Tracking & Race Avoidance

A critical flaw in standard interceptors is race conditions between **refreshing** and **logging out**:

1. Request initiates token refresh.
2. User clicks "Log Out". `clearSession()` is executed.
3. 200ms later, the slow refresh request resolves and calls `saveSession(newTokens)`.
4. The user is logged back in as a zombie session!

To eliminate this, `createAuth` maintains a strictly monotonic generation counter:

```typescript
let generation = 0;

function invalidatePendingOperations() {
  generation++;
}
```

Whenever `logout()` or `setSession()` is invoked:
- `invalidatePendingOperations()` increments `generation`.
- All active in-flight fetch requests are aborted via their coordinated `AbortController`.
- When an in-flight `executeRefresh()` finishes, it compares its starting generation with current generation:
  ```typescript
  if (startGen !== generation) {
    throw new AuthError('REFRESH_FAILED', 'Refresh result discarded due to concurrent session change');
  }
  ```
Stale refresh payloads are strictly discarded, and no token is written to storage.

---

## 6. Multi-Tab Synchronization

In browser environments, users frequently open multiple tabs:
- **`createWebLock()`**: Uses the Web Locks API (`navigator.locks.request`). When multiple tabs make requests with an expired token at the exact same millisecond, only ONE tab executes the network refresh call; the others wait for the lock release and read the updated session from storage.
- **Cross-Tab `BroadcastChannel`**: Automatically notifies other tabs of session state changes (e.g. user logged in tab 1, or user logged out in tab 2) so all tabs update their UI reactively without page reloads.

# Security & Threat Model 🛡️

Authentication and token orchestration are high-impact attack surfaces. This document details the security principles, threat model, and defense mechanisms built into `reqix`.

---

## 1. Threat Model & Trust Boundaries

```
┌────────────────────────────────────────────────────────┐
│                      Client Browser                    │
│   Untrusted environment; susceptible to XSS & CSRF     │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTPS (TLS)
                           ▼
┌────────────────────────────────────────────────────────┐
│                 Next.js Edge / Node Server             │
│   Trusted proxy; manages HttpOnly cookies & middleware │
└──────────────────────────┬─────────────────────────────┘
                           │ Internal VPC / HTTPS
                           ▼
┌────────────────────────────────────────────────────────┐
│                   JWT Auth Backend                     │
│   Authoritative source; signs JWTs & manages DB sessions│
└────────────────────────────────────────────────────────┘
```

### Trust Boundary Rules
1. **The Client is Untrusted**: Any data coming from client headers, cookies, query parameters, or request bodies must be validated before use.
2. **The Library is Decode-Only**: `reqix` **never** claims to cryptographically verify JWT signatures on the client. Signature verification is the sole responsibility of the authoritative authentication backend.
3. **Storage Isolation**: Tokens should be stored in the narrowest scope feasible to prevent exfiltration.

---

## 2. Token Storage Recommendations

### In Next.js Applications: `HttpOnly` Cookies (Recommended)
By default, `reqix/next` stores tokens in cookies configured with:
```typescript
{
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
}
```
- **`HttpOnly: true`**: Inaccessible to JavaScript running in the browser, completely protecting tokens from exfiltration via Cross-Site Scripting (XSS).
- **`Secure: true`**: Only transmitted over encrypted HTTPS connections.
- **`SameSite: 'lax'`**: Mitigates Cross-Site Request Forgery (CSRF) for standard top-level navigation while permitting necessary site interactions.

### In Single-Page Applications (SPA): In-Memory or `sessionStorage`
- **In-Memory Storage (Best for SPAs)**: Store tokens in JavaScript variables. Tokens vanish when the tab is closed, offering high defense against persistent token theft.
- **`sessionStorage`**: Retained only for the duration of the page session (isolated to the tab).
- **⚠️ Avoid `localStorage` for Refresh Tokens**: `localStorage` persists indefinitely across tabs and windows and is vulnerable to any script injected via XSS. If you must use `localStorage`, ensure your backend enforces strict token rotation and short token lifetimes.

---

## 3. Cross-Site Request Forgery (CSRF) Mitigation

State-changing authentication requests (such as `POST /api/auth/login` or `POST /api/auth/logout`) could be abused if an attacker triggers a request from a malicious external site.

`reqix/next` enforces **Same-Origin Validation** via `assertSameOrigin`:

```typescript
export function assertSameOrigin(request: Request | NextRequest): boolean {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');

  // Extracts host from Origin or Referer and asserts it matches Host header
  // Blocks cross-origin POST requests immediately with 403 Forbidden
}
```

Any request originating from a different origin is aborted before any credentials or cookies are processed.

---

## 4. Open-Redirect Defense

Attackers frequently craft phishing links using open redirects (e.g., `https://yourapp.com/login?callbackUrl=https://attacker.com`). If an application blindly redirects users to `callbackUrl` after login, users are routed to phishing pages.

`reqix/next` protects all redirect resolution via `validateRedirectUrl`:

```typescript
export function validateRedirectUrl(url: string, baseOrigin?: string): string {
  // 1. Strictly allows relative paths starting with single '/'
  // 2. Explicitly blocks protocol-relative URLs starting with '//'
  // 3. Explicitly blocks backslashes '/\' or '\\'
  // 4. If an absolute URL is supplied, validates that origin strictly equals baseOrigin
  // 5. Falls back safely to '/' if validation fails
}
```

---

## 5. Token Redaction in Error Objects & Logs

A common vulnerability in fetch wrappers and Axios interceptors is logging `error.config` or `error.response` during debugging, unintentionally printing the `Authorization: Bearer eyJ...` header or session tokens to log collectors (e.g., Datadog, CloudWatch, Sentry).

`reqix` provides **hardened redaction**:

- In `HttpError.prototype.toJSON()`:
  - Headers `authorization`, `cookie`, and `set-cookie` are replaced with `[REDACTED]`.
  - Body fields `accessToken`, `refreshToken`, `token`, and `password` are replaced with `[REDACTED]`.
- In `HttpError.prototype.toString()` and console inspections:
  - Error messages only mention the HTTP status code, URL path, and redacted metadata.

```typescript
// Example toJSON() output:
{
  "name": "HttpError",
  "message": "Request failed with status code 401",
  "status": 401,
  "config": {
    "url": "https://api.company.com/data",
    "headers": {
      "authorization": "[REDACTED]"
    }
  }
}
```

---

## 6. JWT Decoding Safety

The helper function `decodeJwtExp(token: string): number | null`:
1. Splits the token by `.` into 3 components.
2. Extracts component 1 (the payload).
3. Decodes Base64URL encoding into a UTF-8 string.
4. Executes `JSON.parse` to extract `exp`.
5. Validates that `exp` is a finite integer.

**Security Constraints**:
- Uses **no** dynamic code execution (`eval` or `new Function()`).
- Does **not** claim to verify cryptographic signatures. Signature verification is performed by your authorization server.

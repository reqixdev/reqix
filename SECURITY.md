# Security Policy

## Supported Versions

Security updates and patches are applied to the following versions of `Reqix`:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

The security of `Reqix` and the applications built on top of it is paramount. If you discover a security vulnerability, please report it privately via GitHub Security Advisories:

1. Navigate to the **Security** tab of the repository on GitHub.
2. Click **Report a vulnerability** to open a private advisory.
3. Provide a clear description, reproduction steps, and impact assessment.

## Security Guarantees in `Reqix`

1. **Zero Secret Leaks in Logs:**
   - Authorization headers (`Authorization`, `Cookie`, `Set-Cookie`) and session tokens (`accessToken`, `refreshToken`, `token`) are strictly redacted in `HttpError.prototype.toJSON()`, string conversions, and error inspect outputs.
2. **Open Redirect Defense:**
   - `validateRedirectUrl` strictly enforces safe relative paths (starts with a single `/`, rejecting protocol-relative `//` and backslashes) or verified same-origin destinations.
3. **CSRF Mitigation:**
   - `assertSameOrigin` validates standard `Origin` and `Referer` headers against `Host` / `x-forwarded-host` on state-changing Route Handler invocations (`/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`).
4. **JWT Decoding Safety:**
   - `decodeJwtExp` strictly parses Base64URL payload JSON to read the numeric `exp` claim. It makes **zero** claims of cryptographic signature verification and avoids dynamic evaluation (`eval` or `Function`). Cryptographic validation must always be performed by your authorization backend.
5. **Secure Cookie Defaults:**
   - Next.js cookie adapters enforce `HttpOnly: true`, `SameSite: 'lax'`, `path: '/'`, and `secure: true` in production environments.

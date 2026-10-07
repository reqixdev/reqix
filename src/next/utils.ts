/**
 * Validates a redirect URL parameter to strictly prevent Open Redirect vulnerabilities.
 *
 * Only relative root-based paths (e.g., `/dashboard`) are permitted.
 * Protocol-relative URLs (e.g., `//malicious.com`) and javascript/data URI schemes are rejected.
 *
 * @param url Candidate redirect URL
 * @param fallback Safe fallback path (default: '/')
 */
export function validateRedirectUrl(url: string | null | undefined, fallback = '/'): string {
  if (!url || typeof url !== 'string') {
    return fallback;
  }

  const trimmed = url.trim();

  // Reject empty or obvious non-paths
  if (!trimmed) {
    return fallback;
  }

  // Reject dangerous schemes
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return fallback;
  }

  // Reject protocol-relative URLs (//example.com) and backslashes (/\example.com)
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.startsWith('\\')) {
    return fallback;
  }

  // Must begin with a single forward slash
  if (trimmed.startsWith('/')) {
    // Ensure no control characters or CRLF injection
    if (/[\r\n\0\t]/.test(trimmed)) {
      return fallback;
    }
    return trimmed;
  }

  return fallback;
}

/**
 * Validates that an incoming state-changing HTTP request originates from the same origin (CSRF mitigation).
 *
 * Checks `Origin` or `Referer` against `Host` or `X-Forwarded-Host`.
 */
export function assertSameOrigin(request: Request): boolean {
  const headers = request.headers;
  const origin = headers.get('origin');
  const referer = headers.get('referer');
  const host = headers.get('x-forwarded-host') || headers.get('host');

  if (!host) {
    // If no host header exists, fail close
    return false;
  }

  if (origin) {
    try {
      const originUrl = new URL(origin);
      return originUrl.host.toLowerCase() === host.toLowerCase();
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      return refererUrl.host.toLowerCase() === host.toLowerCase();
    } catch {
      return false;
    }
  }

  // If neither Origin nor Referer is present on a state-changing method, fail close
  return false;
}

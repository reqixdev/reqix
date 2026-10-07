import type { InternalRequestConfig } from './types.js';

export interface HttpErrorOptions<T = unknown> {
  message: string;
  code?: string | undefined;
  config: InternalRequestConfig;
  request?: Request | undefined;
  response?: Response | undefined;
  data?: T | undefined;
  cause?: unknown;
}

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-refresh-token',
]);

const SENSITIVE_DATA_KEY = /(token|secret|password|cookie|authorization|api[-_]?key)/i;

/** Redacts credential-shaped fields from an error body before serialization. */
function sanitizeErrorData(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeErrorData(item, seen, depth + 1));
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return '[Non-serializable]';
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_DATA_KEY.test(key) ? '[REDACTED]' : sanitizeErrorData(item, seen, depth + 1);
  }
  return sanitized;
}

/**
 * Sanitizes headers for safe logging/serialization without leaking tokens or credentials.
 */
export function sanitizeHeaders(headers: HeadersInit | Headers | Record<string, string | undefined> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  if (headers instanceof Headers) {
    headers.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (SENSITIVE_HEADER_NAMES.has(lower) || lower.includes('token') || lower.includes('secret') || lower.includes('auth')) {
        result[lower] = '[REDACTED]';
      } else {
        result[lower] = val;
      }
    });
  } else if (Array.isArray(headers)) {
    for (const [key, val] of headers) {
      const lower = key.toLowerCase();
      if (SENSITIVE_HEADER_NAMES.has(lower) || lower.includes('token') || lower.includes('secret') || lower.includes('auth')) {
        result[lower] = '[REDACTED]';
      } else {
        result[lower] = val;
      }
    }
  } else {
    for (const [key, val] of Object.entries(headers)) {
      if (typeof val === 'string') {
        const lower = key.toLowerCase();
        if (SENSITIVE_HEADER_NAMES.has(lower) || lower.includes('token') || lower.includes('secret') || lower.includes('auth')) {
          result[lower] = '[REDACTED]';
        } else {
          result[lower] = val;
        }
      }
    }
  }

  return result;
}

/**
 * Standard HTTP Error for all request/response failures.
 * Never serializes sensitive credentials or headers.
 */
export class HttpError<T = unknown> extends Error {
  readonly isHttpError = true;
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly statusText?: string | undefined;
  readonly headers?: Headers | undefined;
  readonly data?: T | undefined;
  readonly config: InternalRequestConfig;
  readonly request?: Request | undefined;
  readonly response?: Response | undefined;
  readonly cause?: unknown;

  constructor(options: HttpErrorOptions<T>) {
    super(options.message);
    this.name = 'HttpError';
    this.code = options.code;
    this.config = options.config;
    this.request = options.request;
    this.response = options.response;
    this.data = options.data;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }

    if (options.response) {
      this.status = options.response.status;
      this.statusText = options.response.statusText;
      this.headers = options.response.headers;
    }

    // Maintain prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Safe JSON representation redacting all sensitive headers and secrets.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      statusText: this.statusText,
      data: sanitizeErrorData(this.data),
      config: {
        url: this.config.url,
        method: this.config.method,
        baseURL: this.config.baseURL,
        headers: sanitizeHeaders(this.config.headers),
        timeout: this.config.timeout,
      },
    };
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return typeof error === 'object' && error !== null && (error as HttpError).isHttpError === true;
}

export class CanceledError extends HttpError {
  constructor(message = 'Request canceled', config: InternalRequestConfig, cause?: unknown) {
    super({
      message,
      code: 'ERR_CANCELED',
      config,
      cause,
    });
    this.name = 'CanceledError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TimeoutError extends HttpError {
  constructor(timeoutMs: number, config: InternalRequestConfig) {
    super({
      message: `timeout of ${timeoutMs}ms exceeded`,
      code: 'ECONNABORTED',
      config,
    });
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ParseError extends HttpError {
  constructor(message: string, config: InternalRequestConfig, response: Response, rawData: unknown) {
    super({
      message,
      code: 'ERR_PARSE',
      config,
      response,
      data: rawData,
    });
    this.name = 'ParseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

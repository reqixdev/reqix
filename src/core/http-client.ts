import { HttpError, CanceledError, TimeoutError, ParseError } from './errors.js';
import type {
  HttpClientConfig,
  InternalRequestConfig,
  HttpResponse,
  InterceptorHandler,
  InterceptorManager,
  RequestConfig,
} from './types.js';

class InterceptorManagerImpl<V> implements InterceptorManager<V> {
  private handlers: Array<InterceptorHandler<V> | null> = [];

  use(
    onFulfilled?: ((value: V) => V | Promise<V>) | undefined,
    onRejected?: ((error: unknown) => unknown) | undefined
  ): number {
    this.handlers.push({ onFulfilled, onRejected });
    return this.handlers.length - 1;
  }

  eject(id: number): void {
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  }

  clear(): void {
    this.handlers = [];
  }

  getHandlers(): Array<InterceptorHandler<V>> {
    return this.handlers.filter((h): h is InterceptorHandler<V> => h !== null);
  }
}

const DEFAULT_RETRY_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];
const DEFAULT_RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Checks if a value is a plain JavaScript object.
 */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === null || proto === Object.prototype;
}

/**
 * Parses Retry-After header into milliseconds delay.
 */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  // Check if it's integer seconds
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return Math.max(0, seconds * 1000);
  }
  // Try parsing as HTTP Date
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

/**
 * Builds full URL combining baseURL, url, and params.
 */
function buildFullUrl(baseURL: string | undefined, relativeUrl: string | undefined, params: RequestConfig['params']): string {
  let fullUrl = relativeUrl || '';

  if (baseURL && !/^https?:\/\//i.test(fullUrl)) {
    const cleanBase = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const cleanPath = fullUrl.startsWith('/') ? fullUrl : `/${fullUrl}`;
    fullUrl = `${cleanBase}${cleanPath}`;
  }

  if (params) {
    const searchParams = new URLSearchParams();
    if (params instanceof URLSearchParams) {
      params.forEach((v, k) => searchParams.append(k, v));
    } else if (typeof params === 'string') {
      const sp = new URLSearchParams(params);
      sp.forEach((v, k) => searchParams.append(k, v));
    } else if (typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach((v) => searchParams.append(key, String(v)));
          } else {
            searchParams.append(key, String(value));
          }
        }
      }
    }

    const queryString = searchParams.toString();
    if (queryString) {
      const separator = fullUrl.includes('?') ? '&' : '?';
      fullUrl = `${fullUrl}${separator}${queryString}`;
    }
  }

  return fullUrl;
}

/**
 * Safely serializes body data and sets Content-Type if necessary.
 */
function serializeBody(data: unknown, headers: Headers): BodyInit | null | undefined {
  if (data === undefined || data === null) {
    return undefined;
  }

  // FormData: do NOT set Content-Type header so fetch sets boundary
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    headers.delete('content-type');
    return data;
  }

  // URLSearchParams
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
    return data;
  }

  // Blob
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data;
  }

  // ArrayBuffer or ArrayBufferView
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return data as BodyInit;
  }

  // ReadableStream
  if (typeof ReadableStream !== 'undefined' && data instanceof ReadableStream) {
    return data as BodyInit;
  }

  // String
  if (typeof data === 'string') {
    return data;
  }

  // Plain objects, arrays, numbers, booleans -> JSON
  if (isPlainObject(data) || Array.isArray(data) || typeof data === 'number' || typeof data === 'boolean') {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return JSON.stringify(data);
  }

  return data as BodyInit;
}

export class HttpClient {
  defaults: HttpClientConfig;
  readonly interceptors: {
    request: InterceptorManager<InternalRequestConfig>;
    response: InterceptorManager<HttpResponse<unknown>>;
  };

  constructor(defaultConfig: HttpClientConfig = {}) {
    this.defaults = { ...defaultConfig };
    this.interceptors = {
      request: new InterceptorManagerImpl<InternalRequestConfig>(),
      response: new InterceptorManagerImpl<HttpResponse<unknown>>(),
    };
  }

  create(config: HttpClientConfig = {}): HttpClient {
    const mergedHeaders = new Headers();

    if (this.defaults.headers) {
      new Headers(this.defaults.headers as HeadersInit).forEach((val, key) => mergedHeaders.set(key, val));
    }
    if (config.headers) {
      new Headers(config.headers as HeadersInit).forEach((val, key) => mergedHeaders.set(key, val));
    }

    const client = new HttpClient({
      ...this.defaults,
      ...config,
      headers: mergedHeaders,
    });

    return client;
  }

  async request<T = unknown>(config: RequestConfig): Promise<HttpResponse<T>> {
    // 1. Merge defaults with call config
    const mergedHeaders = new Headers();
    if (this.defaults.headers) {
      new Headers(this.defaults.headers as HeadersInit).forEach((val, key) => mergedHeaders.set(key, val));
    }
    if (config.headers) {
      new Headers(config.headers as HeadersInit).forEach((val, key) => mergedHeaders.set(key, val));
    }

    let internalConfig: InternalRequestConfig = {
      ...this.defaults,
      ...config,
      method: (config.method || this.defaults.method || 'GET').toUpperCase(),
      url: buildFullUrl(config.baseURL || this.defaults.baseURL, config.url, config.params || this.defaults.params),
      headers: mergedHeaders,
    };

    // Serialize body if data is provided and body is not explicitly set
    if (internalConfig.data !== undefined && internalConfig.body === undefined) {
      const body = serializeBody(internalConfig.data, internalConfig.headers);
      if (body !== undefined) {
        internalConfig.body = body;
      }
    }

    // 2. Run request interceptors ONCE per logical request
    const requestHandlers = (this.interceptors.request as InterceptorManagerImpl<InternalRequestConfig>).getHandlers();
    for (const handler of requestHandlers) {
      try {
        if (handler.onFulfilled) {
          internalConfig = await handler.onFulfilled(internalConfig);
        }
      } catch (err) {
        if (handler.onRejected) {
          await handler.onRejected(err);
        }
        throw err;
      }
    }

    // 3. Execute request with retry loop
    let response: HttpResponse<T>;
    try {
      response = await this.executeWithRetry<T>(internalConfig);
    } catch (err) {
      // Check auth error handler extension hook
      if (internalConfig._onResponseError) {
        const handled = await internalConfig._onResponseError(err, internalConfig);
        if (handled) {
          return handled as HttpResponse<T>;
        }
      }

      // Run response rejected interceptors
      let finalError = err;
      const responseHandlers = (this.interceptors.response as InterceptorManagerImpl<HttpResponse<unknown>>).getHandlers();
      for (const handler of responseHandlers) {
        if (handler.onRejected) {
          try {
            const result = await handler.onRejected(finalError);
            if (result && typeof result === 'object' && 'data' in result && 'status' in result) {
              return result as HttpResponse<T>;
            }
          } catch (interceptorErr) {
            finalError = interceptorErr;
          }
        }
      }
      throw finalError;
    }

    // 4. Run response fulfilled interceptors
    let finalResponse = response;
    const responseHandlers = (this.interceptors.response as InterceptorManagerImpl<HttpResponse<unknown>>).getHandlers();
    for (const handler of responseHandlers) {
      try {
        if (handler.onFulfilled) {
          finalResponse = (await handler.onFulfilled(finalResponse)) as HttpResponse<T>;
        }
      } catch (err) {
        if (handler.onRejected) {
          const result = await handler.onRejected(err);
          if (result && typeof result === 'object' && 'data' in result && 'status' in result) {
            finalResponse = result as HttpResponse<T>;
            continue;
          }
        }
        throw err;
      }
    }

    return finalResponse;
  }

  private async executeWithRetry<T>(config: InternalRequestConfig): Promise<HttpResponse<T>> {
    const maxRetries = typeof config.retry === 'number' ? config.retry : 0;
    const retryMethods = config.retryMethods || DEFAULT_RETRY_METHODS;
    const retryStatusCodes = config.retryStatusCodes || DEFAULT_RETRY_STATUS_CODES;

    let attempt = 0;
    while (true) {
      // Hook before each attempt (used by createAuth for token injection)
      if (config._beforeAttempt) {
        const updated = await config._beforeAttempt(config);
        if (updated) {
          config = updated;
        }
      }

      try {
        return await this.executeAttempt<T>(config);
      } catch (err) {
        // If cancellation, do not retry
        if (err instanceof CanceledError || (err instanceof HttpError && err.code === 'ERR_CANCELED')) {
          throw err;
        }

        const isLastAttempt = attempt >= maxRetries;
        if (isLastAttempt) {
          throw err;
        }

        // Check retryability
        const methodUpper = config.method.toUpperCase();
        let shouldRetry = retryMethods.includes(methodUpper);

        if (err instanceof HttpError && err.status !== undefined) {
          shouldRetry = shouldRetry && retryStatusCodes.includes(err.status);
        }

        if (config.retryCondition) {
          shouldRetry = await config.retryCondition(err, config);
        }

        if (!shouldRetry) {
          throw err;
        }

        // Calculate backoff delay
        let delayMs = 0;
        if (err instanceof HttpError && err.headers) {
          const retryAfterMs = parseRetryAfter(err.headers.get('retry-after'));
          if (retryAfterMs !== null) {
            delayMs = retryAfterMs;
          }
        }

        if (delayMs === 0) {
          if (typeof config.retryDelay === 'function') {
            delayMs = config.retryDelay(attempt, err);
          } else if (typeof config.retryDelay === 'number') {
            delayMs = config.retryDelay;
          } else {
            // Exponential backoff + jitter
            const base = 200 * Math.pow(2, attempt);
            const jitter = Math.random() * 100;
            delayMs = Math.round(base + jitter);
          }
        }

        attempt++;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
  }

  private async executeAttempt<T>(config: InternalRequestConfig): Promise<HttpResponse<T>> {
    // Check if user signal is already aborted
    if (config.signal?.aborted) {
      throw new CanceledError('Request aborted before execution', config, config.signal.reason);
    }

    const fetchFn = config.fetch || globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw new HttpError({
        message: 'No fetch implementation available',
        code: 'ERR_NO_FETCH',
        config,
      });
    }

    // Prepare abort controller for timeout and cancellation coordination
    const abortController = new AbortController();
    let isTimedOut = false;
    let isCanceled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const onUserAbort = () => {
      isCanceled = true;
      abortController.abort(config.signal?.reason);
    };

    if (config.signal) {
      config.signal.addEventListener('abort', onUserAbort, { once: true });
    }

    const timeout = config.timeout || 0;
    if (timeout > 0) {
      timeoutTimer = setTimeout(() => {
        isTimedOut = true;
        abortController.abort();
      }, timeout);
    }

    // Build RequestInit ensuring internal keys are never passed to fetch
    const requestInit: RequestInit & { next?: RequestConfig['next'] } = {
      method: config.method,
      headers: config.headers,
      signal: abortController.signal,
    };

    if (config.body !== undefined) {
      requestInit.body = config.body;
      if (typeof ReadableStream !== 'undefined' && config.body instanceof ReadableStream) {
        (requestInit as unknown as Record<string, unknown>)['duplex'] = 'half';
      }
    }
    if (config.cache !== undefined) {
      requestInit.cache = config.cache;
    }
    if (config.credentials !== undefined) {
      requestInit.credentials = config.credentials;
    }
    if (config.mode !== undefined) {
      requestInit.mode = config.mode;
    }
    if (config.redirect !== undefined) {
      requestInit.redirect = config.redirect;
    }
    if (config.referrer !== undefined) {
      requestInit.referrer = config.referrer;
    }
    if (config.referrerPolicy !== undefined) {
      requestInit.referrerPolicy = config.referrerPolicy;
    }
    if (config.integrity !== undefined) {
      requestInit.integrity = config.integrity;
    }
    if (config.keepalive !== undefined) {
      requestInit.keepalive = config.keepalive;
    }
    if (config.next !== undefined) {
      requestInit.next = config.next;
    }

    let rawResponse: Response;
    try {
      rawResponse = await fetchFn(config.url, requestInit);
    } catch (fetchErr: unknown) {
      if (isCanceled) {
        throw new CanceledError('Request canceled', config, config.signal?.reason);
      }
      if (isTimedOut) {
        throw new TimeoutError(timeout, config);
      }
      if (config.signal?.aborted) {
        throw new CanceledError('Request canceled', config, config.signal.reason);
      }
      throw new HttpError({
        message: fetchErr instanceof Error ? fetchErr.message : 'Network Error',
        code: 'ERR_NETWORK',
        config,
        cause: fetchErr,
      });
    } finally {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
      }
      if (config.signal) {
        config.signal.removeEventListener('abort', onUserAbort);
      }
    }

    // Safe Response Parsing
    const data = await this.parseResponseBody(rawResponse, config);

    // If HTTP status is not ok (>= 400), throw HttpError
    if (!rawResponse.ok) {
      throw new HttpError<T>({
        message: `Request failed with status code ${rawResponse.status}`,
        code: `ERR_BAD_RESPONSE_${rawResponse.status}`,
        config,
        response: rawResponse,
        data: data as T,
      });
    }

    return {
      data: data as T,
      status: rawResponse.status,
      statusText: rawResponse.statusText,
      headers: rawResponse.headers,
      config,
      request: new Request(config.url, requestInit),
      response: rawResponse,
    };
  }

  private async parseResponseBody(response: Response, config: InternalRequestConfig): Promise<unknown> {
    const status = response.status;
    const methodUpper = config.method.toUpperCase();

    // 204 No Content, 205 Reset Content, 304 Not Modified, HEAD requests
    if (status === 204 || status === 205 || status === 304 || methodUpper === 'HEAD') {
      return null;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength === '0') {
      return null;
    }

    const responseType = config.responseType || 'json';

    if (responseType === 'stream') {
      return response.body;
    }
    if (responseType === 'blob') {
      return await response.blob();
    }
    if (responseType === 'arraybuffer') {
      return await response.arrayBuffer();
    }

    const text = await response.text();
    if (!text || text.trim() === '') {
      return null;
    }

    if (responseType === 'text') {
      return text;
    }

    // responseType === 'json'
    try {
      return JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new ParseError('Failed to parse response body as JSON', config, response, text);
      }
      // On error status (>= 400), keep raw text so user can see error message
      return text;
    }
  }

  // Convenience methods
  get<T = unknown>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  delete<T = unknown>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }

  head<T = unknown>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'HEAD', url });
  }

  options<T = unknown>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'OPTIONS', url });
  }

  post<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  put<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'PUT', url, data });
  }

  patch<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'PATCH', url, data });
  }
}

export function createHttpClient(config?: HttpClientConfig): HttpClient {
  return new HttpClient(config);
}

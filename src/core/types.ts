export type Method =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options';

export type ResponseType = 'json' | 'text' | 'blob' | 'arraybuffer' | 'stream';

export interface NextFetchOptions {
  revalidate?: number | false | undefined;
  tags?: string[] | undefined;
}

export interface RequestConfig {
  url?: string | undefined;
  method?: Method | string | undefined;
  baseURL?: string | undefined;
  headers?: HeadersInit | Record<string, string | undefined> | undefined;
  params?: Record<string, unknown> | URLSearchParams | string | undefined;
  data?: unknown;
  body?: BodyInit | null | undefined;
  timeout?: number | undefined; // milliseconds, 0 means disabled
  signal?: AbortSignal | undefined;
  responseType?: ResponseType | undefined;
  fetch?: typeof fetch | undefined;
  cache?: RequestCache | undefined;
  credentials?: RequestCredentials | undefined;
  mode?: RequestMode | undefined;
  redirect?: RequestRedirect | undefined;
  referrer?: string | undefined;
  referrerPolicy?: ReferrerPolicy | undefined;
  integrity?: string | undefined;
  keepalive?: boolean | undefined;
  next?: NextFetchOptions | undefined;

  // Retry configuration
  retry?: number | false | undefined;
  retryDelay?: number | ((retryCount: number, error: unknown) => number) | undefined;
  retryMethods?: string[] | undefined;
  retryStatusCodes?: number[] | undefined;
  retryCondition?: ((error: unknown, config: InternalRequestConfig) => boolean | Promise<boolean>) | undefined;

  // Internal hooks & auth metadata
  skipAuth?: boolean | undefined;
  _sentWithToken?: string | undefined;
  _authAttempted?: boolean | undefined;
  _authRetryCount?: number | undefined;
  _beforeAttempt?: ((config: InternalRequestConfig) => Promise<InternalRequestConfig | void> | InternalRequestConfig | void) | undefined;
  _onResponseError?: ((error: unknown, config: InternalRequestConfig) => Promise<HttpResponse<unknown> | void> | HttpResponse<unknown> | void) | undefined;
}

export interface InternalRequestConfig extends RequestConfig {
  url: string;
  method: string;
  headers: Headers;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  config: InternalRequestConfig;
  request: Request;
  response: Response;
}

export interface InterceptorHandler<V> {
  onFulfilled?: ((value: V) => V | Promise<V>) | undefined;
  onRejected?: ((error: unknown) => unknown) | undefined;
}

export interface InterceptorManager<V> {
  use(
    onFulfilled?: ((value: V) => V | Promise<V>) | undefined,
    onRejected?: ((error: unknown) => unknown) | undefined
  ): number;
  eject(id: number): void;
  clear(): void;
}

export interface HttpClientConfig extends RequestConfig {}

import { describe, it, expect, vi } from 'vitest';
import { createHttpClient } from '../../src/core/http-client.js';
import type { InternalRequestConfig } from '../../src/core/types.js';

describe('HttpClient Deep Coverage', () => {
  it('parses Retry-After with HTTP Date format', async () => {
    let calls = 0;
    const futureDate = new Date(Date.now() + 50).toUTCString();
    const mockFetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(
          new Response('Too Many Requests', {
            status: 429,
            headers: { 'Retry-After': futureDate },
          })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const client = createHttpClient({ fetch: mockFetch as unknown as typeof fetch, retry: 1 });
    const res = await client.get<{ ok: boolean }>('https://api.example.com/date-retry');
    expect(res.data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('handles ArrayBuffer, Uint8Array and ReadableStream body serialization', async () => {
    let capturedBody: unknown;
    const mockFetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
      capturedBody = init.body;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const client = createHttpClient({ fetch: mockFetch as unknown as typeof fetch });

    const buffer = new ArrayBuffer(8);
    await client.post('https://api.example.com/buffer', buffer);
    expect(capturedBody).toBe(buffer);

    const u8 = new Uint8Array([1, 2, 3]);
    await client.post('https://api.example.com/u8', u8);
    expect(capturedBody).toBe(u8);

    const stream = new ReadableStream();
    await client.post('https://api.example.com/stream', stream);
    expect(capturedBody).toBe(stream);
  });

  it('forwards Next.js fetch options cache, credentials, integrity, keepalive and next.revalidate', async () => {
    let capturedInit: RequestInit & { next?: { revalidate?: number | false } } | undefined;
    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      capturedInit = init;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const client = createHttpClient({ fetch: mockFetch as unknown as typeof fetch });
    await client.get('https://api.example.com/next-opts', {
      cache: 'force-cache',
      credentials: 'include',
      mode: 'cors',
      redirect: 'follow',
      referrer: 'https://referrer.example.com',
      integrity: 'sha256-abc',
      keepalive: true,
      next: { revalidate: 60, tags: ['posts'] },
    });

    expect(capturedInit?.cache).toBe('force-cache');
    expect(capturedInit?.credentials).toBe('include');
    expect(capturedInit?.integrity).toBe('sha256-abc');
    expect(capturedInit?.keepalive).toBe(true);
    expect(capturedInit?.next?.revalidate).toBe(60);
  });

  it('interceptor rejection handlers recover and transform errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }));
    const client = createHttpClient({ fetch: mockFetch as unknown as typeof fetch });

    // Request interceptor rejection
    client.interceptors.request.use(
      () => {
        throw new Error('Req Interceptor Error');
      },
      (err) => Promise.reject(err)
    );

    await expect(client.get('https://api.example.com/fail-req')).rejects.toThrow('Req Interceptor Error');

    // Clean interceptors
    client.interceptors.request.clear();

    // Response interceptor recovering from error
    client.interceptors.response.use(
      (res) => res,
      (err: unknown) => {
        const httpErr = err as { config: InternalRequestConfig; request?: Request; response?: Response };
        return {
          data: { recovered: true },
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          config: httpErr.config,
          request: httpErr.request || (new Request('https://api.example.com')),
          response: httpErr.response || (new Response()),
        };
      }
    );

    const recoveredRes = await client.get<{ recovered: boolean }>('https://api.example.com/recover');
    expect(recoveredRes.status).toBe(200);
    expect(recoveredRes.data.recovered).toBe(true);
  });
});

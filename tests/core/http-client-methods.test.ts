import { describe, it, expect, vi } from 'vitest';
import { createHttpClient } from '../../src/core/http-client.js';
import { isHttpError, sanitizeHeaders, HttpError } from '../../src/core/errors.js';

describe('HttpClient Additional Coverage', () => {
  it('supports put, patch, delete, options, head methods', async () => {
    let capturedMethod = '';
    const mockFetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
      capturedMethod = init.method || 'GET';
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const client = createHttpClient({ fetch: mockFetch as unknown as typeof fetch });

    await client.put('https://api.example.com/item', { name: 'put' });
    expect(capturedMethod).toBe('PUT');

    await client.patch('https://api.example.com/item', { name: 'patch' });
    expect(capturedMethod).toBe('PATCH');

    await client.delete('https://api.example.com/item');
    expect(capturedMethod).toBe('DELETE');

    await client.options('https://api.example.com/item');
    expect(capturedMethod).toBe('OPTIONS');

    await client.head('https://api.example.com/item');
    expect(capturedMethod).toBe('HEAD');
  });

  it('supports params serialization with string, object, array and URLSearchParams', async () => {
    const urls: string[] = [];
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const client = createHttpClient({
      baseURL: 'https://api.example.com',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.get('items', { params: { search: 'books', tags: ['fiction', 'sci-fi'], nil: null } });
    expect(urls[0]).toBe('https://api.example.com/items?search=books&tags=fiction&tags=sci-fi');

    await client.get('items?sort=asc', { params: 'filter=active' });
    expect(urls[1]).toBe('https://api.example.com/items?sort=asc&filter=active');

    const sp = new URLSearchParams({ page: '2' });
    await client.get('items', { params: sp });
    expect(urls[2]).toBe('https://api.example.com/items?page=2');
  });

  it('supports blob, arraybuffer, and text responseTypes', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response('raw content', { status: 200 }));
    });

    const client = createHttpClient({ fetch: mockFetch as unknown as typeof fetch });

    const textRes = await client.get('https://api.example.com/text', { responseType: 'text' });
    expect(textRes.data).toBe('raw content');

    const blobRes = await client.get('https://api.example.com/blob', { responseType: 'blob' });
    expect(blobRes.data).toBeDefined();

    const abRes = await client.get('https://api.example.com/ab', { responseType: 'arraybuffer' });
    expect(abRes.data).toBeDefined();
  });

  it('client.create inherits and extends defaults', async () => {
    const baseClient = createHttpClient({
      baseURL: 'https://base.example.com',
      headers: { 'x-base': '1' },
    });

    const extended = baseClient.create({
      baseURL: 'https://extended.example.com',
      headers: { 'x-ext': '2' },
    });

    expect(extended.defaults.baseURL).toBe('https://extended.example.com');
  });

  it('handles response interceptors fulfilling and rejecting', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ a: 1 }), { status: 200 }));
    const client = createHttpClient({ fetch: mockFetch as unknown as typeof fetch });

    client.interceptors.response.use((res) => {
      res.data = { a: 2 };
      return res;
    });

    const res = await client.get<{ a: number }>('https://api.example.com/interceptor');
    expect(res.data).toEqual({ a: 2 });
  });

  it('sanitizeHeaders sanitizes array of tuples and records', () => {
    const arrayHeaders: [string, string][] = [
      ['Authorization', 'secret-val'],
      ['Content-Type', 'text/plain'],
    ];
    const sanitizedArray = sanitizeHeaders(arrayHeaders);
    expect(sanitizedArray['authorization']).toBe('[REDACTED]');
    expect(sanitizedArray['content-type']).toBe('text/plain');

    const objHeaders = {
      'x-auth-token': 'token-val',
      'x-custom': 'val',
    };
    const sanitizedObj = sanitizeHeaders(objHeaders);
    expect(sanitizedObj['x-auth-token']).toBe('[REDACTED]');
    expect(sanitizedObj['x-custom']).toBe('val');

    expect(sanitizeHeaders(undefined)).toEqual({});
  });

  it('isHttpError helper identifies HttpError instances', () => {
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError(new Error('generic'))).toBe(false);

    const httpErr = new HttpError({
      message: 'test',
      config: { url: '', method: 'GET', headers: new Headers() },
    });
    expect(isHttpError(httpErr)).toBe(true);
  });
});

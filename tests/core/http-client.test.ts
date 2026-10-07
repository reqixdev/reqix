import { describe, it, expect, vi } from 'vitest';
import { HttpClient, createHttpClient } from '../../src/core/http-client.js';
import { HttpError, CanceledError, TimeoutError, ParseError } from '../../src/core/errors.js';

describe('HttpClient Core', () => {
  it('supports basic GET request and response parsing', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createHttpClient({ fetch: mockFetch as unknown as typeof fetch });
    const res = await client.get<{ message: string }>('https://api.example.com/hello');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'ok' });
  });

  describe('Timeout vs Cancel', () => {
    it('throws TimeoutError with ECONNABORTED on timeout', async () => {
      const mockFetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('AbortError'));
          });
        });
      });

      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });
      await expect(
        client.get('https://api.example.com/slow', { timeout: 30 })
      ).rejects.toThrow(TimeoutError);

      try {
        await client.get('https://api.example.com/slow', { timeout: 30 });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(TimeoutError);
        const timeoutErr = err as TimeoutError;
        expect(timeoutErr.code).toBe('ECONNABORTED');
        expect(timeoutErr.message).toContain('timeout of 30ms exceeded');
      }
    });

    it('throws CanceledError with ERR_CANCELED on user cancellation', async () => {
      const controller = new AbortController();
      const mockFetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('AbortError'));
          });
          setTimeout(() => controller.abort('User stopped'), 10);
        });
      });

      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });
      await expect(
        client.get('https://api.example.com/cancel', { signal: controller.signal })
      ).rejects.toThrow(CanceledError);

      try {
        const c2 = new AbortController();
        setTimeout(() => c2.abort('reason'), 5);
        await client.get('https://api.example.com/cancel', { signal: c2.signal });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(CanceledError);
        const canceledErr = err as CanceledError;
        expect(canceledErr.code).toBe('ERR_CANCELED');
      }
    });

    it('handles already-aborted signal immediately without calling fetch', async () => {
      const controller = new AbortController();
      controller.abort('pre-aborted');

      const mockFetch = vi.fn();
      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

      await expect(
        client.get('https://api.example.com/pre-aborted', { signal: controller.signal })
      ).rejects.toThrow(CanceledError);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('removes abort listener after completion', async () => {
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

      const mockFetch = vi.fn().mockResolvedValue(
        new Response('ok', { status: 200 })
      );

      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });
      await client.get('https://api.example.com/test', { signal: controller.signal, responseType: 'text' });

      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });
  });

  describe('Retry', () => {
    it('retries GET on 503 status code', async () => {
      let calls = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        calls++;
        if (calls < 3) {
          return Promise.resolve(new Response('Service Unavailable', { status: 503 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const client = new HttpClient({
        fetch: mockFetch as unknown as typeof fetch,
        retry: 3,
        retryDelay: 5,
      });

      const res = await client.get<{ ok: boolean }>('https://api.example.com/retry');
      expect(calls).toBe(3);
      expect(res.data).toEqual({ ok: true });
    });

    it('does NOT retry POST requests by default', async () => {
      let calls = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        calls++;
        return Promise.resolve(new Response('Error', { status: 503 }));
      });

      const client = new HttpClient({
        fetch: mockFetch as unknown as typeof fetch,
        retry: 3,
        retryDelay: 5,
      });

      await expect(
        client.post('https://api.example.com/post', { title: 'test' })
      ).rejects.toThrow(HttpError);

      expect(calls).toBe(1);
    });

    it('respects Retry-After header in seconds', async () => {
      let calls = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve(
            new Response('Rate Limited', {
              status: 429,
              headers: { 'Retry-After': '0' },
            })
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      });

      const client = new HttpClient({
        fetch: mockFetch as unknown as typeof fetch,
        retry: 2,
      });

      const res = await client.get<{ success: boolean }>('https://api.example.com/rate-limit');
      expect(calls).toBe(2);
      expect(res.data).toEqual({ success: true });
    });

    it('honors custom retryCondition', async () => {
      let calls = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        calls++;
        return Promise.resolve(new Response('Bad Gateway', { status: 502 }));
      });

      const client = new HttpClient({
        fetch: mockFetch as unknown as typeof fetch,
        retry: 3,
        retryDelay: 5,
        retryCondition: () => false, // explicitly disable
      });

      await expect(client.get('https://api.example.com/test')).rejects.toThrow(HttpError);
      expect(calls).toBe(1);
    });
  });

  describe('Body Serialization', () => {
    it('serializes plain objects to JSON and sets Content-Type', async () => {
      let capturedInit: RequestInit | undefined;
      const mockFetch = vi.fn().mockImplementation((_url, init) => {
        capturedInit = init;
        return Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
      });

      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });
      await client.post('https://api.example.com/json', { name: 'Alice' });

      expect(capturedInit?.body).toBe(JSON.stringify({ name: 'Alice' }));
      const headers = capturedInit?.headers as Headers;
      expect(headers.get('content-type')).toBe('application/json');
    });

    it('does NOT set Content-Type for FormData', async () => {
      let capturedInit: RequestInit | undefined;
      const mockFetch = vi.fn().mockImplementation((_url, init) => {
        capturedInit = init;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });
      const formData = new FormData();
      formData.append('key', 'val');

      await client.post('https://api.example.com/form', formData);

      const headers = capturedInit?.headers as Headers;
      expect(headers.has('content-type')).toBe(false);
      expect(capturedInit?.body).toBe(formData);
    });

    it('passes URLSearchParams without overriding browser behavior', async () => {
      let capturedInit: RequestInit | undefined;
      const mockFetch = vi.fn().mockImplementation((_url, init) => {
        capturedInit = init;
        return Promise.resolve(new Response('ok', { status: 200 }));
      });

      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });
      const params = new URLSearchParams({ search: 'query' });
      await client.post('https://api.example.com/search', params, { responseType: 'text' });

      expect(capturedInit?.body).toBe(params);
    });
  });

  describe('Safe Response Parsing', () => {
    it('returns null for 204 No Content', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

      const res = await client.delete('https://api.example.com/items/1');
      expect(res.status).toBe(204);
      expect(res.data).toBeNull();
    });

    it('returns null for HEAD requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('some body', { status: 200 }));
      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

      const res = await client.head('https://api.example.com/items/1');
      expect(res.data).toBeNull();
    });

    it('throws ParseError on malformed JSON for 200 OK', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('not json {', { status: 200 }));
      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

      await expect(client.get('https://api.example.com/broken')).rejects.toThrow(ParseError);
    });

    it('preserves raw text in error data on 500 Internal Server Error without throwing ParseError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Database crashed at line 42', { status: 500, statusText: 'Internal Error' })
      );
      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

      try {
        await client.get('https://api.example.com/broken-500');
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HttpError);
        expect(err).not.toBeInstanceOf(ParseError);
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(500);
        expect(httpErr.data).toBe('Database crashed at line 42');
      }
    });
  });

  describe('Interceptors', () => {
    it('executes request interceptors once per logical request across retries', async () => {
      let interceptorCount = 0;
      let fetchCalls = 0;

      const mockFetch = vi.fn().mockImplementation(() => {
        fetchCalls++;
        if (fetchCalls < 2) {
          return Promise.resolve(new Response('Fail', { status: 503 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const client = new HttpClient({
        fetch: mockFetch as unknown as typeof fetch,
        retry: 2,
        retryDelay: 5,
      });

      client.interceptors.request.use((config) => {
        interceptorCount++;
        config.headers.set('x-custom-req', 'true');
        return config;
      });

      const res = await client.get('https://api.example.com/retry-test');
      expect(fetchCalls).toBe(2);
      expect(interceptorCount).toBe(1); // exactly once per logical request!
      expect(res.status).toBe(200);
    });

    it('allows ejecting interceptors', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

      const id = client.interceptors.request.use((config) => {
        config.headers.set('x-ejected', 'yes');
        return config;
      });

      client.interceptors.request.eject(id);

      let capturedInit: RequestInit | undefined;
      mockFetch.mockImplementationOnce((_url, init) => {
        capturedInit = init;
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      await client.get('https://api.example.com/eject-test');
      const headers = capturedInit?.headers as Headers;
      expect(headers.has('x-ejected')).toBe(false);
    });
  });

  describe('Redaction & Security', () => {
    it('redacts Authorization and Cookie headers in toJSON()', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

      try {
        await client.get('https://api.example.com/secret', {
          headers: {
            Authorization: 'Bearer super-secret-token',
            Cookie: 'session=secret-cookie-val',
            'X-Normal-Header': 'public-info',
          },
        });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HttpError);
        const json = (err as HttpError).toJSON();
        const configHeaders = (json['config'] as { headers: Record<string, string> }).headers;
        expect(configHeaders['authorization']).toBe('[REDACTED]');
        expect(configHeaders['cookie']).toBe('[REDACTED]');
        expect(configHeaders['x-normal-header']).toBe('public-info');
      }
    });

    it('redacts credential fields in structured error response data', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accessToken: 'access-secret', nested: { refresh_token: 'refresh-secret' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

      try {
        await client.get('https://api.example.com/secret');
        expect.unreachable();
      } catch (err: unknown) {
        const json = (err as HttpError).toJSON();
        expect(json['data']).toEqual({
          accessToken: '[REDACTED]',
          nested: { refresh_token: '[REDACTED]' },
        });
      }
    });
  });
});

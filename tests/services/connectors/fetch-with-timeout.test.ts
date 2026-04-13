import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchWithTimeout,
  FetchTimeoutError,
  DEFAULT_TIMEOUT_MS,
} from '../../../src/services/connectors/utils/fetch-with-timeout.js';

describe('fetchWithTimeout', () => {
  let originalFetch: typeof fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('exports a sensible default timeout', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it('delegates to fetch and resolves normally when the response arrives in time', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await fetchWithTimeout('https://example.com', { timeoutMs: 1000 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeDefined();
  });

  it('rejects with FetchTimeoutError after timeoutMs elapses', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => { /* never */ }));

    const promise = fetchWithTimeout('https://example.com/slow', {
      method: 'GET',
      timeoutMs: 1000,
      adapter: 'Test',
    });
    const caught = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1100);
    const err = await caught;

    expect(err).toBeInstanceOf(FetchTimeoutError);
    expect(err.message).toContain('Test');
    expect(err.message).toContain('GET');
    expect(err.message).toContain('https://example.com/slow');
    expect(err.message).toContain('1000ms');
    expect(err.timeoutMs).toBe(1000);
    expect(err.method).toBe('GET');
    expect(err.adapter).toBe('Test');
  });

  it('uses DEFAULT_TIMEOUT_MS when no timeoutMs provided', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => { /* never */ }));

    const promise = fetchWithTimeout('https://example.com').catch((e) => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 10);
    const err = await promise;
    expect(err).toBeInstanceOf(FetchTimeoutError);
    expect(err.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('disables the timeout when timeoutMs is 0', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await fetchWithTimeout('https://example.com', { timeoutMs: 0 });
    expect(res.status).toBe(200);
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeUndefined();
  });

  it('propagates non-timeout errors from fetch', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(fetchWithTimeout('https://example.com', { timeoutMs: 1000 }))
      .rejects.toThrow('network down');
  });

  it('swallows the secondary AbortError that fires after the caller already rejected', async () => {
    vi.useFakeTimers();
    // Fetch that rejects with AbortError when signal aborts
    fetchMock.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = fetchWithTimeout('https://example.com', { timeoutMs: 500 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(600);
    const err = await promise;
    // First rejection should be our timeout error, not the AbortError
    expect(err).toBeInstanceOf(FetchTimeoutError);
  });

  it('passes through method, headers, and body to fetch', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok'));
    await fetchWithTimeout('https://example.com/api', {
      method: 'POST',
      headers: { 'X-Custom': 'yes' },
      body: JSON.stringify({ hi: 1 }),
      timeoutMs: 1000,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/api');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Custom']).toBe('yes');
    expect(init.body).toBe('{"hi":1}');
  });
});

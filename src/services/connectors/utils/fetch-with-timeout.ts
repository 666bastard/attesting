/**
 * Phase 5H — Connector HTTP timeout wrapper.
 *
 * Wraps the global fetch with a hard deadline via AbortController. On timeout
 * the returned promise rejects with a `FetchTimeoutError` that includes the
 * URL, method, and timeout duration so adapter error messages stay specific.
 *
 * Adapters pass their own configured `timeout_ms` (defaulting to 30s) so
 * operators can tune per-connector.
 */

export const DEFAULT_TIMEOUT_MS = 30_000;

export class FetchTimeoutError extends Error {
  readonly url: string;
  readonly method: string;
  readonly timeoutMs: number;
  readonly adapter?: string;

  constructor(url: string, timeoutMs: number, opts: { method?: string; adapter?: string } = {}) {
    const method = opts.method ?? 'GET';
    const prefix = opts.adapter ? `${opts.adapter}: ` : '';
    super(`${prefix}HTTP ${method} ${url} timed out after ${timeoutMs}ms`);
    this.name = 'FetchTimeoutError';
    this.url = url;
    this.method = method;
    this.timeoutMs = timeoutMs;
    this.adapter = opts.adapter;
  }
}

export interface FetchWithTimeoutOptions extends RequestInit {
  /** Override the default timeout. `0` or negative disables the timeout. */
  timeoutMs?: number;
  /** Adapter name for error context. */
  adapter?: string;
}

/**
 * Drop-in replacement for `fetch()` that aborts after `timeoutMs` and
 * surfaces timeouts as a typed error. Caller-supplied `signal` values are
 * ignored (the adapters don't currently pass one).
 */
export async function fetchWithTimeout(
  url: string,
  init: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, adapter, signal: _ignored, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetch(url, rest);
  }

  const controller = new AbortController();

  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new FetchTimeoutError(url, timeoutMs, { method, adapter }));
    }, timeoutMs);

    fetch(url, { ...rest, signal: controller.signal })
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        // If the caller already rejected with FetchTimeoutError above, the
        // abort will trigger a secondary AbortError here — swallow it since
        // the promise is already settled.
        if (isAbortError(err)) return;
        reject(err);
      });
  });
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  const code = (err as { code?: string }).code;
  return name === 'AbortError' || code === 'ABORT_ERR' || code === 'ERR_ABORTED';
}

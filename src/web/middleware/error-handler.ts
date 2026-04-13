import type { Request, Response, NextFunction } from 'express';

/**
 * Phase 5H — Global Express error handler.
 *
 * Catches anything thrown from an async route handler (when wrapped via
 * `asyncHandler`) and returns a consistent JSON error envelope:
 *
 *   { error: string, code?: string, status: number, details?: string }
 *
 * Stack traces are only included when NODE_ENV !== 'production'.
 *
 * Route handlers can short-circuit to a specific status by throwing an
 * `HttpError` (or any error with a numeric `status` property).
 */

export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string;

  constructor(status: number, message: string, opts: { code?: string; details?: string } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export function badRequest(message: string, details?: string): HttpError {
  return new HttpError(400, message, { code: 'bad_request', details });
}
export function notFound(message: string): HttpError {
  return new HttpError(404, message, { code: 'not_found' });
}
export function conflict(message: string, details?: string): HttpError {
  return new HttpError(409, message, { code: 'conflict', details });
}

/**
 * Terminal Express error middleware. Must be registered AFTER all routes.
 * Using the 4-arg signature so Express routes errors here instead of
 * treating it as a normal middleware.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // Headers already sent? Hand back to Express default.
  if (res.headersSent) {
    console.error(`[error-handler] response already sent for ${req.method} ${req.originalUrl}`, err);
    return;
  }

  const info = normalizeError(err);
  const isProd = process.env.NODE_ENV === 'production';

  // Always log — production gets redacted stack, dev gets full.
  const logPayload = {
    method: req.method,
    url: req.originalUrl,
    status: info.status,
    code: info.code,
    message: info.message,
  };
  if (info.status >= 500) {
    console.error('[error-handler] unhandled route error', logPayload, isProd ? '' : (err as Error)?.stack ?? '');
  } else {
    console.warn('[error-handler] client error', logPayload);
  }

  const body: Record<string, unknown> = {
    error: info.message,
    code: info.code,
    status: info.status,
  };
  if (info.details) body.details = info.details;
  if (!isProd && info.stack) body.stack = info.stack;

  res.status(info.status).json(body);
}

interface NormalizedError {
  status: number;
  message: string;
  code: string;
  details?: string;
  stack?: string;
}

function normalizeError(err: unknown): NormalizedError {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      message: err.message,
      code: err.code ?? statusToCode(err.status),
      details: err.details,
      stack: err.stack,
    };
  }
  if (err && typeof err === 'object') {
    const anyErr = err as { status?: number; statusCode?: number; message?: string; code?: string; stack?: string };
    const status = Number(anyErr.status ?? anyErr.statusCode ?? 500);
    const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
    return {
      status: safeStatus,
      message: anyErr.message ?? 'Internal server error',
      code: typeof anyErr.code === 'string' ? anyErr.code : statusToCode(safeStatus),
      stack: anyErr.stack,
    };
  }
  return {
    status: 500,
    message: 'Internal server error',
    code: 'internal_error',
  };
}

function statusToCode(status: number): string {
  switch (status) {
    case 400: return 'bad_request';
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 429: return 'rate_limited';
    default:  return status >= 500 ? 'internal_error' : 'client_error';
  }
}

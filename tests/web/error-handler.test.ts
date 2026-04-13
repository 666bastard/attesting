import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  errorHandler,
  HttpError,
  badRequest,
  notFound,
  conflict,
} from '../../src/web/middleware/error-handler.js';
import { asyncHandler } from '../../src/web/middleware/async-handler.js';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/boom/generic', asyncHandler(async () => {
    throw new Error('internal kaboom');
  }));
  app.get('/boom/bad-request', asyncHandler(async () => {
    throw badRequest('missing required field', 'field: x');
  }));
  app.get('/boom/not-found', asyncHandler(async () => {
    throw notFound('record not found');
  }));
  app.get('/boom/conflict', asyncHandler(async () => {
    throw conflict('state conflict');
  }));
  app.get('/boom/http-err', asyncHandler(async () => {
    throw new HttpError(418, "I'm a teapot");
  }));
  app.get('/ok', asyncHandler(async (_req, res) => {
    res.json({ ok: true });
  }));
  // Sync throw (asyncHandler should still catch it)
  app.get('/boom/sync', asyncHandler(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    throw new Error('sync throw');
  }));

  app.use(errorHandler);
  return app;
}

describe('errorHandler middleware', () => {
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
  });

  it('passes through successful responses unchanged', async () => {
    const res = await request(buildApp()).get('/ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('wraps generic thrown errors as 500 with consistent shape', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(buildApp()).get('/boom/generic');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: 'internal kaboom',
      code: 'internal_error',
      status: 500,
    });
    // Stack suppressed in production
    expect(res.body.stack).toBeUndefined();
  });

  it('includes stack in non-production environments', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(buildApp()).get('/boom/generic');
    expect(res.status).toBe(500);
    expect(res.body.stack).toBeDefined();
  });

  it('maps HttpError to its configured status', async () => {
    const res = await request(buildApp()).get('/boom/http-err');
    expect(res.status).toBe(418);
    expect(res.body.error).toBe("I'm a teapot");
  });

  it('uses badRequest helper for 400 responses', async () => {
    const res = await request(buildApp()).get('/boom/bad-request');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'missing required field',
      code: 'bad_request',
      status: 400,
      details: 'field: x',
    });
  });

  it('uses notFound helper for 404 responses', async () => {
    const res = await request(buildApp()).get('/boom/not-found');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: 'record not found',
      code: 'not_found',
      status: 404,
    });
  });

  it('uses conflict helper for 409 responses', async () => {
    const res = await request(buildApp()).get('/boom/conflict');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });

  it('catches async rejections via asyncHandler wrapper', async () => {
    const res = await request(buildApp()).get('/boom/sync');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('sync throw');
  });

  it('HttpError constructor preserves options', () => {
    const err = new HttpError(422, 'bad', { code: 'unprocessable', details: 'xyz' });
    expect(err.status).toBe(422);
    expect(err.code).toBe('unprocessable');
    expect(err.details).toBe('xyz');
  });
});

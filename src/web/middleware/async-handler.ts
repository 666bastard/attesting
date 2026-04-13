import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Express 4 doesn't forward promise rejections to the error middleware
 * automatically. Wrap async route handlers with this helper so any thrown
 * or rejected exception routes through the global error handler instead
 * of leaking as an unhandled rejection.
 *
 *   router.get('/foo', asyncHandler(async (req, res) => { ... }));
 *
 * Express 5 handles promise rejections natively, but the project is still
 * on Express 4 per package.json — so this helper is required for now.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

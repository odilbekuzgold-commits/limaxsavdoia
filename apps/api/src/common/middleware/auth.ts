import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireInternalApiToken(expectedToken?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path.startsWith('/webhooks/telegram')) {
      next();
      return;
    }
    if (!expectedToken) {
      if (process.env.NODE_ENV === 'production') {
        res.status(503).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Internal API authentication is not configured' } });
        return;
      }
      next();
      return;
    }

    const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (!safeEqual(supplied, expectedToken)) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Valid bearer token required' } });
      return;
    }
    next();
  };
}

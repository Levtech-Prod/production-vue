import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ErrorCodes } from '../errorCodes.js';

export type JwtUser = { id: number; email: string; admin: boolean };

declare global {
  namespace Express {
    interface Request {
      user?: JwtUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return res.status(401).json({ code: ErrorCodes.MISSING_TOKEN });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret') as JwtUser;
    next();
  } catch {
    return res.status(401).json({ code: ErrorCodes.INVALID_TOKEN });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.admin) return res.status(403).json({ code: ErrorCodes.ADMIN_ACCESS_REQUIRED });
  next();
}

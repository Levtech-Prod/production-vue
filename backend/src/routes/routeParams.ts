// Shared parsing for the numeric id params every route in this folder takes.
import type { Response } from 'express';

/**
 * Parse a positive integer route or query param, or null when it isn't one.
 *
 * Deliberately stricter than `Number(raw)` plus a NaN check: that also lets
 * through `1.5` and `1e3`, which reach the query as ids that can never match a
 * row — a 500-shaped mystery rather than the 400 the request deserves.
 */
export function parseId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * `parseId` for handlers that answer with the same 400 either way: returns the
 * id, or null having already sent the response. Callers must return
 * immediately on null.
 */
export function requireId(
  res: Response,
  raw: string | string[] | undefined,
  code: string,
): number | null {
  const id = parseId(raw);
  if (id === null) {
    res.status(400).json({ code });
    return null;
  }
  return id;
}

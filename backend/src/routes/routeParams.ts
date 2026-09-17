// Shared parsing for the numeric id params every route in this folder takes.
import { ApiError } from '../apiError.js';
import { POSTGRES_INT_MAX } from '../db.js';
import type { ErrorCode } from '../errorCodes.js';

/**
 * Parse a positive integer route or query param, or null when it isn't one.
 *
 * Takes `unknown` because a query param arrives as `string | ParsedQs | ...`
 * and the first thing this does is reject anything that is not a string —
 * casting at each call site would only restate that.
 *
 * Accepts a plain run of digits and nothing else. `Number(raw)` plus a NaN
 * check is not enough on three counts, and each one reaches the database as a
 * question it cannot answer: `1.5` matches no row, `1e3` and ` 5 ` are the
 * same row under a spelling nothing else in the system uses, and a value past
 * `integer`'s ceiling raises a raw 22003 at the `::int` cast — all of them a
 * 500-shaped mystery rather than the 400 the request deserves.
 *
 * Use this for an id that is allowed to be absent (an optional `?filter=`);
 * `requireId` is for the ones a route cannot proceed without.
 */
export function parseId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value > 0 && value <= POSTGRES_INT_MAX ? value : null;
}

/** `parseId` for the usual case: the id, or a 400 with `code` and no return
 *  to the caller. Throwing rather than answering keeps it to one line at the
 *  call site and lets it be used inside a transaction. */
export function requireId(raw: unknown, code: ErrorCode): number {
  const id = parseId(raw);
  if (id === null) throw new ApiError(400, code);
  return id;
}

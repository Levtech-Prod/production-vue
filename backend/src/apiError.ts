// An error that already knows what the client should be told, so a handler can
// answer 404 or 409 from wherever it discovers the problem — including deep
// inside a `withTransaction` callback, where throwing is what rolls the
// transaction back. `server.ts`'s error handler turns it into the response.
//
// Anything NOT thrown as an ApiError is a bug or an outage and becomes the
// generic 500 the handler logs; that split is the whole point of the class.
import type { ErrorCode } from './errorCodes.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    /** Extra fields merged into the JSON body beside `code`, for the two
     *  answers that carry more than a code (which parameters are in use, what
     *  the file limit is). */
    readonly payload?: Record<string, unknown>,
  ) {
    // `message` is the code so an unhandled one still reads usefully in a log.
    super(code);
    this.name = 'ApiError';
  }
}

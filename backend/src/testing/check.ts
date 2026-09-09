// ===========================================================================
// The assertion helpers every test file in this repo uses. No framework: the
// project has no test runner, and each test is a `tsx` script that prints its
// checks and exits non-zero on a failure.
//
// Shared rather than copied into each file because the pass/fail rule and the
// exit code are one decision — a test that reported failures differently from
// its neighbours would be worse than no test.
// ===========================================================================
import { ApiError } from '../apiError.js';
import type { ErrorCode } from '../errorCodes.js';

let failures = 0;

/** Deep-compares by JSON, which is enough for the plain data these tests
 *  produce and keeps the failure line readable. */
export function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${label}  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  );
  if (!ok) failures++;
}

/** Asserts that `fn` refuses with a particular `ApiError` — the shape every
 *  route-layer guard now answers with, so the status and code are the thing
 *  worth pinning, not the message. */
export async function checkRefuses(
  label: string,
  fn: () => unknown,
  status: number,
  code: ErrorCode,
): Promise<void> {
  try {
    await fn();
    check(label, 'no error thrown', `${status} ${code}`);
  } catch (err) {
    const actual =
      err instanceof ApiError ? `${err.status} ${err.code}` : `non-ApiError: ${String(err)}`;
    check(label, actual, `${status} ${code}`);
  }
}

/** Prints the summary. Returns the failure count so a caller can exit on it. */
export function report(): number {
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  return failures;
}

/** The running failure count, for an exit code outside the summary. */
export function failureCount(): number {
  return failures;
}

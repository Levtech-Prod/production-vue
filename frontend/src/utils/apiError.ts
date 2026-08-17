// Translates a failed API call into a localized error message.
//
// Backend endpoints return a machine-readable `code` (e.g.
// "CATEGORY_NOT_FOUND") instead of a human-readable message - see
// backend/src/errorCodes.ts. This looks up `errors.<code>` in the i18n
// messages and falls back to a caller-supplied, context-specific key (and
// finally to `errors.UNKNOWN`) when the code is missing or unrecognized.

export interface I18nLike {
  t: (key: string, named?: Record<string, unknown>) => string;
  te: (key: string) => boolean;
}

const UNKNOWN_ERROR_KEY = 'errors.UNKNOWN';

export function translateApiError(
  err: any,
  { t, te }: I18nLike,
  fallbackKey: string = UNKNOWN_ERROR_KEY,
): string {
  const code = err?.response?.data?.code as string | undefined;
  const codeKey = code ? `errors.${code}` : null;

  // The server attaches `details` to unrecognized failures outside production
  // (see server.ts). Surfaced here rather than left in the Network tab: the
  // toast can only ever say "request failed", so without this the real cause
  // stays invisible to whoever is looking at the screen.
  const details = err?.response?.data?.details;
  if (details) console.error('[api]', code, details);

  if (codeKey && te(codeKey)) return t(codeKey);
  if (te(fallbackKey)) return t(fallbackKey);
  return t(UNKNOWN_ERROR_KEY);
}

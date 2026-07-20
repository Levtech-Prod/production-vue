// Maps backend Zod validation issues into localized, field-labeled messages.

export interface ZodIssue {
  path: (string | number)[];
  code: string;
  message: string;
  origin?: string; // 'string' | 'number' | ... (Zod 4)
  minimum?: number;
  maximum?: number;
  expected?: string;
}

export type TranslateFn = (
  key: string,
  named?: Record<string, unknown>,
) => string;

// Maps a schema field name (the first path segment) to an existing i18n label.
const FIELD_LABEL_KEYS: Record<string, string> = {
  name: 'name',
  code: 'code',
  categoryId: 'category',
  pricePerPiece: 'price_per_piece',
  location: 'location',
  description: 'description',
  parameters: 'parameters',
  image: 'image',
  type: 'type',
};

function fieldLabel(issue: ZodIssue, t: TranslateFn): string {
  const first = issue.path?.[0];
  if (typeof first === 'string' && FIELD_LABEL_KEYS[first]) {
    return t(FIELD_LABEL_KEYS[first]);
  }
  return issue.path?.map(String).join('.') ?? '';
}

function reason(issue: ZodIssue, t: TranslateFn): string {
  switch (issue.code) {
    case 'too_small':
      return issue.origin === 'string'
        ? t('validation.too_small_string', { min: issue.minimum })
        : t('validation.too_small_number', { min: issue.minimum });
    case 'too_big':
      return issue.origin === 'string'
        ? t('validation.too_big_string', { max: issue.maximum })
        : t('validation.too_big_number', { max: issue.maximum });
    case 'invalid_type':
      // For form submissions this is almost always a missing required field.
      return t('validation.required');
    default:
      // Fall back to Zod's own (English) message if we have no mapping.
      return issue.message || t('validation.invalid');
  }
}

export function localizeZodIssues(
  issues: ZodIssue[] | undefined | null,
  t: TranslateFn,
): string[] {
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) => {
    const label = fieldLabel(issue, t);
    const message = reason(issue, t);
    return label ? `${label}: ${message}` : message;
  });
}

// Pulls the issues array out of an Axios error response, if present.
export function extractZodIssues(err: any): ZodIssue[] | null {
  const issues = err?.response?.data?.issues;
  return Array.isArray(issues) ? issues : null;
}

// ── Client-side required-field checks ───────────────────────────────────────
//
// The backend already reports missing required fields via ZodError (see
// extractZodIssues/localizeZodIssues above), but a native HTML `required`
// attribute intercepts the browser's own submit event before our JS handler
// (and the API call) ever runs — so the browser shows its own, untranslated
// validation bubble instead. Forms use `novalidate` plus this helper to run
// the same kind of check client-side, keyed by field so each one can render
// its own translated message right under its input (rather than a single
// summary list) — the same "is required" wording backend ZodErrors use.

export interface RequiredFieldCheck {
  // Key the caller uses to look up this field's message (e.g. 'name',
  // 'sku', or a part/parameter id for dynamic, per-row fields).
  key: string;
  // The field's already-resolved display label (e.g. t('name'), or a
  // dynamic parameter's own name for per-category custom fields) — shown
  // in the message itself so it reads correctly even out of context.
  label: string;
  // Caller decides what "empty" means for this field (trimmed string,
  // placeholder sentinel for a <select>, etc.).
  missing: boolean;
}

export function requiredFieldErrors(
  checks: RequiredFieldCheck[],
  t: TranslateFn,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const c of checks) {
    if (c.missing) errors[c.key] = `${c.label}: ${t('validation.required')}`;
  }
  return errors;
}

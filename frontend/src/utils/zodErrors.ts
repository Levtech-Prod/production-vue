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
        ? t('zod_too_small_string', { min: issue.minimum })
        : t('zod_too_small_number', { min: issue.minimum });
    case 'too_big':
      return issue.origin === 'string'
        ? t('zod_too_big_string', { max: issue.maximum })
        : t('zod_too_big_number', { max: issue.maximum });
    case 'invalid_type':
      // For form submissions this is almost always a missing required field.
      return t('zod_required');
    default:
      // Fall back to Zod's own (English) message if we have no mapping.
      return issue.message || t('zod_invalid');
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

/**
 * Shared display formatters used across the project.
 * Import from here rather than implementing these inline in components.
 */

/** Display a quantity as a whole number (no decimals). */
export function formatQty(value: number | string): string {
  return Math.round(Number(value)).toString();
}

/** Display a price with exactly 2 decimal places. */
export function formatPrice(value: number | string): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Display a date string in locale short format (e.g. "Jan 5, 2025").
 * Returns '—' for missing or invalid values.
 */
export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

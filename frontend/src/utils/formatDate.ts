/** Shared date formatting for detail pages: locale short date, or an
 *  em dash for missing/invalid values. */
export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

import type { RevisionStatus } from '../types/products.ts';
import type { FirmwareStatus } from '../types/firmware.ts';

/**
 * One status palette for the whole product detail page.
 *
 * Product revisions and firmware name the same three lifecycle stages
 * differently, so they share the colours rather than each keeping their own
 * copy — which is exactly how `deprecated` came to be amber on the revision
 * timeline and grey in the firmware change log, on the same screen:
 *
 *   not live yet   draft / testing        slate
 *   live           active / production    emerald
 *   retired        deprecated             amber
 *
 * The `Record<EntityStatus, …>` maps are deliberate: adding a status to either
 * union is then a compile error here until both palettes cover it.
 */
export type EntityStatus = RevisionStatus | FirmwareStatus;

const DOT: Record<EntityStatus, string> = {
  draft: 'bg-slate-400',
  testing: 'bg-slate-400',
  active: 'bg-emerald-500',
  production: 'bg-emerald-500',
  deprecated: 'bg-amber-500',
};

const BADGE: Record<EntityStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  testing: 'bg-slate-100 text-slate-600',
  active: 'bg-emerald-50 text-emerald-700',
  production: 'bg-emerald-50 text-emerald-700',
  deprecated: 'bg-amber-50 text-amber-700',
};

/** Status dot colour, shared by the tree, both timelines and the revision pills.
 *  Falls back rather than rendering nothing if the API ever sends a status this
 *  build does not know. */
export function statusDot(status: EntityStatus): string {
  return DOT[status] ?? 'bg-slate-400';
}

/** Text badge accompanying the dot — status is never colour-only. */
export function statusBadgeClass(status: EntityStatus): string {
  return BADGE[status] ?? 'bg-slate-100 text-slate-600';
}

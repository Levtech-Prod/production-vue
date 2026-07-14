// Local view-state types for the Compare panel.

import type { CompareStatus, SubProductRevision } from '../../../../types/products.ts';

/** One row of the Compare panel's "product revisions" table: a sub-product's
 *  linked revision on each side, plus the diff status when comparing two
 *  product revisions (null fields mean "nothing to diff" — single mode). */
export interface CompareProductRow {
  spId: number;
  name: string;
  sku: string;
  image: string | null;
  revA: SubProductRevision | null;
  revB: SubProductRevision | null;
  status: CompareStatus | null;
  same: boolean | null;
}

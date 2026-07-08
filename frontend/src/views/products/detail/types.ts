// Local view-state types for the product detail page.

/** What the Documents / BOM panels are scoped to in the left tree. */
export type Selection =
  | { type: 'product' }
  | { type: 'subProduct'; spId: number; spRevId: number };

/** What the Documents / BOM panels load. `product` shows the product-level
 *  documents and the BOM of `revId`; `spRev` shows one sub-product
 *  revision's documents and parts. */
export type PanelScope =
  | { kind: 'product'; revId: number }
  | { kind: 'spRev'; spId: number; revId: number };

/** Revision composition in Revisions mode: at most one checked
 *  sub-product revision per sub-product (spId -> spRevId). */
export type ComposeSelection = Record<number, number>;

/** Payload for editing an existing (product or sub-product) revision. */
export interface EditRevisionPayload {
  label: string;
  status: 'draft' | 'active' | 'deprecated';
  changeNotes: string | null;
}

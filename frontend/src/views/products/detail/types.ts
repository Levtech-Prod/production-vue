// Local view-state types for the product detail page.
// Compare-panel-specific types live in ./compare/types.ts.

/** What the Documents / BOM panels are scoped to in the left tree. */
export type Selection =
  | { type: 'product' }
  | { type: 'subProduct'; spId: number; spRevId: number };

/** What the Documents / BOM panels load. `product` shows the product-level
 *  documents and the BOM of `revId`; `spRev` shows one sub-product
 *  revision's documents and parts.
 *
 *  Both carry the owning ENTITY's id as well as the revision's — documents
 *  hang off a revision, but a document type added from the panel belongs to
 *  the product / sub-product itself. */
export type PanelScope =
  | { kind: 'product'; productId: number; revId: number }
  | { kind: 'spRev'; spId: number; revId: number };

/** Revision composition in Revisions mode: at most one checked
 *  sub-product revision per sub-product (spId -> spRevId). */
export type ComposeSelection = Record<number, number>;

/** Which of Revisions mode's two views the left panel shows. Only meaningful
 *  while `revisionsMode` is on; normal mode has a single view. */
export type RevPanelView = 'changelog' | 'composition';

/** Payload for editing an existing (product or sub-product) revision. */
export interface EditRevisionPayload {
  label: string;
  status: 'draft' | 'active' | 'deprecated';
  changeNotes: string | null;
}

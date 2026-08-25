// The two looks every card on the Documents panel shares — the coloured icon
// tile and the status chip. Extracted from DocumentTypeCard when the versioned
// cards started using them too: this is one decision about how a document card
// reads, so a change to it has to reach both kinds.
import { Check, Circle, X } from 'lucide-vue-next';
import type { DocumentTypeStatus } from '../types/products.ts';

// A stable pastel per card, keyed off its position in the panel, so the grid
// reads as distinct tiles (as in the design) without storing a colour per
// template.
const TILES = [
  { bg: 'bg-emerald-50', fg: 'text-emerald-600' },
  { bg: 'bg-blue-50', fg: 'text-blue-600' },
  { bg: 'bg-violet-50', fg: 'text-violet-600' },
  { bg: 'bg-amber-50', fg: 'text-amber-600' },
  { bg: 'bg-rose-50', fg: 'text-rose-600' },
  { bg: 'bg-cyan-50', fg: 'text-cyan-600' },
  { bg: 'bg-lime-50', fg: 'text-lime-600' },
  { bg: 'bg-fuchsia-50', fg: 'text-fuchsia-600' },
];

const NEUTRAL_TILE = { bg: 'bg-slate-100', fg: 'text-slate-500' };

/** Tile colours for a card. Omit the seed for a card with no identity of its
 *  own, such as "Other documents". */
export function documentTile(colorSeed?: number) {
  return colorSeed == null ? NEUTRAL_TILE : TILES[colorSeed % TILES.length];
}

// The wording is terse by design; the tooltip carries what each one actually
// means (it used to be a legend box).
const BADGES = {
  complete: {
    icon: Check,
    labelKey: 'doc_status_complete',
    hintKey: 'doc_status_complete_hint',
    classes: 'bg-emerald-50 text-emerald-700',
  },
  missing: {
    icon: X,
    labelKey: 'doc_status_missing',
    hintKey: 'doc_status_missing_hint',
    classes: 'bg-red-50 text-red-600',
  },
  optional: {
    icon: Circle,
    labelKey: 'doc_status_optional',
    hintKey: 'doc_status_optional_hint',
    classes: 'bg-slate-100 text-slate-500',
  },
} as const;

export function documentStatusBadge(status: DocumentTypeStatus) {
  return BADGES[status];
}

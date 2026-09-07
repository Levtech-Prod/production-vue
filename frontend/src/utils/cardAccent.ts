/**
 * The app's accent palette for surfaces that show "one card per thing" and
 * want each card to read as its own tile — the Documents panel's type cards
 * and the Projects board.
 *
 * One palette, two renderings: `tile` is the filled icon square (a pale
 * background with a saturated glyph), `stroke` a raw colour for a border or
 * bar. They live together because they are one decision about which hues this
 * app uses to tell cards apart, so restyling has to reach both.
 *
 * Nothing is stored. The colour is a pure function of a seed the caller
 * chooses, and the caller owns how stable that seed is: the Documents panel
 * seeds by a card's position (its colour may shift when cards are added,
 * which is fine there — the icon and name carry the identity), while the
 * board seeds by project id, because the same project appears in several
 * columns at once and its colour has to match across all of them.
 *
 * Order is load-bearing for the Documents panel, whose live cards are seeded
 * by position — reordering these entries repaints them. Append, don't insert.
 */
const CARD_ACCENTS = [
  { stroke: '#059669', tile: { bg: 'bg-emerald-50', fg: 'text-emerald-600' } },
  { stroke: '#2563eb', tile: { bg: 'bg-blue-50', fg: 'text-blue-600' } },
  { stroke: '#7c3aed', tile: { bg: 'bg-violet-50', fg: 'text-violet-600' } },
  { stroke: '#d97706', tile: { bg: 'bg-amber-50', fg: 'text-amber-600' } },
  { stroke: '#e11d48', tile: { bg: 'bg-rose-50', fg: 'text-rose-600' } },
  { stroke: '#0891b2', tile: { bg: 'bg-cyan-50', fg: 'text-cyan-600' } },
  { stroke: '#65a30d', tile: { bg: 'bg-lime-50', fg: 'text-lime-600' } },
  { stroke: '#c026d3', tile: { bg: 'bg-fuchsia-50', fg: 'text-fuchsia-600' } },
  { stroke: '#0d9488', tile: { bg: 'bg-teal-50', fg: 'text-teal-600' } },
  { stroke: '#ea580c', tile: { bg: 'bg-orange-50', fg: 'text-orange-600' } },
] as const;

export type CardAccent = (typeof CARD_ACCENTS)[number];

/** The accent for a card, cycling through the palette. */
export function cardAccent(seed: number): CardAccent {
  return CARD_ACCENTS[Math.abs(seed) % CARD_ACCENTS.length];
}

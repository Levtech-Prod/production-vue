// ===========================================================================
// Part naming — resolves what goes in `parts.name`.
// ---------------------------------------------------------------------------
// A category names its parts one of two ways (`part_categories.part_name_mode`):
//   'custom'     — the name is exactly what the user typed.
//   'parameters' — the name is generated from the category name (singularized)
//                  and the values of its show_as_column parameters, prefixed by
//                  any text the user typed. The typed text is optional here.
//
// `parts.name` always stores the resolved string, so every reader (parts table,
// sub-product BOMs, revisions, exports) stays untouched. `parts.name_prefix`
// stores the raw typed text, which is what lets a generated name be rebuilt
// after the category is renamed or its column parameters change.
//
// Which of the two a form edits depends on the category's mode: 'custom' edits
// `name` directly, 'parameters' edits `name_prefix`. That is why switching a
// category to Custom needs no data fix-up — the part keeps the generated name
// it already had, and that name simply becomes the editable text.
//
// `resolvePartName` is pure and is imported by the frontend too (see
// frontend/src/views/parts/PartModal.vue) so the live preview and the stored
// value can never drift apart.
// ===========================================================================
import type { PoolClient } from 'pg';
import type { PartNameMode } from '../schemas/partCategories.schema.js';

export type { PartNameMode };

/**
 * A category parameter, as far as name generation cares. Callers may pass a
 * category's whole parameter list; only `showAsColumn` ones feed the name.
 */
export interface PartNameParameter {
  id?: number;
  name: string;
  type: string;
  showAsColumn?: boolean;
}

/** Width of `parts.name`; a generated name is trimmed to fit rather than rejected. */
const MAX_PART_NAME_LENGTH = 180;

// English plurals that are not plurals, or that the -ies rule would ruin.
const EN_INVARIANT = /(?:ss|us|is)$/i;
const EN_INVARIANT_WORDS = new Set(['series', 'species']);

/**
 * Best-effort singular of a category name, for use inside a generated part
 * name ("Capacitors" -> "Capacitor"). Only the last word is changed, so
 * "Ceramic Capacitors" -> "Ceramic Capacitor".
 *
 * Deliberately conservative: anything it isn't confident about is returned
 * unchanged, because a plural left alone reads far better than a mangled stem.
 * Known misses are irregulars in both languages (Csövek -> Cső, Buses -> Bus).
 */
export function singularize(label: string): string {
  const trimmed = label.trim();
  const cut = trimmed.lastIndexOf(' ');
  const lead = cut === -1 ? '' : trimmed.slice(0, cut + 1);
  const word = cut === -1 ? trimmed : trimmed.slice(cut + 1);
  const lower = word.toLowerCase();

  // ── Hungarian: plural -k ────────────────────────────────────────────────
  // Matched narrowly so English words ending in k (Rack, Disk, Block, Link)
  // fall through untouched.
  if (lower.endsWith('k')) {
    const stem = word.slice(0, -1);
    const final = stem.slice(-1);

    // Vowel-final stem, plural is a bare -k: Autók -> Autó, Gyűrűk -> Gyűrű.
    // á/é shorten back to a/e: Diódák -> Dióda, Cserék -> Csere.
    if ('áÁ'.includes(final)) return lead + stem.slice(0, -1) + (final === 'á' ? 'a' : 'A');
    if ('éÉ'.includes(final)) return lead + stem.slice(0, -1) + (final === 'é' ? 'e' : 'E');
    if ('íóőúűÍÓŐÚŰ'.includes(final)) return lead + stem;

    // Linking vowel + k: Kondenzátorok -> Kondenzátor, Kábelek -> Kábel.
    // The length floor keeps English "Book"/"Hook" out of it.
    const linked = stem.slice(0, -1);
    if ('oeöaOEÖA'.includes(final) && linked.length >= 3) return lead + linked;

    return trimmed;
  }

  // ── English: plural -s ──────────────────────────────────────────────────
  if (!lower.endsWith('s') || EN_INVARIANT.test(lower)) return trimmed;
  if (EN_INVARIANT_WORDS.has(lower)) return trimmed;

  // Batteries -> Battery, Supplies -> Supply
  if (lower.endsWith('ies') && word.length >= 5) {
    return lead + word.slice(0, -3) + (word === word.toUpperCase() ? 'Y' : 'y');
  }

  // Boxes -> Box, Switches -> Switch, Glasses -> Glass. Plain -ses is left to
  // the rule below so Fuses -> Fuse rather than Fus.
  if (/(?:sses|shes|ches|xes|zzes)$/i.test(lower)) return lead + word.slice(0, -2);

  const stem = word.slice(0, -1);
  return stem.length >= 2 ? lead + stem : trimmed;
}

/**
 * The name to store for a part. In 'parameters' mode:
 * `"<typed text> <category> <value…>"`, single-spaced.
 * Empty values are skipped; a boolean contributes its parameter's name when
 * true and nothing when false.
 */
export function resolvePartName(
  mode: PartNameMode,
  prefix: string,
  categoryName: string,
  parameters: PartNameParameter[],
  values: Record<number, string>,
): string {
  const typed = prefix.trim();
  if (mode === 'custom') return typed;

  const segments = parameters
    .filter((p) => p.showAsColumn === true && p.id != null)
    .map((p) => {
      const value = (values[p.id!] ?? '').trim();
      if (!value) return '';
      if (p.type === 'boolean') return value === 'true' ? p.name : '';
      return value;
    });

  return [typed, singularize(categoryName), ...segments]
    .filter((segment) => segment.trim() !== '')
    .join(' ')
    .slice(0, MAX_PART_NAME_LENGTH);
}

interface CategoryNamingRow {
  categoryName: string;
  mode: PartNameMode;
  parameters: PartNameParameter[];
}

// Column parameters only, in the order they are displayed. Joined with
// `show_as_column` in the ON clause so a category with none still returns a row.
const CATEGORY_NAMING_QUERY = `
  SELECT
    pc.name AS "categoryName",
    pc.part_name_mode AS "mode",
    COALESCE(
      json_agg(
        json_build_object(
          'id', pcp.id, 'name', pcp.name, 'type', pcp.type, 'showAsColumn', true
        )
        ORDER BY pcp.sort_order, pcp.id
      ) FILTER (WHERE pcp.id IS NOT NULL),
      '[]'
    ) AS parameters
  FROM part_categories pc
  LEFT JOIN part_category_parameters pcp
    ON pcp.category_id = pc.id AND pcp.show_as_column
  WHERE pc.id = $1
  GROUP BY pc.id`;

/**
 * Resolved name for a part being saved, or `null` when the category is gone.
 * `values` is keyed by parameter id, as submitted with the part.
 */
export async function resolvePartNameForCategory(
  client: PoolClient,
  categoryId: number,
  prefix: string,
  values: Record<number, string>,
): Promise<string | null> {
  const result = await client.query<CategoryNamingRow>(CATEGORY_NAMING_QUERY, [
    categoryId,
  ]);
  const category = result.rows[0];
  if (!category) return null;

  return resolvePartName(
    category.mode,
    prefix,
    category.categoryName,
    category.parameters,
    values,
  );
}

/**
 * Rebuild every part name in a category after its name, its mode or its column
 * parameters changed. Returns how many names actually changed.
 *
 * No-op for 'custom' categories: parts there keep the name they already have
 * (generated or not) and the edit form takes it from there.
 *
 * Intentionally does not write per-part audit rows: one category rename would
 * otherwise log a change against every part in it.
 */
export async function regenerateCategoryPartNames(
  client: PoolClient,
  categoryId: number,
): Promise<number> {
  const categoryResult = await client.query<CategoryNamingRow>(
    CATEGORY_NAMING_QUERY,
    [categoryId],
  );
  const category = categoryResult.rows[0];
  if (!category || category.mode !== 'parameters') return 0;

  const partsResult = await client.query<{
    id: number;
    namePrefix: string | null;
    values: { parameterId: number; value: string }[];
  }>(
    `SELECT
       p.id,
       p.name_prefix AS "namePrefix",
       COALESCE(
         json_agg(
           json_build_object('parameterId', sp.parameter_id, 'value', sp.value)
         ) FILTER (WHERE sp.id IS NOT NULL),
         '[]'
       ) AS values
     FROM parts p
     LEFT JOIN stock_parameters sp ON sp.part_id = p.id
     WHERE p.category_id = $1
     GROUP BY p.id`,
    [categoryId],
  );

  if (partsResult.rowCount === 0) return 0;

  const ids: number[] = [];
  const names: string[] = [];
  for (const part of partsResult.rows) {
    const values: Record<number, string> = {};
    for (const v of part.values) values[v.parameterId] = v.value;

    ids.push(part.id);
    names.push(
      resolvePartName(
        'parameters',
        part.namePrefix ?? '',
        category.categoryName,
        category.parameters,
        values,
      ),
    );
  }

  const updateResult = await client.query(
    `UPDATE parts p
     SET name = v.name, updated_at = NOW()
     FROM unnest($1::int[], $2::text[]) AS v(id, name)
     WHERE p.id = v.id AND p.name IS DISTINCT FROM v.name`,
    [ids, names],
  );

  return updateResult.rowCount ?? 0;
}

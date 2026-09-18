/**
 * Keyboard helpers for `<input type="number">` fields.
 * Import from here rather than implementing these inline in components.
 */

// A number input accepts these from the keyboard even when the field is meant
// to hold a whole number, and the browser then reports the value as an empty
// string rather than as what was typed — so blocking the keys is what keeps
// such a field integer-only.
const NON_INTEGER_KEYS = ['.', ',', 'e', 'E', '+', '-'];

/**
 * Bind to `@keydown` on a whole-number input to reject decimal separators and
 * exponent/sign characters.
 */
export function blockNonIntegerKeys(event: KeyboardEvent): void {
  if (NON_INTEGER_KEYS.includes(event.key)) event.preventDefault();
}

/**
 * Read a decimal a person typed, in whichever convention they typed it.
 *
 * Prices reach this app off Hungarian, Romanian and English invoices, so
 * `1234.56`, `1234,56`, `1.234,56` and `1,234.56` all mean the same money and
 * all have to parse. `Number()` alone returns NaN for the last two, which is
 * how a typed price silently becomes no price at all.
 *
 * The rule is positional, because the field cannot know which invoice is on
 * the desk:
 *  - both separators present -> the LAST one is the decimal point, the other
 *    is grouping (`1.234,56` and `1,234.56` are both 1234.56);
 *  - one separator, repeated -> all grouping (`1.234.567` is 1234567, not
 *    1234.567 — being wrong here is wrong by a factor of a thousand);
 *  - one separator, once -> the decimal point (`1,5` is 1.5, `1.234` is
 *    1.234). This is the one genuinely ambiguous case, and it is decided for
 *    this field: a per-piece price is NUMERIC(12,4), so four decimals are
 *    ordinary and thousands are not. An English `1,234` meaning one thousand
 *    is read as 1.234 — visible, since the cell re-renders from what was
 *    stored, rather than silently dropped.
 *
 * Returns null for an empty field and `undefined` for something that is not a
 * number: a caller must tell those apart, since one clears a value and the
 * other is a mistake worth reporting.
 */
export function parseDecimalInput(raw: string): number | null | undefined {
  // Spaces group digits too (`1 234,56`), including the non-breaking and thin
  // ones that arrive with text pasted out of a spreadsheet.
  const text = raw.replace(/[\s\u00a0\u202f]/g, '');
  if (text === '') return null;

  const commas = (text.match(/,/g) ?? []).length;
  const dots = (text.match(/\./g) ?? []).length;
  const bothPresent = commas > 0 && dots > 0;
  const onlyOne = commas + dots === 1;

  const decimalAt = bothPresent || onlyOne ? Math.max(text.lastIndexOf(','), text.lastIndexOf('.')) : -1;
  const normalised =
    decimalAt === -1
      ? text.replace(/[.,]/g, '')
      : text.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + text.slice(decimalAt + 1);

  // `Number` accepts things no price ever is — '0x10', '1e5', 'Infinity' — so
  // the shape is checked before the value.
  if (!/^-?\d*\.?\d*$/.test(normalised) || !/\d/.test(normalised)) return undefined;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : undefined;
}

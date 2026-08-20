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

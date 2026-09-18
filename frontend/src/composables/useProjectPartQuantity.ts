import { onBeforeUnmount, reactive } from 'vue';
import { projectsApi } from '../api/projectsAPI.ts';
import type { ProjectPartUpdateResult } from '../types/projects.ts';

/** The three fields this needs from a row of either table that edits the
 *  quantity. `partId` is `parts.id`, not `project_parts.id`: a draft has no
 *  project part to name, and the endpoint is keyed on the part for that
 *  reason. */
export interface QuantityTarget {
  partId: number;
  /** What is stored — what the box goes back to when an edit is dropped. */
  quantity: number;
  /** A line can never be made to owe less than it has already bought (§3.3). */
  orderedQty: number;
}

export interface ProjectPartQuantityOptions {
  /** Read at each call rather than captured: both tables can have the project
   *  switched under them while an edit is pending. */
  projectId: () => number;
  /** The write's own answer — the row as it now stands and the board card it
   *  may have moved — for the caller to patch its own payload with. */
  onSaved: (projectId: number, result: ProjectPartUpdateResult) => void;
  onError: (err: unknown) => void;
}

const DEBOUNCE_MS = 500;

/**
 * Editing `missing_qty`, the purchase quantity (plan §6.4, §12).
 *
 * Shared because it is literally one number on two screens (§6.5): the Parts
 * table on the Projects page and the quantity column of the offer grid edit
 * the same row through the same endpoint, and the rules around it — an emptied
 * box is not a zero, an edit never goes below `ordered_qty`, a refused write
 * puts the stored number back — have to be the same in both or the two screens
 * disagree about what the project is buying.
 *
 * A debounced PATCH per row, keyed by part. While a write is in flight the box
 * shows what was typed; when it lands, the caller patches the row in with the
 * one the response carries, so nothing is read back.
 */
export function useProjectPartQuantity(options: ProjectPartQuantityOptions) {
  const pending = reactive<Record<number, number>>({});
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const inputs = new Map<number, HTMLInputElement>();

  function registerInput(partId: number, el: unknown) {
    if (el instanceof HTMLInputElement) inputs.set(partId, el);
    else inputs.delete(partId);
  }

  /** Put a stored quantity back in the box. `:value` alone cannot: when a write
   *  is refused, or clamped to `orderedQty`, or abandoned because the field was
   *  left empty, the bound number never changed, so Vue sees nothing to
   *  re-render and the field keeps whatever was typed into it. */
  function setInput(partId: number, value: number) {
    const input = inputs.get(partId);
    if (input) input.value = String(value);
  }

  function displayed(target: QuantityTarget): number {
    return target.partId in pending ? pending[target.partId] : target.quantity;
  }

  function cancelPending(partId: number) {
    const timer = timers.get(partId);
    if (timer) clearTimeout(timer);
    timers.delete(partId);
    delete pending[partId];
  }

  function onInput(target: QuantityTarget, event: Event) {
    const { partId } = target;
    const raw = (event.target as HTMLInputElement).value.trim();

    // An emptied box is a number on its way to being retyped, not an
    // instruction to buy nothing. `Number('')` is 0, so emptiness has to be
    // caught before the parse — otherwise backspacing over a quantity and
    // pausing half a second saves a zero, and since any real change also sets
    // `missing_qty_overridden` it would quietly exempt the row from every
    // future recalculate as well. Any pending edit is dropped with it; `flush`
    // restores the field.
    const parsed = raw === '' ? NaN : Math.trunc(Number(raw));
    if (!Number.isFinite(parsed)) {
      cancelPending(partId);
      return;
    }

    pending[partId] = Math.max(0, parsed);
    const existing = timers.get(partId);
    if (existing) clearTimeout(existing);
    timers.set(partId, setTimeout(() => void commit(target), DEBOUNCE_MS));
  }

  function flush(target: QuantityTarget) {
    // Nothing pending: either nothing was typed, or what was typed was an
    // empty field we refused to read as a zero. Either way the box has to go
    // back to showing what is stored.
    if (!(target.partId in pending)) {
      setInput(target.partId, target.quantity);
      return;
    }
    const timer = timers.get(target.partId);
    if (timer) clearTimeout(timer);
    timers.delete(target.partId);
    void commit(target);
  }

  async function commit(target: QuantityTarget) {
    const { partId } = target;
    const raw = pending[partId];
    if (raw === undefined) return;
    // Cleared BEFORE the request, not after it: a blur landing while the write
    // is in flight would otherwise still find the value pending and send the
    // same edit a second time, for one keystroke.
    cancelPending(partId);

    const projectId = options.projectId();
    // The API enforces this too (MISSING_QTY_BELOW_ORDERED); clamping here
    // just avoids a round trip for the common case of typing a smaller, still
    // valid number. `orderedQty` is zero on a draft, so this is a no-op there.
    const missingQty = Math.max(raw, target.orderedQty);
    try {
      const { data } = await projectsApi.updatePartQuantity(projectId, partId, { missingQty });
      options.onSaved(projectId, data);
      setInput(partId, data.row.missingQty);
    } catch (err) {
      setInput(partId, target.quantity);
      options.onError(err);
    }
  }

  onBeforeUnmount(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });

  return { registerInput, displayed, onInput, flush };
}

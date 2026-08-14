import { ref, shallowRef, type ComputedRef, type Ref } from 'vue';

/**
 * "Show the data for whatever the panel is scoped to right now."
 *
 * The right-hand panels of the product detail page all need the same thing:
 * fetch per scope, cache per scope so switching back is instant, and never let
 * a slow response overwrite a newer selection. Written three times before this
 * (documents, firmware, BOM), which is also how the same off-by-one bug ended
 * up in two of them — see `run` below.
 *
 * `S` is the scope type, `T` the payload.
 */
export interface ScopedCacheOptions<S, T> {
  /** What the panel is scoped to, or null when it is scoped to nothing. */
  current: ComputedRef<S | null>;
  /** Cache key for a scope. Two scopes with the same key share an entry. */
  keyFor: (scope: S) => string;
  fetcher: (scope: S) => Promise<T>;
  /** Shown when a scope has no data — a failed fetch, or nothing selected. */
  empty: T;
  /** Runs after `data` changes, for state derived from it (e.g. keeping a
   *  selected id valid across refetches). */
  onData?: (data: T) => void;
}

/** Why a fetch is not being applied — `stale` means a newer one has taken over
 *  and owns both the view and the loading flag. */
type Outcome<T> = { state: 'ok'; data: T } | { state: 'stale' } | { state: 'error' };

export function useScopedCache<S, T>(options: ScopedCacheOptions<S, T>) {
  const { current, keyFor, fetcher, empty, onData } = options;

  const cache = new Map<string, T>();
  // shallowRef: these payloads are replaced wholesale, never mutated in place,
  // so deep reactivity would only cost proxy traversal on every fetch.
  const data = shallowRef<T>(empty) as Ref<T>;
  const loading = ref(false);
  let token = 0;

  /** Is this scope still the one on screen? */
  function isCurrent(scope: S): boolean {
    return current.value != null && keyFor(current.value) === keyFor(scope);
  }

  function apply(value: T) {
    data.value = value;
    onData?.(value);
  }

  /**
   * Fetch one scope. The response is cached whether or not that scope is still
   * on screen — it is valid data for what it was asked for.
   *
   * `stale` and `error` are deliberately distinct. Collapsing them (the
   * previous "return null for both") meant a superseded response cleared the
   * view to empty while a newer request for the *same* scope was still in
   * flight, flashing the empty state: select A, select B, select A again
   * before the first response lands.
   */
  async function run(scope: S): Promise<Outcome<T>> {
    const requestToken = ++token;
    const key = keyFor(scope);
    try {
      const fresh = await fetcher(scope);
      cache.set(key, fresh);
      return requestToken === token ? { state: 'ok', data: fresh } : { state: 'stale' };
    } catch {
      // Drop any cached value: after a failed refresh it is stale, and
      // re-reading is cheaper than showing something wrong.
      cache.delete(key);
      return requestToken === token ? { state: 'error' } : { state: 'stale' };
    }
  }

  /** Show a scope, from cache when possible. */
  async function load(scope: S) {
    const cached = cache.get(keyFor(scope));
    if (cached !== undefined) {
      apply(cached);
      // A cache hit is not loading — and it may be resolving a scope switch
      // that happened while an earlier, slower load was still in flight.
      loading.value = false;
      return;
    }

    loading.value = true;
    const outcome = await run(scope);
    // A newer fetch owns the view and the flag; leave both alone.
    if (outcome.state === 'stale') return;
    if (isCurrent(scope)) apply(outcome.state === 'ok' ? outcome.data : empty);
    loading.value = false;
  }

  /** Re-read a scope after a mutation, updating the view if still on it. */
  async function refresh(scope: S) {
    const outcome = await run(scope);
    if (outcome.state === 'ok' && isCurrent(scope)) apply(outcome.data);
  }

  /** Drop every cached scope and re-read the one on screen. For changes that
   *  are not confined to a single scope. */
  async function invalidateAndRefresh(scope: S) {
    cache.clear();
    await refresh(scope);
  }

  /** Forget everything and show nothing — used when switching product. */
  function clearCache() {
    cache.clear();
    data.value = empty;
    loading.value = false;
  }

  /** Drop one scope's cached entry (e.g. its owning revision was deleted),
   *  without disturbing the others. */
  function dropCacheKey(key: string) {
    cache.delete(key);
  }

  return { data, loading, isCurrent, load, refresh, invalidateAndRefresh, clearCache, dropCacheKey };
}

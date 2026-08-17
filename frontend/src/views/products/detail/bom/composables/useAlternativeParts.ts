import { reactive, ref } from 'vue';
import type { UnwrapNestedRefs } from 'vue';
import { useI18n } from 'vue-i18n';
import { productRevisionsApi, subProductsApi } from '../../../../../api/productsAPI.ts';
import { usePartsStore } from '../../../../../stores/partsStore.ts';
import { useNotificationStore } from '../../../../../stores/notificationStore.ts';
import { translateApiError } from '../../../../../utils/apiError.ts';
import type { Part } from '../../../../../types/parts.ts';
import type { PartAlternative } from '../../../../../types/products.ts';

/**
 * Alternative-part links, keyed by sub_product_revision_id (see migration
 * 021 — a link belongs to exactly one revision, same as quantity/unit/
 * mount_position). Cached by revId alone, not spId+revId: revision ids are
 * already globally unique (SERIAL across every sub-product), matching how
 * useBomAndParts caches parts/BOM by revId. One instance is shared across the
 * BOM tab's views (see ProductDetailView), so switching between the editable
 * Parts panel and the read-only BOM panel reuses the same cache.
 *
 * A part holds AT MOST ONE alternate per revision (unique index on
 * (revision, part_id)), hence `alternateFor` returning a single part rather
 * than a list, and `link` replacing rather than appending.
 *
 * Directional: linking A -> B only shows on A's row. `alternateFor` never
 * looks at `alternatePartId` matches, unlike a symmetric/undirected design.
 */
export function useAlternativeParts() {
  const { t, te } = useI18n();
  const notify = useNotificationStore();
  const partsStore = usePartsStore();

  // reactive() (not a plain Map) so components reading through alternativesFor
  // re-render once a revision's links resolve, even though the fetch isn't
  // triggered from inside their own setup().
  const cache = reactive(new Map<number, PartAlternative[]>());
  const loadingIds = reactive(new Set<number>());
  const inFlight = new Map<number, Promise<void>>();
  // Keyed by product revision id — separate from `inFlight` (keyed by sub-
  // product revision id) so a batch load and a single-revision load never
  // dedupe against each other.
  const productRevInFlight = new Map<number, Promise<void>>();
  const saving = ref(false);

  // Bumped whenever the cache gains or loses links. Consumers that need to
  // react to links ARRIVING (rather than just read them during render) watch
  // this — notably the panels that auto-expand every part with an alternate,
  // which have to re-seed once a fetch resolves. Watching the reactive Map
  // itself would need a deep watcher on a structure that is replaced
  // wholesale per revision; a counter says the same thing far more cheaply.
  const linkVersion = ref(0);

  function ensureLoaded(spId: number, revId: number): Promise<void> {
    if (cache.has(revId)) return Promise.resolve();
    const existing = inFlight.get(revId);
    if (existing) return existing;

    loadingIds.add(revId);
    const promise = subProductsApi
      .getPartAlternatives(spId, revId)
      .then((res) => {
        cache.set(revId, res.data);
      })
      .catch((err: any) => {
        cache.set(revId, []);
        notify.showToast(translateApiError(err, { t, te }, 'errors.load_parts_failed'), 'error');
      })
      .finally(() => {
        loadingIds.delete(revId);
        inFlight.delete(revId);
        linkVersion.value++;
      });
    inFlight.set(revId, promise);
    return promise;
  }

  /** Loads every `revIds` entry's links in one request instead of one GET per
   *  sub-product revision — the product-level BOM view opens with every
   *  sub-product in the composition at once, so looping `ensureLoaded` here
   *  would mean N requests on every product page load. Revisions already
   *  cached (individually or from an earlier batch) are left untouched. */
  function ensureLoadedForProductRevision(
    productRevId: number,
    revIds: number[],
  ): Promise<void> {
    const missing = revIds.filter((id) => !cache.has(id));
    if (missing.length === 0) return Promise.resolve();

    const existing = productRevInFlight.get(productRevId);
    if (existing) return existing;

    for (const id of missing) loadingIds.add(id);
    const promise = productRevisionsApi
      .getPartAlternatives(productRevId)
      .then((res) => {
        const byRevId = new Map<number, PartAlternative[]>();
        for (const link of res.data) {
          const list = byRevId.get(link.subProductRevisionId) ?? [];
          list.push({
            id: link.id,
            partId: link.partId,
            alternatePartId: link.alternatePartId,
            alternateInUse: link.alternateInUse,
          });
          byRevId.set(link.subProductRevisionId, list);
        }
        for (const id of missing) {
          if (!cache.has(id)) cache.set(id, byRevId.get(id) ?? []);
        }
      })
      .catch((err: any) => {
        for (const id of missing) {
          if (!cache.has(id)) cache.set(id, []);
        }
        notify.showToast(translateApiError(err, { t, te }, 'errors.load_parts_failed'), 'error');
      })
      .finally(() => {
        for (const id of missing) loadingIds.delete(id);
        productRevInFlight.delete(productRevId);
        linkVersion.value++;
      });
    productRevInFlight.set(productRevId, promise);
    return promise;
  }

  function isLoading(revId: number): boolean {
    return loadingIds.has(revId);
  }

  function linksFor(revId: number): PartAlternative[] {
    return cache.get(revId) ?? [];
  }

  function partById(id: number): Part | undefined {
    return partsStore.parts.find((p) => p.id === id);
  }

  /** The alternate linked to `partId` within `revId`, if any — one direction
   *  only, so this never returns a part that merely links TO `partId`.
   *  Undefined both when nothing is linked and when the linked part is
   *  missing from the catalog. */
  function alternateFor(revId: number, partId: number): Part | undefined {
    const link = linksFor(revId).find((l) => l.partId === partId);
    return link ? partById(link.alternatePartId) : undefined;
  }

  /** Whether `partId` has an alternate on `revId` — true even if the catalog
   *  hasn't loaded that part yet, which is what the auto-expand seeding wants
   *  (a row shouldn't collapse just because the catalog is still arriving). */
  function hasAlternate(revId: number, partId: number): boolean {
    return linksFor(revId).some((l) => l.partId === partId);
  }

  function linkIdFor(revId: number, partId: number): number | undefined {
    return linksFor(revId).find((l) => l.partId === partId)?.id;
  }

  /** True when the revision is built with the alternate rather than the BOM
   *  line itself. False both when the BOM line is fitted and when there is no
   *  alternate at all. */
  function alternateInUse(revId: number, partId: number): boolean {
    return !!linksFor(revId).find((l) => l.partId === partId)?.alternateInUse;
  }

  async function setInUse(spId: number, revId: number, id: number, inUse: boolean) {
    if (saving.value) return;
    saving.value = true;
    try {
      await subProductsApi.setPartAlternativeInUse(spId, revId, id, inUse);
      cache.delete(revId);
      await ensureLoaded(spId, revId);
    } catch (err: any) {
      notify.showToast(
        translateApiError(err, { t, te }, 'errors.save_sub_product_revision_failed'),
        'error',
      );
    } finally {
      saving.value = false;
    }
  }

  /** Sets `partId`'s alternate, replacing whatever it pointed at before —
   *  the route does the swap in one transaction (see migration 021). A brand
   *  new link comes back already marked fitted; a swap keeps whatever the
   *  previous link had. */
  async function link(spId: number, revId: number, partId: number, alternatePartId: number) {
    if (saving.value) return;
    saving.value = true;
    try {
      await subProductsApi.linkPartAlternative(spId, revId, { partId, alternatePartId });
      cache.delete(revId);
      await ensureLoaded(spId, revId);
    } catch (err: any) {
      notify.showToast(
        translateApiError(err, { t, te }, 'errors.save_sub_product_revision_failed'),
        'error',
      );
    } finally {
      saving.value = false;
    }
  }

  async function unlink(spId: number, revId: number, id: number) {
    if (saving.value) return;
    saving.value = true;
    try {
      await subProductsApi.unlinkPartAlternative(spId, revId, id);
      cache.delete(revId);
      await ensureLoaded(spId, revId);
    } catch (err: any) {
      notify.showToast(
        translateApiError(err, { t, te }, 'errors.save_sub_product_revision_failed'),
        'error',
      );
    } finally {
      saving.value = false;
    }
  }

  return {
    saving,
    linkVersion,
    ensureLoaded,
    ensureLoadedForProductRevision,
    isLoading,
    alternateFor,
    hasAlternate,
    alternateInUse,
    linkIdFor,
    link,
    unlink,
    setInUse,
  };
}

// Every consumer receives this through a `reactive()` wrapper (see
// ProductDetailView, matching the existing `useFirmwares`/`fw` pattern) so
// `saving` reads as a plain boolean instead of a Ref wherever it's used —
// UnwrapNestedRefs describes that post-reactive() shape, not the raw return.
export type UseAlternativeParts = UnwrapNestedRefs<ReturnType<typeof useAlternativeParts>>;

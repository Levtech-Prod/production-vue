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
 * Alternative-part links (see migration 021). Keyed by revision id alone —
 * those are globally unique, so spId never enters the cache key.
 */
export function useAlternativeParts() {
  const { t, te } = useI18n();
  const notify = useNotificationStore();
  const partsStore = usePartsStore();

  // reactive(), not a plain Map: fetches are triggered outside the consuming
  // components, so a plain Map would not re-render them on arrival.
  const cache = reactive(new Map<number, PartAlternative[]>());
  const loadingIds = reactive(new Set<number>());
  const inFlight = new Map<number, Promise<void>>();
  // Separate from `inFlight` (different key space) so a batch and a single
  // load never dedupe against each other.
  const productRevInFlight = new Map<number, Promise<void>>();
  const saving = ref(false);

  // Watchable signal that links arrived, for the panels that auto-expand.
  // A counter rather than a deep watcher on the Map, which is replaced
  // wholesale per revision anyway.
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

  /** One request for the whole product revision. Looping `ensureLoaded` here
   *  would be N requests, since the product view opens every sub-product. */
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

  /** Directional: never returns a part that merely links TO `partId`. */
  function alternateFor(revId: number, partId: number): Part | undefined {
    const link = linksFor(revId).find((l) => l.partId === partId);
    return link ? partById(link.alternatePartId) : undefined;
  }

  /** True even before the catalog loads, unlike `alternateFor` — so
   *  auto-expanded rows don't collapse while it is still arriving. */
  function hasAlternate(revId: number, partId: number): boolean {
    return linksFor(revId).some((l) => l.partId === partId);
  }

  function linkIdFor(revId: number, partId: number): number | undefined {
    return linksFor(revId).find((l) => l.partId === partId)?.id;
  }

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

  /** Replaces any existing alternate. A new link comes back fitted; a swap
   *  keeps the previous link's flag. */
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

// Describes the post-`reactive()` shape (see ProductDetailView). Drop the
// unwrap and `saving` reads as a Ref through the prop — vue-tsc will fail.
export type UseAlternativeParts = UnwrapNestedRefs<ReturnType<typeof useAlternativeParts>>;

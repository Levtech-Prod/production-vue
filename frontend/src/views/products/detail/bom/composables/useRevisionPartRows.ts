import { computed, onMounted } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { usePartsStore } from '../../../../../stores/partsStore.ts';
import type { Part } from '../../../../../types/parts.ts';
import type { RevisionPart } from '../../../../../types/products.ts';

/**
 * Joins a sub-product revision's parts (which only carry the fields stored on
 * the revision) with the full parts catalog, so a `PartsTable` can render
 * category, location and parameters. Falls back to the revision's own data if
 * a part is missing from the catalog.
 *
 * Shared by the editable parts panel (Revisions mode) and the read-only BOM
 * panel so both show identical rows from one source of truth.
 */
export function useRevisionPartRows(parts: Ref<RevisionPart[]> | ComputedRef<RevisionPart[]>) {
  // Shared across the app (see partsStore) so switching between sub-product
  // revisions doesn't refetch the entire catalog every time; loaded once.
  const partsStore = usePartsStore();

  const catalogLoading = computed(
    () => partsStore.loading && partsStore.parts.length === 0,
  );

  onMounted(() => {
    if (partsStore.parts.length === 0 && !partsStore.loading) {
      void partsStore.loadParts().catch(() => {});
    }
  });

  const rows = computed<Part[]>(() =>
    parts.value.map((rp) => {
      const found = partsStore.parts.find((p) => p.id === rp.id);
      if (found) return found;
      return {
        id: rp.id,
        categoryId: rp.categoryId,
        name: rp.name,
        code: rp.code,
        pricePerPiece: rp.pricePerPiece,
        image: rp.image ?? null,
        category: { id: rp.categoryId, name: '—', description: '' },
        parameters: [],
      };
    }),
  );

  return { rows, catalogLoading };
}

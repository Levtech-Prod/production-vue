<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Header -->
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
      <h3 class="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
        <span class="truncate">{{ t('tab_parts') }}</span>
        <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {{ spName }} · {{ revLabel }}
        </span>
      </h3>
      <span v-if="saving" class="shrink-0 text-xs text-slate-400">{{ t('saving') }}</span>
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- ── Current parts of the revision ─────────────────────────────── -->
      <div v-if="loading || allPartsLoading" class="py-8 text-center text-sm text-slate-400">
        {{ t('loading') }}
      </div>
      <PartsTable v-else :parts="currentRows" :empty-text="t('no_parts_in_revision')">
        <template #actions="{ part }">
          <div class="flex items-center gap-1.5">
            <input
              type="number"
              min="0"
              step="1"
              class="input !w-20 !py-1 text-right text-sm"
              :value="revisionPartOf(part.id)?.quantity ?? ''"
              :disabled="!canEdit || saving"
              :title="t('quantity')"
              @change="onQtyChange(part.id, $event)"
            />
            <span class="w-8 truncate text-xs text-slate-400">
              {{ revisionPartOf(part.id)?.unit || '' }}
            </span>
            <button
              v-if="canEdit"
              type="button"
              class="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              :title="t('delete')"
              :disabled="saving"
              @click="askRemove(part.id)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </template>
      </PartsTable>

      <!-- ── Add parts ─────────────────────────────────────────────────── -->
      <div v-if="canEdit" class="border-t-4 border-slate-100">
        <div class="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
          <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {{ t('add_part') }}
          </span>
        </div>
        <div class="px-4 pb-3">
          <div class="relative max-w-sm">
            <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              v-model="search"
              type="text"
              class="input w-full !py-1.5 !pl-8 text-sm"
              :placeholder="t('search_parts_placeholder')"
            />
          </div>
        </div>

        <div v-if="allPartsLoading" class="py-6 text-center text-sm text-slate-400">
          {{ t('loading') }}
        </div>
        <PartsTable v-else :parts="availableParts" :empty-text="t('no_parts_found')">
          <template #actions="{ part }">
            <!-- Quantity entry after clicking add -->
            <div v-if="addingPartId === part.id" class="flex items-center gap-1.5">
              <input
                :ref="(el) => setQtyInputRef(el, part.id)"
                v-model.number="addQty"
                type="number"
                min="0"
                step="1"
                class="input !w-20 !py-1 text-right text-sm"
                @keyup.enter="confirmAdd(part)"
                @keyup.esc="addingPartId = null"
              />
              <button
                type="button"
                class="rounded-lg bg-blue-600 p-1.5 text-white hover:bg-blue-700 disabled:opacity-40"
                :title="t('add_part')"
                :disabled="saving || !(addQty > 0)"
                @click="confirmAdd(part)"
              >
                <Check class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                :title="t('cancel')"
                @click="addingPartId = null"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              v-else
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
              :disabled="saving"
              @click="startAdd(part)"
            >
              <Plus class="h-3.5 w-3.5" /> {{ t('add') }}
            </button>
          </template>
        </PartsTable>
      </div>
    </div>

    <!-- Remove part confirmation -->
    <ConfirmModal
      :visible="removeTarget != null"
      :title="t('delete')"
      :message="`${t('confirmations.remove_part_msg')}${removeTarget ? `: ${removeTarget.name}` : ''}`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="saving"
      @confirm="confirmRemove"
      @cancel="removeTarget = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { Check, Plus, Search, Trash2, X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import ConfirmModal from '../../../components/notification/ConfirmModal.vue';
import PartsTable from '../../parts/PartsTable.vue';
import { usePartsStore } from '../../../stores/partsStore.ts';
import type { Part } from '../../../types/parts.ts';
import type { RevisionPart, RevisionPartInput } from '../../../types/products.ts';

const props = defineProps<{
  spName: string;
  revLabel: string;
  parts: RevisionPart[];
  loading: boolean;
  saving: boolean;
  canEdit: boolean;
}>();

const emit = defineEmits<{ update: [parts: RevisionPartInput[]] }>();

const { t } = useI18n();

// ── Part catalog (full stock details for both tables) ───────────────────────

// Shared across the app (see partsStore) so switching between sub-product
// revisions here — which remounts this panel via its :key — doesn't refetch
// the entire parts catalog every time; it's loaded once and reused.
const partsStore = usePartsStore();
const allParts = computed(() => partsStore.parts);
const allPartsLoading = computed(() => partsStore.loading && partsStore.parts.length === 0);

onMounted(() => {
  if (partsStore.parts.length === 0 && !partsStore.loading) {
    void partsStore.loadParts().catch(() => {});
  }
});

// Revision parts joined with the catalog, so the table can show category,
// location and parameters. Falls back to the revision's own data if a part
// is missing from the catalog.
const currentRows = computed<Part[]>(() =>
  props.parts.map((rp) => {
    const found = allParts.value.find((p) => p.id === rp.id);
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

function revisionPartOf(partId: number): RevisionPart | undefined {
  return props.parts.find((p) => p.id === partId);
}

const search = ref('');

const availableParts = computed(() => {
  const used = new Set(props.parts.map((p) => p.id));
  const q = search.value.trim().toLowerCase();
  return allParts.value.filter((p) => {
    if (used.has(p.id)) return false;
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
  });
});

// ── Mutations (each emits the full new part set; parent persists it) ────────

function toInputs(parts: RevisionPart[]): RevisionPartInput[] {
  return parts.map((p) => ({
    partId: p.id,
    quantity: Number(p.quantity) || 0,
    unit: p.unit || null,
    notes: p.notes || null,
  }));
}

function onQtyChange(partId: number, e: Event) {
  const input = e.target as HTMLInputElement;
  const qty = Number(input.value);
  const current = revisionPartOf(partId);
  if (!current) return;
  if (!Number.isFinite(qty) || qty <= 0) {
    input.value = String(current.quantity);
    return;
  }
  emit(
    'update',
    toInputs(props.parts).map((p) => (p.partId === partId ? { ...p, quantity: qty } : p)),
  );
}

// Add flow: click Add → enter quantity → confirm.
const addingPartId = ref<number | null>(null);
const addQty = ref(1);
const qtyInputs = new Map<number, HTMLInputElement>();

function setQtyInputRef(el: Element | ComponentPublicInstance | null, partId: number) {
  if (el instanceof HTMLInputElement) qtyInputs.set(partId, el);
  else qtyInputs.delete(partId);
}

function startAdd(part: Part) {
  addingPartId.value = part.id;
  addQty.value = 1;
  void nextTick(() => qtyInputs.get(part.id)?.select());
}

function confirmAdd(part: Part) {
  if (!(addQty.value > 0)) return;
  emit('update', [
    ...toInputs(props.parts),
    { partId: part.id, quantity: addQty.value, unit: null, notes: null },
  ]);
  addingPartId.value = null;
}

// Remove flow with confirmation.
const removeTarget = ref<Part | null>(null);

function askRemove(partId: number) {
  removeTarget.value = currentRows.value.find((p) => p.id === partId) ?? null;
}

function confirmRemove() {
  const target = removeTarget.value;
  if (!target) return;
  emit(
    'update',
    toInputs(props.parts).filter((p) => p.partId !== target.id),
  );
  removeTarget.value = null;
}
</script>

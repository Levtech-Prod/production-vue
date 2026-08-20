<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('add_parts')"
    size="xl"
    @update:model-value="onOverlayClose"
  >
    <!-- Search -->
    <div class="relative mb-3 max-w-sm">
      <Search
        class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
      />
      <input
        v-model="search"
        type="text"
        class="input w-full !py-1.5 !pl-8 text-sm"
        :placeholder="t('search_parts_placeholder')"
      />
    </div>

    <div v-if="loading" class="py-8 text-center text-sm text-slate-400">
      {{ t('loading') }}
    </div>

    <!-- Negative margin so the table can use the modal's full width; the
         BaseModal body supplies the horizontal padding the search box wants. -->
    <div v-else class="-mx-6 border-y border-slate-100">
      <PartsTable
        :parts="filteredParts"
        :empty-text="emptyText"
        image-layer="nested"
        dense
      >
        <template #actions="{ part }">
          <!-- Staged: quantity is edited in place and the row stays listed,
               so several parts can be lined up before anything is saved. -->
          <div
            v-if="stagedFor(part.id)"
            class="flex items-center justify-end gap-1.5"
          >
            <input
              :ref="(el) => setQtyInputRef(el, part.id)"
              type="number"
              min="1"
              step="1"
              class="input !w-20 !py-1 text-right text-sm"
              :value="stagedFor(part.id)?.quantity"
              :title="t('quantity')"
              @input="onQtyInput(part.id, $event)"
              @keydown="blockNonIntegerKeys"
              @keyup.esc="unstage(part.id)"
            />
            <button
              type="button"
              class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              :title="t('cancel')"
              @click="unstage(part.id)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            v-else
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
            :disabled="saving"
            @click="stage(part)"
          >
            <Plus class="h-3.5 w-3.5" /> {{ t('add') }}
          </button>
        </template>
      </PartsTable>
    </div>

    <template #footer>
      <span class="mr-auto text-sm text-slate-500">
        {{ t('n_selected', { n: staged.length }) }}
      </span>
      <button type="button" class="btn-secondary" @click="close">
        {{ t('cancel') }}
      </button>
      <button
        type="button"
        class="btn-primary disabled:pointer-events-none disabled:opacity-50"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ saving ? t('saving') : t('add_n_parts', { n: staged.length }) }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, Search, X } from 'lucide-vue-next';
import BaseModal from '../../../components/modal/BaseModal.vue';
import PartsTable from '../../parts/PartsTable.vue';
import { blockNonIntegerKeys } from '../../../utils/numberInput.ts';
import type { Part } from '../../../types/parts.ts';

const props = defineProps<{
  modelValue: boolean;
  /** Catalog parts that are not in the revision yet — the parent owns that
      filtering, so this component never touches the parts store. */
  parts: Part[];
  loading: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  add: [rows: { partId: number; quantity: number }[]];
}>();

const { t } = useI18n();

const search = ref('');

// Parts lined up to be added, in the order they were picked. Nothing is
// persisted until submit(), so the whole batch lands in a single update.
const staged = ref<{ partId: number; quantity: number }[]>([]);

const filteredParts = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.parts;
  return props.parts.filter(
    (p) =>
      p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q),
  );
});

// An empty list means two different things: nothing matched the search, or
// the revision already holds every part in the catalog.
const emptyText = computed(() =>
  search.value.trim() ? t('no_parts_found') : t('all_parts_added'),
);

const canSubmit = computed(
  () =>
    !props.saving &&
    staged.value.length > 0 &&
    staged.value.every((row) => row.quantity > 0),
);

function stagedFor(partId: number) {
  return staged.value.find((row) => row.partId === partId);
}

// Focus the quantity box the moment a part is staged, so a part can be added
// with Add → type quantity → Add (next part) and never touch the mouse.
const qtyInputs = new Map<number, HTMLInputElement>();

function setQtyInputRef(
  el: Element | ComponentPublicInstance | null,
  partId: number,
) {
  if (el instanceof HTMLInputElement) qtyInputs.set(partId, el);
  else qtyInputs.delete(partId);
}

function stage(part: Part) {
  if (stagedFor(part.id)) return;
  staged.value.push({ partId: part.id, quantity: 1 });
  void nextTick(() => qtyInputs.get(part.id)?.select());
}

function unstage(partId: number) {
  staged.value = staged.value.filter((row) => row.partId !== partId);
}

function onQtyInput(partId: number, e: Event) {
  const row = stagedFor(partId);
  if (!row) return;
  const value = Math.trunc(Number((e.target as HTMLInputElement).value));
  row.quantity = Number.isFinite(value) ? value : 0;
}

function close() {
  emit('update:modelValue', false);
}

// Backdrop click / the header X — same as Cancel: the staged batch is dropped.
function onOverlayClose(value: boolean) {
  if (!value) close();
}

function submit() {
  if (!canSubmit.value) return;
  emit(
    'add',
    staged.value.map((row) => ({ ...row })),
  );
  close();
}

// Every open starts clean — a batch abandoned last time shouldn't reappear.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      search.value = '';
      staged.value = [];
      qtyInputs.clear();
    }
  },
);
</script>

<template>
  <BaseModal v-model="open" :title="t('add_sub_product_to_revision')" size="lg">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-slate-500">{{ t('add_sub_product_hint') }}</p>

      <div class="relative">
        <input v-model="search" class="input" :placeholder="t('search')" />
      </div>

      <div v-if="loading" class="py-8 text-center text-sm text-slate-400">
        {{ t('loading') }}
      </div>

      <div v-else-if="filtered.length === 0" class="py-8 text-center text-sm text-slate-400">
        {{ t('no_sub_products_msg') }}
      </div>

      <ul v-else class="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
        <li
          v-for="sp in filtered"
          :key="sp.id"
          class="flex items-center gap-3 px-3 py-2.5"
          :class="{ 'opacity-60': isLinked(sp.id) }"
        >
          <input
            :id="`sp-${sp.id}`"
            type="checkbox"
            class="h-4 w-4 rounded border-slate-300"
            :checked="isLinked(sp.id) || selected[sp.id] != null"
            :disabled="isLinked(sp.id)"
            @change="toggle(sp)"
          />
          <label :for="`sp-${sp.id}`" class="flex-1 cursor-pointer">
            <div class="font-medium text-slate-800">{{ sp.name }}</div>
            <div class="font-mono text-xs text-slate-400">{{ sp.sku || '—' }}</div>
          </label>
          <span
            v-if="isLinked(sp.id)"
            class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
          >
            {{ t('already_added') }}
          </span>
          <select
            v-else-if="selected[sp.id] != null"
            v-model.number="selected[sp.id]"
            class="input max-w-[10rem]"
          >
            <option v-for="rev in sp.revisions" :key="rev.id" :value="rev.id">
              {{ rev.label }}
            </option>
          </select>
          <span v-else class="text-xs text-slate-400">
            {{ sp.revisions.length }} {{ t('revisions').toLowerCase() }}
          </span>
        </li>
      </ul>
    </div>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('cancel') }}
      </button>
      <button type="button" class="btn-primary" :disabled="saving || !anySelected" @click="submit">
        {{ saving ? t('saving') : t('add') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '../../components/modal/BaseModal.vue';
import { subProductsApi } from '../../api/productsAPI.ts';
import type { SubProductSummary } from '../../types/products.ts';

const props = defineProps<{
  // Sub-product revision ids already linked to the current product revision,
  // so we can skip / pre-account for them.
  alreadyLinkedIds?: number[];
  // Sub-product ids already present in the current product revision — these
  // are shown as "added" and cannot be selected again (no duplicates).
  linkedSubProductIds?: number[];
  saving?: boolean;
}>();

const emit = defineEmits<{ add: [subProductRevisionIds: number[]] }>();

const { t } = useI18n();
const open = defineModel<boolean>({ default: false });

const subProducts = ref<SubProductSummary[]>([]);
const loading = ref(false);
const search = ref('');
// sub_product_id -> chosen sub_product_revision_id (or absent if unselected)
const selected = ref<Record<number, number | null>>({});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const withRevs = subProducts.value.filter((sp) => sp.revisions.length > 0);
  if (!q) return withRevs;
  return withRevs.filter(
    (sp) =>
      sp.name.toLowerCase().includes(q) ||
      (sp.sku ?? '').toLowerCase().includes(q),
  );
});

const anySelected = computed(() =>
  Object.values(selected.value).some((v) => v != null),
);

function isLinked(subProductId: number): boolean {
  return (props.linkedSubProductIds ?? []).includes(subProductId);
}

function toggle(sp: SubProductSummary) {
  if (isLinked(sp.id)) return; // already in this revision — no duplicates
  if (selected.value[sp.id] != null) {
    delete selected.value[sp.id];
  } else {
    // Default to the latest revision.
    selected.value[sp.id] = sp.revisions[sp.revisions.length - 1].id;
  }
}

async function load() {
  loading.value = true;
  try {
    const response = await subProductsApi.getAll();
    subProducts.value = response.data;
  } finally {
    loading.value = false;
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  selected.value = {};
  search.value = '';
  load();
});

function submit() {
  const ids = Object.values(selected.value).filter(
    (v): v is number => v != null,
  );
  // Merge with already-linked ids (the API replaces the full set).
  const merged = Array.from(new Set([...(props.alreadyLinkedIds ?? []), ...ids]));
  emit('add', merged);
}
</script>

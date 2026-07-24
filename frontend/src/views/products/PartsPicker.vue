<template>
  <div class="rounded-xl border border-slate-200">
    <div class="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
      <h3 class="text-sm font-semibold text-slate-700">{{ t('parts_in_revision') }}</h3>
      <span class="text-xs text-slate-400">{{ model.length }}</span>
    </div>

    <!-- Add-a-part row -->
    <div class="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
      <select
        v-model.number="partToAdd"
        class="input flex-1"
        :disabled="partsLoading || availableParts.length === 0"
      >
        <option :value="0" disabled>
          {{
            partsLoading
              ? t('loading')
              : availableParts.length
                ? t('select_part')
                : t('all_parts_added')
          }}
        </option>
        <option v-for="p in availableParts" :key="p.id" :value="p.id">
          {{ p.name }} ({{ p.code }})
        </option>
      </select>
      <button
        type="button"
        class="btn-secondary shrink-0 !py-2"
        :disabled="!partToAdd"
        @click="addPart"
      >
        {{ t('add') }}
      </button>
    </div>

    <!-- Selected parts -->
    <div v-if="model.length === 0" class="px-4 py-6 text-center text-sm text-slate-400">
      {{ t('no_parts_selected') }}
    </div>
    <table v-else class="w-full text-left text-sm">
      <thead class="bg-blue-50 text-xs uppercase text-black">
        <tr>
          <th class="px-4 py-2">{{ t('name') }}</th>
          <th class="w-28 px-4 py-2">{{ t('quantity') }} <span class="text-red-500">*</span></th>
          <th class="w-28 px-4 py-2">{{ t('unit') }}</th>
          <th class="px-4 py-2">{{ t('notes') }}</th>
          <th class="w-10 px-4 py-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, i) in model"
          :key="row.partId"
          class="border-t border-slate-100 even:bg-slate-50 transition-colors hover:bg-slate-200"
        >
          <td class="px-4 py-2">
            <div class="font-medium text-slate-800">{{ row.name }}</div>
            <div class="font-mono text-xs text-slate-400">{{ row.code }}</div>
          </td>
          <td class="px-4 py-2">
            <input
              v-model.number="row.quantity"
              type="number"
              min="0"
              step="1"
              class="input !py-1"
              required
              @keydown="(e) => ['.', ',', 'e', 'E', '+', '-'].includes(e.key) && e.preventDefault()"
              @input="row.quantity = Math.trunc(row.quantity)"
            />
            <p v-if="rowErrors[i]" class="mt-1 text-xs text-red-500">{{ rowErrors[i] }}</p>
          </td>
          <td class="px-4 py-2">
            <input v-model="row.unit" class="input !py-1" placeholder="pcs" />
          </td>
          <td class="px-4 py-2">
            <input v-model="row.notes" class="input !py-1" />
          </td>
          <td class="px-4 py-2">
            <button
              type="button"
              class="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
              :title="t('delete')"
              @click="model.splice(i, 1)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Trash2 } from 'lucide-vue-next';
import { partsApi } from '../../api/partsAPI.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { translateApiError } from '../../utils/apiError.ts';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';
import type { Part } from '../../types/parts.ts';
import type { SelectedPart } from '../../types/products.ts';

const { t, te } = useI18n();
const notify = useNotificationStore();

// v-model: the list of selected parts (edited in place).
const model = defineModel<SelectedPart[]>({ default: () => [] });

const parts = ref<Part[]>([]);
const partsLoading = ref(false);
const partToAdd = ref(0);

// Quantity is the only required field per row (its <input> normally blocks
// submission natively when cleared, but the parent form uses `novalidate`
// so this replaces that with an inline, translated message instead).
// validate()/resetValidation() are called by the parent form directly.
const { fieldErrors: rowErrors, validate, resetValidation } = useRequiredFieldValidation(() =>
  model.value.map((row, i) => ({
    key: String(i),
    label: t('quantity'),
    missing: !Number.isFinite(Number(row.quantity)) || `${row.quantity}`.trim() === '',
  })),
);

defineExpose({ validate, resetValidation });

const availableParts = computed(() =>
  parts.value.filter((p) => !model.value.some((s) => s.partId === p.id)),
);

function addPart() {
  const part = parts.value.find((p) => p.id === partToAdd.value);
  if (!part) return;
  model.value.push({
    partId: part.id,
    name: part.name,
    code: part.code,
    quantity: 1,
    unit: '',
    notes: '',
  });
  partToAdd.value = 0;
}

onMounted(async () => {
  partsLoading.value = true;
  try {
    const response = await partsApi.getAll();
    parts.value = response.data;
  } catch (err: any) {
    notify.showToast(
      translateApiError(err, { t, te }, 'errors.load_parts_failed'),
      'error',
    );
  } finally {
    partsLoading.value = false;
  }
});
</script>

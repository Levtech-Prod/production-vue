<template>
  <div class="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
    <div class="mb-3 flex items-center justify-between">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {{ t('parameter_filters') }}
      </h3>
      <button
        v-if="hasActiveFilters"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white transition-colors"
        @click="clearAll"
      >
        {{ t('clear_filters') }}
      </button>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <div v-for="p in parameters" :key="p.id" class="flex flex-col gap-1">
        <label
          class="text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          {{ p.name }}
          <span v-if="p.unit" class="normal-case text-slate-400"
            >({{ p.unit }})</span
          >
        </label>

        <!-- number -> min / max interval -->
        <div v-if="p.type === 'number'" class="flex items-center gap-2">
          <input
            type="number"
            step="any"
            class="input text-sm"
            :placeholder="t('min')"
            :value="model[p.id!]?.min ?? ''"
            @input="
              update(p.id!, { min: ($event.target as HTMLInputElement).value })
            "
          />
          <span class="text-slate-400">–</span>
          <input
            type="number"
            step="any"
            class="input text-sm"
            :placeholder="t('max')"
            :value="model[p.id!]?.max ?? ''"
            @input="
              update(p.id!, { max: ($event.target as HTMLInputElement).value })
            "
          />
        </div>

        <!-- dropdown -> option select -->
        <select
          v-else-if="p.type === 'dropdown'"
          class="input text-sm"
          :value="model[p.id!]?.value ?? ''"
          @change="
            update(p.id!, { value: ($event.target as HTMLSelectElement).value })
          "
        >
          <option value="">{{ t('all') }}</option>
          <option v-for="option in p.options" :key="option" :value="option">
            {{ option }}
          </option>
        </select>

        <!-- boolean -> all / yes / no -->
        <select
          v-else-if="p.type === 'boolean'"
          class="input text-sm"
          :value="model[p.id!]?.value ?? ''"
          @change="
            update(p.id!, { value: ($event.target as HTMLSelectElement).value })
          "
        >
          <option value="">{{ t('all') }}</option>
          <option value="true">{{ t('yes') }}</option>
          <option value="false">{{ t('no') }}</option>
        </select>

        <!-- text -> contains -->
        <input
          v-else
          type="text"
          class="input text-sm"
          :placeholder="p.name"
          :value="model[p.id!]?.value ?? ''"
          @input="
            update(p.id!, { value: ($event.target as HTMLInputElement).value })
          "
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PartCategoryParameter } from '../../types/partCategories.ts';
import type {
  ParameterFilters,
  ParameterFilterValue,
} from '../../types/parts.ts';

const { t } = useI18n();

defineProps<{
  parameters: PartCategoryParameter[];
}>();

const model = defineModel<ParameterFilters>({ required: true });

const hasActiveFilters = computed(() =>
  Object.values(model.value).some(
    (f) => (f.value ?? '') !== '' || (f.min ?? '') !== '' || (f.max ?? '') !== '',
  ),
);

function update(parameterId: number, patch: ParameterFilterValue) {
  model.value = {
    ...model.value,
    [parameterId]: { ...(model.value[parameterId] || {}), ...patch },
  };
}

function clearAll() {
  model.value = {};
}
</script>

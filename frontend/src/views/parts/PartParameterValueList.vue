<template>
  <div>
    <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
      {{ t('parameters') }}
    </h3>

    <!-- Empty state -->
    <div
      v-if="parameters.length === 0"
      class="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center"
    >
      <p class="text-sm text-slate-400">{{ t('no_parameters_msg') }}</p>
    </div>

    <div v-else class="grid gap-3 md:grid-cols-2">
      <div
        v-for="p in parameters"
        :key="p.id"
        class="flex flex-col gap-1"
      >
        <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">
          {{ p.name }}
          <span v-if="p.unit">({{ p.unit }})</span>
          <span v-if="p.required" class="text-red-500">*</span>
        </label>

        <!-- dropdown -->
        <select
          v-if="p.type === 'dropdown'"
          v-model="values[p.id!]"
          class="input text-sm"
          :required="p.required"
        >
          <option value="">{{ t('select_option') }}</option>
          <option v-for="option in p.options" :key="option" :value="option">
            {{ option }}
          </option>
        </select>

        <!-- boolean -->
        <label
          v-else-if="p.type === 'boolean'"
          class="flex items-center gap-2 text-sm text-slate-600 h-9"
        >
          <input
            type="checkbox"
            class="rounded"
            :checked="values[p.id!] === 'true'"
            @change="
              values[p.id!] = ($event.target as HTMLInputElement).checked
                ? 'true'
                : 'false'
            "
          />
          {{ t('yes') }}
        </label>

        <!-- number / text -->
        <input
          v-else
          v-model="values[p.id!]"
          :type="p.type === 'number' ? 'number' : 'text'"
          :step="p.type === 'number' ? 'any' : undefined"
          class="input text-sm"
          :placeholder="p.name"
          :required="p.required"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { PartCategoryParameter } from '../../types/partCategories.ts';

const { t } = useI18n();

defineProps<{
  parameters: PartCategoryParameter[];
}>();

const values = defineModel<Record<number, string>>({ required: true });
</script>

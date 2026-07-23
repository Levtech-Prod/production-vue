<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        {{ t('parameters') }}
      </h3>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-md transition-colors"
        @click="addParam"
      >
        <Plus class="h-3.5 w-3.5" />
        {{ t('add_parameter') }}
      </button>
    </div>

    <!-- Empty state -->
    <div
      v-if="parameters.length === 0"
      class="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center"
    >
      <p class="text-sm text-slate-400">{{ t('no_parameters_msg') }}</p>
    </div>

    <div class="space-y-2">
      <div
        v-for="(p, i) in parameters"
        :key="i"
        class="rounded-xl bg-slate-50 p-3 space-y-3"
      >
        <div class="grid gap-2 md:grid-cols-[1.4fr_1fr_1.2fr_0.8fr_40px]">
          <div class="flex flex-col gap-1">
            <input
              id="part-category-param-name-{{ i }}"
              v-model="p.name"
              :required="p.required"
              class="input text-sm"
              :placeholder="t('name')"
            />
            <p v-if="fieldErrors[i]" class="text-xs text-red-500">{{ fieldErrors[i] }}</p>
          </div>

          <select
            id="part-category-param-type-{{ i }}"
            v-model="p.type"
            class="input text-sm"
            @change="handleTypeChange(p)"
          >
            <option value="text">{{ t('text') }}</option>
            <option value="number">{{ t('number') }}</option>
            <option value="boolean">{{ t('boolean') }}</option>
            <option value="dropdown">{{ t('dropdown') }}</option>
          </select>

          <input
            id="part-category-param-unit-{{ i }}"
            v-model="p.unit"
            class="input text-sm"
            :placeholder="t('unit')"
            :disabled="p.type === 'boolean'"
          />

          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input v-model="p.required" type="checkbox" class="rounded" />
            {{ t('required') }}
          </label>

          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-colors"
            @click="removeParam(i)"
          >
            <Trash2 class="h-4 w-4" />
          </button>
        </div>

        <div
          v-if="p.type === 'dropdown'"
          class="rounded-lg border border-slate-200 bg-white p-3 space-y-2"
        >
          <label
            class="text-xs font-semibold text-slate-500 uppercase tracking-wide"
          >
            {{ t('dropdown_options_title') }}
          </label>

          <div
            v-for="(_option, optionIndex) in p.options"
            :key="optionIndex"
            class="grid grid-cols-[1fr_40px] gap-2 mt-2"
          >
            <input
              v-model="p.options![optionIndex]"
              class="input text-sm w-full"
              placeholder="Option value"
            />

            <button
              type="button"
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-colors"
              @click="removeDropdownOption(p, optionIndex)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-md transition-colors"
            @click="addDropdownOption(p)"
          >
            + {{ t('add_dropdown_option') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PartCategoryParameter } from '../../types/partCategories.ts';
import { useI18n } from 'vue-i18n';
import { Plus, Trash2 } from 'lucide-vue-next';
import { useRequiredFieldValidation } from '../../composables/useRequiredFieldValidation.ts';

const parameters = defineModel<PartCategoryParameter[]>({ required: true });

const { t } = useI18n();

// A parameter's name is only required once it's marked as required itself —
// rows left blank (and not marked required) are silently dropped on save.
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(() =>
  parameters.value
    .map((p, i) => ({ key: String(i), label: t('name'), missing: p.required && !p.name.trim() })),
);

defineExpose({ validate, resetValidation });

function addParam() {
  parameters.value.push({
    name: '',
    type: 'text',
    unit: '',
    required: false,
    options: [],
  });
}

function removeParam(index: number) {
  parameters.value.splice(index, 1);
}

function handleTypeChange(parameter: PartCategoryParameter) {
  if (parameter.type === 'dropdown') {
    parameter.options = parameter.options?.length ? parameter.options : [''];
  } else {
    parameter.options = [];
  }

  if (parameter.type === 'boolean') {
    parameter.unit = '';
  }
}

function addDropdownOption(parameter: PartCategoryParameter) {
  if (!parameter.options) {
    parameter.options = [];
  }

  parameter.options.push('');
}

function removeDropdownOption(parameter: PartCategoryParameter, index: number) {
  parameter.options?.splice(index, 1);
}
</script>

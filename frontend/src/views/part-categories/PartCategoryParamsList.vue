<template>
  <div>
    <div class="mb-2 mt-2 flex items-center justify-between">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {{ t('parameters') }}
      </h3>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
        @click="addParam"
      >
        <Plus class="h-3.5 w-3.5" />
        {{ t('add_parameter') }}
      </button>
    </div>

    <div class="overflow-hidden rounded-lg border border-slate-300 bg-white">
      <table class="w-full text-left text-sm">
        <thead
          class="border-b border-slate-300 bg-blue-50 text-[11px] uppercase tracking-wide text-slate-600"
        >
          <tr>
            <th class="border-r border-slate-300 px-2 py-1 font-medium">
              {{ t('name') }}
            </th>
            <th class="border-r border-slate-300 px-2 py-1 font-medium">
              {{ t('type') }}
            </th>
            <th class="border-r border-slate-300 px-2 py-1 font-medium">
              {{ t('unit') }}
            </th>
            <th
              class="border-r border-slate-300 px-2 py-1 text-center font-medium"
            >
              {{ t('required') }}
            </th>
            <th
              class="border-r border-slate-300 px-2 py-1 text-center font-medium"
            >
              {{ t('show_as_column') }}
            </th>
            <th class="w-9 px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="parameters.length === 0">
            <td
              colspan="6"
              class="px-2 py-4 text-center text-sm text-slate-400"
            >
              {{ t('no_parameters_msg') }}
            </td>
          </tr>

          <template v-for="(p, i) in parameters" :key="keyFor(p)">
            <tr class="border-t border-slate-300 align-top">
              <td class="border-r border-slate-300 px-2 py-1">
                <input
                  v-model="p.name"
                  :required="p.required"
                  class="input-cell"
                  :placeholder="t('name')"
                />
                <p v-if="fieldErrors[i]" class="mt-0.5 text-xs text-red-500">
                  {{ fieldErrors[i] }}
                </p>
              </td>

              <td class="border-r border-slate-300 px-2 py-1">
                <select
                  v-model="p.type"
                  class="input-cell"
                  @change="handleTypeChange(p)"
                >
                  <option value="text">{{ t('text') }}</option>
                  <option value="number">{{ t('number') }}</option>
                  <option value="boolean">{{ t('boolean') }}</option>
                  <option value="dropdown">{{ t('dropdown') }}</option>
                </select>
              </td>

              <td class="border-r border-slate-300 px-2 py-1">
                <input
                  v-model="p.unit"
                  class="input-cell"
                  :placeholder="t('unit')"
                  :disabled="p.type === 'boolean'"
                />
              </td>

              <td class="border-r border-slate-300 px-2 py-1 text-center">
                <input
                  v-model="p.required"
                  type="checkbox"
                  class="mt-2 rounded"
                />
              </td>

              <td class="border-r border-slate-300 px-2 py-1 text-center">
                <input
                  v-model="p.showAsColumn"
                  type="checkbox"
                  class="mt-2 rounded"
                />
              </td>

              <td class="px-2 py-1 text-right">
                <button
                  type="button"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50"
                  @click="removeParam(i)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </td>
            </tr>

            <tr v-if="p.type === 'dropdown'">
              <td colspan="6" class="px-2 pb-2">
                <div
                  class="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2"
                >
                  <label
                    class="text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {{ t('dropdown_options_title') }}
                  </label>

                  <div
                    v-for="(_option, optionIndex) in p.options"
                    :key="optionIndex"
                    class="grid grid-cols-[1fr_32px] gap-1.5"
                  >
                    <input
                      v-model="p.options![optionIndex]"
                      class="input-sm"
                      placeholder="Option value"
                    />

                    <button
                      type="button"
                      class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50"
                      @click="removeDropdownOption(p, optionIndex)"
                    >
                      <Trash2 class="h-4 w-4" />
                    </button>
                  </div>

                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
                    @click="addDropdownOption(p)"
                  >
                    + {{ t('add_dropdown_option') }}
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
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

// Stable per-row key so adding/removing a row doesn't make Vue reuse the wrong
// <tr> (which would misattach input focus/values). Saved rows key by their db
// id; new, unsaved rows get a client-only uid tracked by object identity.
const rowKeys = new WeakMap<PartCategoryParameter, number>();
let rowKeySeq = 0;
function keyFor(p: PartCategoryParameter): string {
  if (p.id != null) return `id-${p.id}`;
  let key = rowKeys.get(p);
  if (key === undefined) {
    key = ++rowKeySeq;
    rowKeys.set(p, key);
  }
  return `new-${key}`;
}

// A parameter's name is only required once it's marked as required itself —
// rows left blank (and not marked required) are silently dropped on save.
const { fieldErrors, validate, resetValidation } = useRequiredFieldValidation(
  () =>
    parameters.value.map((p, i) => ({
      key: String(i),
      label: t('name'),
      missing: p.required && !p.name.trim(),
    })),
);

defineExpose({ validate, resetValidation });

function addParam() {
  parameters.value.push({
    name: '',
    type: 'text',
    unit: '',
    required: false,
    showAsColumn: false,
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

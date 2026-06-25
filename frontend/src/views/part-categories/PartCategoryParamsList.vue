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
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-3.5 w-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
            clip-rule="evenodd"
          />
        </svg>
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
          <input
            v-model="p.name"
            class="input text-sm"
            :placeholder="t('name')"
          />

          <select
            v-model="p.type"
            class="input text-sm"
            @change="handleTypeChange(p)"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="dropdown">Dropdown</option>
          </select>

          <input
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </div>

        <div
          v-if="p.type === 'dropdown'"
          class="rounded-lg border border-slate-200 bg-white p-3 space-y-2"
        >
          <label
            class="text-xs font-semibold text-slate-500 uppercase tracking-wide"
          >
            Dropdown options
          </label>

          <div
            v-for="(_option, optionIndex) in p.options"
            :key="optionIndex"
            class="grid grid-cols-[1fr_40px] gap-2"
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
          </div>

          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-md transition-colors"
            @click="addDropdownOption(p)"
          >
            + Add option
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PartCategoryParameter } from '../../types/partCategories.ts';
import { useI18n } from 'vue-i18n';

const parameters = defineModel<PartCategoryParameter[]>({ required: true });

const { t } = useI18n();

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

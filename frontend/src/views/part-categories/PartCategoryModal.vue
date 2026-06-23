<template>
  <BaseModal
    v-model="isOpen"
    :title="category ? `Szerkesztés: ${form.name || '…'}` : 'Új kategória'"
    size="lg"
  >
    <!-- Form body -->
    <form class="space-y-5" @submit.prevent="save">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label
            class="text-xs font-medium text-slate-500 uppercase tracking-wide"
            >Név</label
          >
          <input
            v-model="form.name"
            class="input"
            placeholder="Kategória neve"
            required
          />
        </div>
        <div class="flex flex-col gap-1">
          <label
            class="text-xs font-medium text-slate-500 uppercase tracking-wide"
            >Leírás</label
          >
          <input
            v-model="form.description"
            class="input"
            placeholder="Rövid leírás"
          />
        </div>

        <div class="flex flex-col gap-1 md:col-span-2">
          <label
            class="text-xs font-medium text-slate-500 uppercase tracking-wide"
            >Kép</label
          >

          <!-- Existing image preview -->
          <div
            v-if="form.image"
            class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3"
          >
            <img
              :src="form.image"
              class="h-16 w-16 rounded-lg border border-slate-200 object-cover shrink-0"
              alt="Category image preview"
            />
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 border border-red-200 transition-colors shrink-0"
              @click="form.image = ''"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-3.5 w-3.5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
              Kép eltávolítása
            </button>
          </div>

          <!-- Uploader — shown when no image is set -->
          <FileUploader
            v-else
            label="Category image"
            target="part-categories"
            :is-file-uploaded="false"
            @uploaded="(url: string) => (form.image = url)"
          />
        </div>
      </div>

      <PartCategoryParameterList v-model="form.parameters" />
    </form>

    <!-- Footer slot -->
    <template #footer>
      <button
        type="button"
        class="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
        @click="isOpen = false"
      >
        Mégsem
      </button>
      <button
        type="button"
        class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
        @click="save"
      >
        {{ category ? 'Mentés' : 'Kategória létrehozása' }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import BaseModal from '../../components/modal/BaseModal.vue';
import PartCategoryParameterList from './PartCategoryParamsList.vue';
import FileUploader from '../../components/uploader/FileUploader.vue';
import type {
  PartCategory,
  PartCategoryParameter,
} from '../../types/partCategories.ts';

const props = defineProps<{
  modelValue: boolean;
  category?: PartCategory | null; // null = add mode, PartCategory = edit mode
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [
    payload: {
      name: string;
      description: string;
      image: string | null;
      parameters: PartCategoryParameter[];
    },
  ];
}>();

// Two-way binding for the open state — pass through to BaseModal
const isOpen = defineModel<boolean>({ required: true });

const form = reactive({
  name: '',
  description: '',
  image: '',
  parameters: [] as PartCategoryParameter[],
});

// Populate form when the modal opens or the category prop changes
watch(
  () => [props.modelValue, props.category] as const,
  ([open, category]) => {
    if (!open) return;
    if (category) {
      form.name = category.name;
      form.description = category.description ?? '';
      form.image = category.image ?? '';
      form.parameters = category.parameters?.length
        ? category.parameters.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
            unit: p.unit ?? '',
            required: p.required,
          }))
        : [];
    } else {
      resetForm();
    }
  },
  { immediate: true },
);

function resetForm() {
  form.name = '';
  form.description = '';
  form.image = '';
  form.parameters = [];
}

function save() {
  emit('saved', {
    name: form.name,
    description: form.description,
    image: form.image || null,
    parameters: form.parameters.filter((p) => p.name.trim() !== ''),
  });
  isOpen.value = false;
}
</script>

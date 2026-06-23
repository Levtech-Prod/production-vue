<template>
  <div>
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold">Alkatrész kategóriák</h1>
        <p class="mt-1 text-slate-500">
          Define dynamic parameter templates for parts.
        </p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
        @click="openAddModal"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
            clip-rule="evenodd"
          />
        </svg>
        Kategória hozzáadása
      </button>
    </div>

    <!-- Table card -->
    <div class="card mt-6 overflow-hidden">
      <!-- Search / filter bar -->
      <div class="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div class="relative flex-1 max-w-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clip-rule="evenodd"
            />
          </svg>
          <input
            v-model="searchQuery"
            class="input !pl-9"
            placeholder="Keresés név, leírás, paraméter alapján"
          />
        </div>
        <span class="text-sm text-slate-400">
          {{ filteredCategories.length }} / {{ categories.length }} kategória
        </span>
      </div>

      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="p-4">Név</th>
            <th class="p-4">Kép</th>
            <th class="p-4">Leírás</th>
            <th class="p-4">Paraméterek</th>
            <th class="p-4">Műveletek</th>
          </tr>
        </thead>
        <tbody>
          <!-- Empty state -->
          <tr v-if="filteredCategories.length === 0">
            <td colspan="5" class="py-12 text-center text-sm text-slate-400">
              <template v-if="searchQuery">
                Nincs találat a(z) „{{ searchQuery }}" keresésre.
              </template>
              <template v-else>
                Még nincs kategória. Kattints a „Kategória hozzáadása" gombra az
                első létrehozásához.
              </template>
            </td>
          </tr>
          <tr
            v-for="category in filteredCategories"
            :key="category.id"
            class="border-t border-slate-100 hover:bg-slate-50 transition-colors"
          >
            <td class="p-4 font-semibold">{{ category.name }}</td>
            <td class="p-4">
              <img
                v-if="category.image"
                :src="category.image"
                class="h-10 w-10 rounded-md border object-cover"
              />
              <span v-else class="text-slate-300">—</span>
            </td>
            <td class="p-4 text-slate-500">
              {{ category.description || '—' }}
            </td>
            <td class="p-4">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="parameter in category.parameters"
                  :key="parameter.id"
                  class="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                >
                  {{ parameter.name }}
                </span>
                <span v-if="!category.parameters?.length" class="text-slate-300"
                  >—</span
                >
              </div>
            </td>
            <td class="p-4">
              <button
                class="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium hover:bg-slate-200 transition-colors"
                @click="openEditModal(category)"
              >
                Szerkesztés
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal overlay -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="modalOpen"
          class="fixed inset-0 z-50 flex items-center justify-center p-4"
          @mousedown.self="closeModal"
        >
          <!-- Backdrop -->
          <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" />

          <!-- Modal panel -->
          <div
            class="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl"
          >
            <!-- Modal header -->
            <div
              class="flex items-center justify-between border-b border-slate-100 px-6 py-4"
            >
              <h2 class="text-lg font-semibold text-slate-800">
                {{
                  isEditing
                    ? `Szerkesztés: ${form.name || '…'}`
                    : 'Új kategória'
                }}
              </h2>
              <button
                class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                @click="closeModal"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clip-rule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <!-- Modal body (scrollable) -->
            <form
              class="flex-1 overflow-y-auto px-6 py-5 space-y-5"
              @submit.prevent="save"
            >
              <!-- Basic fields -->
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
                      class="inline-flex gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 border border-red-200 transition-colors shrink-0"
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
                    @uploaded="handleImageUploaded"
                  />
                </div>
              </div>

              <!-- Parameters section -->
              <div>
                <div class="flex items-center justify-between mb-3">
                  <h3
                    class="text-xs font-semibold text-slate-500 uppercase tracking-wide"
                  >
                    Paraméterek
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
                    Paraméter hozzáadása
                  </button>
                </div>

                <!-- Parameters empty state -->
                <div
                  v-if="form.parameters.length === 0"
                  class="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center"
                >
                  <p class="text-sm text-slate-400">
                    Még nincs paraméter megadva.
                  </p>
                </div>

                <!-- Parameter rows -->
                <div class="space-y-2">
                  <div
                    v-for="(p, i) in form.parameters"
                    :key="i"
                    class="grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-5"
                  >
                    <input
                      v-model="p.name"
                      class="input text-sm"
                      placeholder="Név"
                    />
                    <select v-model="p.type" class="input text-sm">
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                    </select>
                    <input
                      v-model="p.unit"
                      class="input text-sm"
                      placeholder="Egység"
                    />
                    <label
                      class="flex items-center gap-2 text-sm text-slate-600"
                    >
                      <input
                        v-model="p.required"
                        type="checkbox"
                        class="rounded"
                      />
                      Kötelező
                    </label>
                    <button
                      type="button"
                      class="inline-flex items-center justify-center rounded-lg text-sm text-red-500 hover:bg-red-50 px-2 py-1.5 transition-colors"
                      @click="form.parameters.splice(i, 1)"
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
                </div>
              </div>
            </form>

            <!-- Modal footer -->
            <div
              class="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4"
            >
              <button
                type="button"
                class="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
                @click="closeModal"
              >
                Mégsem
              </button>
              <button
                type="button"
                class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
                @click="save"
              >
                {{ isEditing ? 'Mentés' : 'Kategória létrehozása' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, computed, ref } from 'vue';
import { usePartCategoryStore } from '../stores/partCategoriesStore.ts';
import type {
  PartCategoryParameter,
  PartCategory,
} from '../types/partCategories.ts';
import FileUploader from '../components/uploader/FileUploader.vue';

const partCategoryStore = usePartCategoryStore();
const categories = computed(() => partCategoryStore.categories);

// Search
const searchQuery = ref('');
const filteredCategories = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return categories.value;
  return categories.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.parameters?.some((p) => p.name.toLowerCase().includes(q)),
  );
});

// Form state
const form = reactive({
  name: '',
  description: '',
  image: '',
  parameters: [] as PartCategoryParameter[],
});

const modalOpen = ref(false);
const isEditing = ref(false);
const editingCategoryId = ref<number | null>(null);

function openAddModal() {
  resetForm();
  modalOpen.value = true;
}

function openEditModal(category: PartCategory) {
  resetForm();
  isEditing.value = true;
  editingCategoryId.value = category.id;

  form.name = category.name;
  form.description = category.description;
  form.image = category.image || '';
  form.parameters = category.parameters?.length
    ? category.parameters.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        unit: p.unit ?? '',
        required: p.required,
      }))
    : [];

  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  resetForm();
}

function addParam() {
  form.parameters.push({ name: '', type: 'text', unit: '', required: false });
}

async function save() {
  const payload = {
    name: form.name,
    description: form.description,
    image: form.image || null,
    parameters: form.parameters.filter((p) => p.name.trim() !== ''),
  };

  if (isEditing.value && editingCategoryId.value !== null) {
    await partCategoryStore.updateCategory(editingCategoryId.value, payload);
  } else {
    await partCategoryStore.saveCategory(payload);
  }

  closeModal();
  await partCategoryStore.loadCategories();
}

function handleImageUploaded(url: string) {
  form.image = url;
}

function resetForm() {
  isEditing.value = false;
  editingCategoryId.value = null;
  form.name = '';
  form.description = '';
  form.image = '';
  form.parameters = [];
}

onMounted(() => {
  partCategoryStore.loadCategories();
});
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.15s ease;
}
.modal-enter-active .relative,
.modal-leave-active .relative {
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative {
  transform: translateY(8px);
  opacity: 0;
}
</style>

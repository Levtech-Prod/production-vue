<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- One section card for the whole board: toolbar, then the columns —
         the same shape the products list uses. -->
    <div class="card flex min-h-0 flex-1 flex-col overflow-hidden">
      <!-- The board is filtered by default (§6.3), and the filter lives in
           the query string so a filtered board is a shareable link. -->
      <div
        class="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3"
      >
        <div class="flex overflow-hidden rounded-lg border border-slate-200 text-sm font-medium">
          <button
            v-for="(status, i) in PROJECT_STATUSES"
            :key="status"
            type="button"
            class="px-3 py-2 transition-colors disabled:cursor-not-allowed"
            :class="[
              i > 0 ? 'border-l border-slate-200' : '',
              statuses.includes(status)
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50',
            ]"
            :disabled="isOnlySelected(status)"
            :title="isOnlySelected(status) ? t('at_least_one_status') : undefined"
            @click="toggleStatus(status)"
          >
            {{ t(`project_status.${status}`) }}
          </button>
        </div>

        <div class="relative max-w-xs flex-1">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input v-model="search" class="input !pl-9" :placeholder="t('name')" />
        </div>

        <span class="text-sm text-slate-400">
          {{ store.loading ? t('loading') : store.board.length }}
        </span>

        <button
          class="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800"
          @click="openCreate"
        >
          <Plus class="h-4 w-4" />
          {{ t('add_project') }}
        </button>
      </div>

      <p v-if="store.error" class="shrink-0 bg-red-50 px-4 py-2 text-sm text-red-600">
        {{ store.error }}
      </p>

      <ProjectBoard
        class="flex-1"
        :projects="store.board"
        :selected-id="selectedProjectId"
        @select="toggleSelection"
        @edit="openEdit"
        @delete="openDeleteTarget"
      />
    </div>

    <ProjectModal
      v-model="modalOpen"
      :project="editing"
      :save-error="saveError"
      :saving="saving"
      @saved="onSaved"
    />

    <DeleteConfirmModal
      :target="deleteTarget"
      title-key="delete_project"
      message-key="confirmations.delete_project_msg"
      :label="(project) => project.name"
      :loading="deleteBusy"
      @confirm="confirmDeleteProject"
      @cancel="cancelDeleteProject"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Plus, Search } from 'lucide-vue-next';
import ProjectBoard from './board/ProjectBoard.vue';
import ProjectModal from './ProjectModal.vue';
import DeleteConfirmModal from '../../components/notification/DeleteConfirmModal.vue';
import { useConfirmDelete } from '../../composables/useConfirmDelete.ts';
import { useProjectsStore } from '../../stores/projectsStore.ts';
import { useNotificationStore } from '../../stores/notificationStore.ts';
import { translateApiError } from '../../utils/apiError.ts';
import {
  DEFAULT_BOARD_STATUSES,
  PROJECT_STATUSES,
  type Project,
  type ProjectBoardCard,
  type ProjectPayload,
  type ProjectStatus,
} from '../../types/projects.ts';

const { t, te } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useProjectsStore();
const notify = useNotificationStore();

// ---- Filters ----------------------------------------------------------------
//
// The query string is the source of truth: every filter change is a
// `router.replace`, and the fetch reacts to the resulting route.

function queryParam(key: string): string | null {
  const value = route.query[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const statuses = computed<ProjectStatus[]>(() => {
  const requested = queryParam('status')?.split(',') ?? [];
  const known = PROJECT_STATUSES.filter((s) => requested.includes(s));
  return known.length ? known : DEFAULT_BOARD_STATUSES;
});

function setFilters(next: { status?: ProjectStatus[]; q?: string }) {
  const status = next.status ?? statuses.value;
  const q = next.q ?? (queryParam('q') || '');
  router.replace({
    query: { status: status.join(','), ...(q ? { q } : {}) },
  });
}

function isOnlySelected(status: ProjectStatus): boolean {
  return statuses.value.length === 1 && statuses.value[0] === status;
}

function toggleStatus(status: ProjectStatus) {
  if (isOnlySelected(status)) return;
  const next = statuses.value.includes(status)
    ? statuses.value.filter((s) => s !== status)
    : PROJECT_STATUSES.filter((s) => s === status || statuses.value.includes(s));
  setFilters({ status: next });
}

// Typed separately from the URL so each keystroke doesn't push a route.
const search = ref(queryParam('q') ?? '');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(search, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setFilters({ q: value.trim() }), 300);
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

async function loadBoard() {
  try {
    await store.fetchBoard({ status: statuses.value, q: queryParam('q') ?? undefined });
  } catch {
    // The store holds the message; the toolbar renders it.
  }
}

// One primitive key, so the board refetches exactly when the filters change.
watch(() => `${statuses.value.join(',')}|${queryParam('q') ?? ''}`, loadBoard);

// Keeps the box in step with the URL when the filters change from elsewhere
// — a shared link, or the back button.
watch(
  () => queryParam('q') ?? '',
  (q) => {
    if (q !== search.value.trim()) search.value = q;
  },
);

// ---- Selection --------------------------------------------------------------
//
// Selecting dims the other projects rather than hiding them, so the board
// keeps its shape (§6.3). The Parts table it also drives arrives with story 9.

const selectedProjectId = ref<number | null>(null);

function toggleSelection(id: number) {
  selectedProjectId.value = selectedProjectId.value === id ? null : id;
}

// ---- Create / edit ----------------------------------------------------------

const modalOpen = ref(false);
const editing = ref<Project | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);

function openCreate() {
  editing.value = null;
  saveError.value = null;
  modalOpen.value = true;
}

// The board card carries no products, so editing loads the full project
// before the modal opens rather than showing it half-populated.
async function openEdit(card: ProjectBoardCard) {
  try {
    editing.value = await store.fetchProject(card.id);
  } catch (err) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.load_project_failed'), 'error');
    return;
  }
  saveError.value = null;
  modalOpen.value = true;
}

async function onSaved(payload: ProjectPayload) {
  saving.value = true;
  saveError.value = null;
  try {
    if (editing.value) {
      await store.updateProject(editing.value.id, payload);
      notify.showToast(t('success.update_project'), 'success');
    } else {
      await store.createProject(payload);
      notify.showToast(t('success.save_project'), 'success');
    }
    modalOpen.value = false;
    await loadBoard();
  } catch (err) {
    saveError.value = translateApiError(err, { t, te }, 'errors.save_project_failed');
  } finally {
    saving.value = false;
  }
}

// ---- Delete -----------------------------------------------------------------

const {
  target: deleteTarget,
  busy: deleteBusy,
  open: openDeleteTarget,
  confirm: confirmDeleteProject,
  cancel: cancelDeleteProject,
} = useConfirmDelete<ProjectBoardCard>(async (project) => {
  try {
    await store.deleteProject(project.id);
    if (selectedProjectId.value === project.id) selectedProjectId.value = null;
    notify.showToast(t('success.delete_project'), 'success');
    return true;
  } catch (err) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.delete_project_failed'), 'error');
    return false;
  }
});

onMounted(loadBoard);
</script>

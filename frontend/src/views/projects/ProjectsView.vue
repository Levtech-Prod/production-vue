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
          {{ store.loading ? t('loading') : visibleProjects.length }}
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
        :projects="visibleProjects"
        :selected-id="selectedProjectId"
        @select="toggleSelection"
        @edit="openEdit"
        @start="openStartTarget"
        @delete="openDeleteTarget"
        @stop="openStopTarget"
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

    <!-- Start is confirmed like the two destructive actions because it is
         just as final: it freezes the parts list, claims stock, and leaves a
         project that can no longer be edited or deleted. Blue rather than red
         because nothing is being destroyed — but it keeps ConfirmModal's
         default Cancel focus, so the one keystroke that cannot be taken back
         is never the one already under the user's finger. -->
    <DeleteConfirmModal
      :target="startTarget"
      title-key="start_project"
      message-key="confirmations.start_project_msg"
      confirm-text-key="start_project"
      variant="primary"
      :label="(project) => project.name"
      :loading="startBusy"
      @confirm="confirmStartProject"
      @cancel="cancelStartProject"
    />

    <DeleteConfirmModal
      :target="stopTarget"
      title-key="stop_project"
      message-key="confirmations.stop_project_msg"
      confirm-text-key="stop_project"
      :label="(project) => project.name"
      :loading="stopBusy"
      @confirm="confirmStopProject"
      @cancel="cancelStopProject"
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
// The query string is the source of truth for both filters, so a filtered
// board is a shareable link. Only the status filter reaches the API, though:
// the name search matches the rows already loaded.

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

// The name search filters the loaded board rather than going back to the API.
// A board is tens of rows, so matching them here is instant and costs no
// request; the URL still carries `q` so a filtered board stays a shareable
// link, written back on a debounce because that is a navigation, not a filter.
const search = ref(queryParam('q') ?? '');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(search, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setFilters({ q: value.trim() }), 300);
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

const visibleProjects = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? store.board.filter((p) => p.name.toLowerCase().includes(q)) : store.board;
});

async function loadBoard() {
  try {
    await store.fetchBoard({ status: statuses.value });
  } catch {
    // The store holds the message; the toolbar renders it.
  }
}

// Only the status filter reaches the API, so only it refetches.
watch(() => statuses.value.join(','), loadBoard);

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

// A selection the board no longer holds would dim every remaining card with
// nothing lit. That happens whenever the status filter narrows, and now also
// on Stop, which moves a project out of the default statuses — so the rule
// lives on the board rather than in each action that can drop a card.
watch(
  () => store.board,
  (board) => {
    if (selectedProjectId.value != null && !board.some((p) => p.id === selectedProjectId.value)) {
      selectedProjectId.value = null;
    }
  },
);

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

// ---- Card actions -----------------------------------------------------------
//
// Delete, Start and Stop are one flow — confirm, call, toast, and leave the
// modal open on failure so the user can retry — differing only in the call and
// the two message keys. `useConfirmDelete` is reused unchanged for all three
// (§11.4); what is shared here is the action wrapped around it.

function confirmedCardAction(
  run: (project: ProjectBoardCard) => Promise<void>,
  successKey: string,
  errorKey: string,
) {
  return useConfirmDelete<ProjectBoardCard>(async (project) => {
    try {
      await run(project);
      notify.showToast(t(successKey), 'success');
      return true;
    } catch (err) {
      notify.showToast(translateApiError(err, { t, te }, errorKey), 'error');
      return false;
    }
  });
}

const {
  target: deleteTarget,
  busy: deleteBusy,
  open: openDeleteTarget,
  confirm: confirmDeleteProject,
  cancel: cancelDeleteProject,
} = confirmedCardAction(
  (project) => store.deleteProject(project.id),
  'success.delete_project',
  'errors.delete_project_failed',
);

// Both transitions move the project between derived columns, and that
// membership is the server's to compute (§4.1) — so the board is refetched
// rather than patched from the returned project.
const {
  target: startTarget,
  busy: startBusy,
  open: openStartTarget,
  confirm: confirmStartProject,
  cancel: cancelStartProject,
} = confirmedCardAction(
  async (project) => {
    await store.startProject(project.id);
    await loadBoard();
  },
  'success.start_project',
  'errors.start_project_failed',
);

const {
  target: stopTarget,
  busy: stopBusy,
  open: openStopTarget,
  confirm: confirmStopProject,
  cancel: cancelStopProject,
} = confirmedCardAction(
  async (project) => {
    await store.stopProject(project.id);
    await loadBoard();
  },
  'success.stop_project',
  'errors.stop_project_failed',
);

onMounted(loadBoard);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
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
        @open="openPreparation"
        @prepare="openPrepareTarget"
        @unprepare="openUnprepareTarget"
      />
    </div>

    <!-- Nothing selected -> hidden entirely (§6.3), not just empty. -->
    <ProjectPartsTable
      v-if="selectedProjectId"
      ref="partsTableRef"
      :project-id="selectedProjectId"
      class="min-h-0 flex-1"
    />

    <SubProductPreparationModal
      :target="preparationTarget"
      @close="closePreparation"
      @prepared="onSubProductPrepared"
    />

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

    <!-- Stopping releases the whole claim, and since preparation began that
         includes parts physically pulled into job boxes (§4.2, §11.13). The
         count is the warning: the shelf figure will not mention them. -->
    <DeleteConfirmModal
      :target="stopTarget"
      title-key="stop_project"
      :message-key="
        stopPickedPieces > 0
          ? 'confirmations.stop_project_msg_picked'
          : 'confirmations.stop_project_msg'
      "
      :message-params="{ n: stopPickedPieces }"
      confirm-text-key="stop_project"
      :label="(project) => project.name"
      :loading="stopBusy"
      @confirm="confirmStopProject"
      @cancel="cancelStopProject"
    />

    <!-- Both preparation actions are confirmed for the same reason Start is:
         each moves real stock. Marking takes the sub-product's parts out of
         what the project can still pick; undoing puts them back, which is
         equally worth a second look on a shared board. -->
    <DeleteConfirmModal
      :target="prepareTarget"
      title-key="mark_prepared"
      message-key="confirmations.mark_prepared_msg"
      confirm-text-key="mark_prepared"
      variant="primary"
      :label="subProductLabel"
      :loading="prepareBusy"
      @confirm="confirmPrepare"
      @cancel="cancelPrepare"
    />

    <DeleteConfirmModal
      :target="unprepareTarget"
      title-key="undo_prepared"
      message-key="confirmations.undo_prepared_msg"
      confirm-text-key="undo"
      variant="primary"
      :label="subProductLabel"
      :loading="unprepareBusy"
      @confirm="confirmUnprepare"
      @cancel="cancelUnprepare"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Plus, Search } from 'lucide-vue-next';
import ProjectBoard from './board/ProjectBoard.vue';
import SubProductPreparationModal from './board/SubProductPreparationModal.vue';
import type { SubProductTarget } from './board/columns.ts';
import ProjectModal from './ProjectModal.vue';
import ProjectPartsTable from './ProjectPartsTable.vue';
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
// keeps its shape (§6.3). The Parts table below is what this drives.

const selectedProjectId = ref<number | null>(null);
// So Edit and Start — both reachable from any card, not only the selected
// one (§6.3) — can invalidate that project's Parts table cache even when it
// isn't the one currently on screen.
const partsTableRef = ref<InstanceType<typeof ProjectPartsTable> | null>(null);

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
  // Read before the await: a successful save leaves `editing` as it was, but
  // there is no reason to rely on that continuing to be true.
  const editedProjectId = editing.value?.id ?? null;
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
    // PATCH replaces the whole product set, so a draft's parts change (§6.3).
    if (editedProjectId !== null) partsTableRef.value?.invalidateProject(editedProjectId);
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

function confirmedCardAction<T>(
  run: (target: T) => Promise<void>,
  successKey: string,
  errorKey: string,
) {
  return useConfirmDelete<T>(async (target) => {
    try {
      await run(target);
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
} = confirmedCardAction<ProjectBoardCard>(
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
} = confirmedCardAction<ProjectBoardCard>(
  async (project) => {
    await store.startProject(project.id);
    await loadBoard();
    // The rows go from computed (id: null) to frozen (id: number) (§6.3).
    partsTableRef.value?.invalidateProject(project.id);
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
} = confirmedCardAction<ProjectBoardCard>(
  async (project) => {
    await store.stopProject(project.id);
    await loadBoard();
  },
  'success.stop_project',
  'errors.stop_project_failed',
);

/** Pieces already pulled into this project's job boxes. Stopping hands them
 *  back to free stock along with the rest of its claim, and nothing else on
 *  the confirmation would say so. */
const stopPickedPieces = computed(() =>
  stopTarget.value
    ? stopTarget.value.subProducts.reduce((sum, sub) => sum + sub.pickedQty, 0)
    : 0,
);

// ---- Preparation ------------------------------------------------------------
//
// Marking a sub-product prepared and taking that mark back are the same flow
// as the three above, over a sub-product instead of a project. Both change
// `project_parts.prepared_qty`, which is what *Preparation* and *Prepared*
// membership is computed from (§4.1) — so both refetch rather than patch.

// The card opens its pick list; the Parts table below the board stays tied to
// the *Projects* column's selection, which is the only card that still takes a
// plain click.
const preparationTarget = ref<SubProductTarget | null>(null);

function openPreparation(target: SubProductTarget) {
  preparationTarget.value = target;
}

// Each tick is saved as it is made, so closing only has to refresh the counts
// the cards read off the board.
async function closePreparation(changed: boolean) {
  preparationTarget.value = null;
  if (changed) await loadBoard();
}

async function onSubProductPrepared() {
  const projectId = preparationTarget.value?.project.id ?? null;
  preparationTarget.value = null;
  notify.showToast(t('success.mark_prepared'), 'success');
  await loadBoard();
  if (projectId !== null) partsTableRef.value?.invalidateProject(projectId);
}

function subProductLabel({ product, subProduct }: SubProductTarget): string {
  return `${product.name} · ${subProduct.name} ${subProduct.revisionLabel}`;
}

function preparationAction(prepared: boolean) {
  return async ({ project, subProduct }: SubProductTarget) => {
    const ref = {
      projectProductId: subProduct.projectProductId,
      subProductRevisionId: subProduct.subProductRevisionId,
    };
    await (prepared
      ? store.prepareSubProduct(project.id, ref)
      : store.unprepareSubProduct(project.id, ref));
    await loadBoard();
    // The write moved `prepared_qty`, which the Parts table reads as its
    // "to pick" column — the same reason Start invalidates it.
    partsTableRef.value?.invalidateProject(project.id);
  };
}

const {
  target: prepareTarget,
  busy: prepareBusy,
  open: openPrepareTarget,
  confirm: confirmPrepare,
  cancel: cancelPrepare,
} = confirmedCardAction<SubProductTarget>(
  preparationAction(true),
  'success.mark_prepared',
  'errors.mark_prepared_failed',
);

const {
  target: unprepareTarget,
  busy: unprepareBusy,
  open: openUnprepareTarget,
  confirm: confirmUnprepare,
  cancel: cancelUnprepare,
} = confirmedCardAction<SubProductTarget>(
  preparationAction(false),
  'success.undo_prepared',
  'errors.undo_prepared_failed',
);

onMounted(loadBoard);
</script>

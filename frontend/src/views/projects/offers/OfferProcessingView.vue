<template>
  <div class="flex h-full min-h-0 gap-4">
    <OfferProjectList
      :projects="projects"
      :selected-id="selectedProjectId"
      :loading="loading"
      @select="select"
    />

    <!-- Nothing selected -> the grid is not rendered at all, as the Parts
         table is not on the Projects page (§6.3): an empty sheet with company
         columns on it would read as a project with no parts to buy. -->
    <OfferGrid
      v-if="selectedProjectId"
      :project-id="selectedProjectId"
      @card="onCard"
    />
    <div v-else class="card grid flex-1 place-items-center text-sm text-slate-400">
      {{ t('select_offer_project_msg') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import OfferProjectList from './OfferProjectList.vue';
import OfferGrid from './OfferGrid.vue';
import { projectOffersApi } from '../../../api/projectOffersAPI.ts';
import { useNotificationStore } from '../../../stores/notificationStore.ts';
import { translateApiError } from '../../../utils/apiError.ts';
import type { ProjectBoardCard } from '../../../types/projects.ts';
import type { OfferQueueProject } from '../../../types/projectOffers.ts';

/**
 * Offer Processing (plan §6.5): the queue on the left, the price grid on the
 * right.
 *
 * The queue is held here rather than in a store. It has one reader and one
 * writer — this view and the grid below it — and `projectsStore` is not it:
 * that store holds the *board*, which this page never loads, and putting a
 * second list beside it would mean two caches of project state that no write
 * updates together. Should a third screen ever need the queue, this is the
 * moment to move it into `projectOffersStore`.
 */
const { t, te } = useI18n();
const notify = useNotificationStore();

const projects = ref<OfferQueueProject[]>([]);
const loading = ref(false);
const selectedProjectId = ref<number | null>(null);

function select(id: number) {
  selectedProjectId.value = selectedProjectId.value === id ? null : id;
}

async function loadQueue() {
  loading.value = true;
  try {
    const { data } = await projectOffersApi.getQueue();
    projects.value = data;
    // The newest project by default — the queue is `created_at DESC`, so it is
    // the first entry, and opening the page on an empty pane when there is
    // obvious work to show helps nobody. The same check clears a selection the
    // queue no longer holds, which would otherwise leave the grid on a project
    // the list cannot highlight.
    if (!data.some((project) => project.id === selectedProjectId.value)) {
      selectedProjectId.value = data[0]?.id ?? null;
    }
  } catch (err) {
    notify.showToast(translateApiError(err, { t, te }, 'errors.load_projects_failed'), 'error');
  } finally {
    loading.value = false;
  }
}

/**
 * A quantity edit in the grid answers with the board card it may have moved
 * (§4.1), and the line counts on it are what the list shows. `inOffers` is the
 * server's call about whether the project still belongs in this queue, so a
 * project whose last line has nothing left to buy leaves the list — the same
 * rule that put it there, applied where it was computed.
 */
function onCard(card: ProjectBoardCard) {
  if (!card.inOffers) {
    projects.value = projects.value.filter((project) => project.id !== card.id);
    if (selectedProjectId.value === card.id) selectedProjectId.value = null;
    return;
  }
  projects.value = projects.value.map((project) =>
    project.id === card.id
      ? { ...project, toBuyLines: card.toBuyLines, onOrderLines: card.onOrderLines }
      : project,
  );
}

onMounted(loadQueue);
</script>

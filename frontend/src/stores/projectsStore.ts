import { defineStore } from 'pinia';
import { ref } from 'vue';
import { projectsApi } from '../api/projectsAPI.ts';
import { i18n } from '../i18n';
import type {
  Project,
  ProjectBoardCard,
  ProjectBoardQuery,
  ProjectPartPick,
  ProjectPayload,
  ProjectStatus,
  ProjectSubProductRef,
  SubProductPicksResult,
} from '../types/projects.ts';

export const useProjectsStore = defineStore('projects', () => {
  const board = ref<ProjectBoardCard[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** The status filter the board was last loaded with, so a write that moves a
   *  project out of it removes the card instead of leaving a stale one behind
   *  — the one thing a refetch used to do for free. */
  let loadedStatuses: ProjectStatus[] = [];

  // The board refetches on every filter change, including each debounced
  // keystroke of the name search, so a slow early response must not land on
  // top of a newer one and show a board the filters no longer describe.
  let latestRequest = 0;

  async function fetchBoard(query: ProjectBoardQuery) {
    const request = ++latestRequest;
    loading.value = true;
    error.value = null;
    try {
      const response = await projectsApi.getBoard(query);
      if (request !== latestRequest) return;
      board.value = response.data;
      loadedStatuses = query.status;
    } catch (err) {
      if (request === latestRequest) error.value = i18n.global.t('errors.load_projects_failed');
      throw err;
    } finally {
      if (request === latestRequest) loading.value = false;
    }
  }

  /** The board card carries no products, so editing loads the full project. */
  async function fetchProject(id: number) {
    const response = await projectsApi.getById(id);
    return response.data;
  }

  /**
   * Put a card the server has just recomputed into the board.
   *
   * Every write that can move a project between columns answers with its card,
   * so this is what replaces refetching the whole board after each one. The
   * card is still the SERVER's answer — `inOffers`, `inPreparation` and the
   * rest were derived there, from the same code `GET /api/projects` uses — so
   * decision 2 holds: the browser is placing a card, not deciding which column
   * it belongs in.
   *
   * A card whose status has left the filter on screen is removed rather than
   * updated, which is what Stop does to a board showing only draft + started.
   * A card the board does not have yet goes to the front, matching the
   * `created_at DESC` order the list is read in — the only way a card is new
   * is that it was just created.
   */
  function upsertCard(card: ProjectBoardCard) {
    if (loadedStatuses.length > 0 && !loadedStatuses.includes(card.status)) {
      board.value = board.value.filter((p) => p.id !== card.id);
      return;
    }
    const index = board.value.findIndex((p) => p.id === card.id);
    board.value =
      index === -1
        ? [card, ...board.value]
        : board.value.map((p) => (p.id === card.id ? card : p));
  }

  async function createProject(payload: ProjectPayload): Promise<Project> {
    const { data } = await projectsApi.create(payload);
    upsertCard(data.card);
    return data.project;
  }

  async function updateProject(id: number, payload: ProjectPayload): Promise<Project> {
    const { data } = await projectsApi.update(id, payload);
    upsertCard(data.card);
    return data.project;
  }

  async function deleteProject(id: number) {
    await projectsApi.remove(id);
    board.value = board.value.filter((p) => p.id !== id);
  }

  async function startProject(id: number): Promise<Project> {
    const { data } = await projectsApi.start(id);
    upsertCard(data.card);
    return data.project;
  }

  async function stopProject(id: number): Promise<Project> {
    const { data } = await projectsApi.stop(id);
    upsertCard(data.card);
    return data.project;
  }

  // Preparing a sub-product changes which of *Preparation* and *Prepared* the
  // project belongs to, and the counts on the cards in both — all of which the
  // returned card already carries.
  async function prepareSubProduct(id: number, ref: ProjectSubProductRef) {
    const { data } = await projectsApi.prepareSubProduct(id, ref);
    upsertCard(data.card);
  }

  async function unprepareSubProduct(id: number, ref: ProjectSubProductRef) {
    const { data } = await projectsApi.unprepareSubProduct(id, ref);
    upsertCard(data.card);
  }

  /** Save a sub-product's pick list — any number of lines in one request — and
   *  hand the caller back the list as it now stands. */
  async function saveSubProductPicks(
    id: number,
    ref: ProjectSubProductRef,
    picks: ProjectPartPick[],
  ): Promise<SubProductPicksResult> {
    const { data } = await projectsApi.setSubProductPicks(id, ref, picks);
    upsertCard(data.card);
    return data;
  }

  return {
    board,
    loading,
    error,
    fetchBoard,
    fetchProject,
    createProject,
    updateProject,
    deleteProject,
    startProject,
    stopProject,
    upsertCard,
    prepareSubProduct,
    unprepareSubProduct,
    saveSubProductPicks,
  };
});

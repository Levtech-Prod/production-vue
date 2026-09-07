import { defineStore } from 'pinia';
import { ref } from 'vue';
import { projectsApi } from '../api/projectsAPI.ts';
import { i18n } from '../i18n';
import type { Project, ProjectBoardCard, ProjectBoardQuery, ProjectPayload } from '../types/projects.ts';

export const useProjectsStore = defineStore('projects', () => {
  const board = ref<ProjectBoardCard[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

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

  async function createProject(payload: ProjectPayload): Promise<Project> {
    const response = await projectsApi.create(payload);
    return response.data;
  }

  async function updateProject(id: number, payload: ProjectPayload): Promise<Project> {
    const response = await projectsApi.update(id, payload);
    return response.data;
  }

  async function deleteProject(id: number) {
    await projectsApi.remove(id);
    board.value = board.value.filter((p) => p.id !== id);
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
  };
});

import { api } from './client.ts';
import type {
  Project,
  ProjectBoardCard,
  ProjectBoardQuery,
  ProjectPayload,
} from '../types/projects.ts';

export const projectsApi = {
  /** Board payload (plan §4.1): one row per project with its line counts and
   *  column membership. `status` is comma-joined — the API accepts that as
   *  well as a repeated parameter, and one value keeps the shareable link
   *  short. */
  getBoard(query: ProjectBoardQuery) {
    return api.get<ProjectBoardCard[]>('/projects', {
      params: { status: query.status.join(','), q: query.q || undefined },
    });
  },
  getById(id: number) {
    return api.get<Project>(`/projects/${id}`);
  },
  create(payload: ProjectPayload) {
    return api.post<Project>('/projects', payload);
  },
  /** Replaces the fields *and* the whole product set; drafts only. */
  update(id: number, payload: ProjectPayload) {
    return api.patch<Project>(`/projects/${id}`, payload);
  },
  remove(id: number) {
    return api.delete<{ id: number; deleted: boolean }>(`/projects/${id}`);
  },
};

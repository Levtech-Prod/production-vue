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
   *  short. The endpoint's `?q=` is deliberately unused: a board is tens of
   *  rows, so the name search filters them in the browser instead. */
  getBoard(query: ProjectBoardQuery) {
    return api.get<ProjectBoardCard[]>('/projects', {
      params: { status: query.status.join(',') },
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
  /** Freezes the flattened BOM and claims stock for it (plan §5.3). Drafts
   *  only, and there is no way back: a started project is neither editable
   *  nor deletable. */
  start(id: number) {
    return api.post<Project>(`/projects/${id}/start`);
  },
  /** Releases the project's stock claims by dropping it out of the §4.2
   *  aggregate — there is no reservation row to clean up. Parts already on
   *  order are left alone and still arrive (§8.4). */
  stop(id: number) {
    return api.post<Project>(`/projects/${id}/stop`);
  },
};

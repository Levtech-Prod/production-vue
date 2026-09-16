import { api } from './client.ts';
import type {
  Project,
  ProjectBoardCard,
  ProjectBoardQuery,
  ProjectPartsPayload,
  ProjectPartsRecalculateResult,
  ProjectPartUpdate,
  ProjectPartRow,
  ProjectPayload,
  ProjectPartPickState,
  ProjectSubProductPart,
  ProjectSubProductRef,
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
  /** The Parts table (plan §5.4) — computed live for a draft, read back
   *  frozen for a started project. One payload shape either way. */
  getParts(id: number) {
    return api.get<ProjectPartsPayload>(`/projects/${id}/parts`);
  },
  /** Started projects only; returns the row as the table should now show it. */
  updatePart(id: number, projectPartId: number, payload: ProjectPartUpdate) {
    return api.patch<ProjectPartRow>(`/projects/${id}/parts/${projectPartId}`, payload);
  },
  /** Re-seeds every non-overridden row from today's free stock (plan §5.3). */
  recalculateParts(id: number) {
    return api.post<ProjectPartsRecalculateResult>(`/projects/${id}/parts/recalculate`);
  },
  /** One sub-product's pick list: what each line needs, how much is already in
   *  the job box, and the most it could be filled to right now. */
  getSubProductParts(id: number, ref: ProjectSubProductRef) {
    return api.get<ProjectSubProductPart[]>(
      `/projects/${id}/preparations/${ref.projectProductId}/${ref.subProductRevisionId}/parts`,
    );
  },
  /** Sets how much of one line is in the job box — the write that moves the
   *  part's prepared quantity. Refused above what the line needs, or above
   *  what the project holds. */
  setPartPickedQty(id: number, usageId: number, pickedQty: number) {
    return api.patch<ProjectPartPickState>(
      `/projects/${id}/preparations/usages/${usageId}`,
      { pickedQty },
    );
  },
  /** Marks one sub-product prepared: its parts leave the project's pickable
   *  stock, and its *Preparation* card is replaced by a share of its product's
   *  percentage on the *Prepared* card. Refused unless every part is in hand. */
  prepareSubProduct(id: number, ref: ProjectSubProductRef) {
    return api.post<ProjectSubProductRef & { prepared: boolean }>(
      `/projects/${id}/preparations`,
      ref,
    );
  },
  /** Takes that mark back, returning the parts to the project's pickable
   *  stock. The pair identifies the row — it has no id of its own here. */
  unprepareSubProduct(id: number, ref: ProjectSubProductRef) {
    return api.delete<ProjectSubProductRef & { prepared: boolean }>(
      `/projects/${id}/preparations/${ref.projectProductId}/${ref.subProductRevisionId}`,
    );
  },
};

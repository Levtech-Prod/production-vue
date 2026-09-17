import { api } from './client.ts';
import type {
  Project,
  ProjectBoardCard,
  ProjectBoardQuery,
  ProjectPartPick,
  ProjectPartsPayload,
  ProjectPartsRecalculateResult,
  ProjectPartUpdate,
  ProjectPartUpdateResult,
  ProjectPayload,
  ProjectSubProductPart,
  ProjectSubProductRef,
  ProjectWriteResult,
  SubProductPicksResult,
  SubProductPreparationResult,
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
    return api.post<ProjectWriteResult>('/projects', payload);
  },
  /** Replaces the fields *and* the whole product set; drafts only. */
  update(id: number, payload: ProjectPayload) {
    return api.patch<ProjectWriteResult>(`/projects/${id}`, payload);
  },
  remove(id: number) {
    return api.delete<{ id: number; deleted: boolean }>(`/projects/${id}`);
  },
  /** Freezes the flattened BOM and claims stock for it (plan §5.3). Drafts
   *  only, and there is no way back: a started project is neither editable
   *  nor deletable. */
  start(id: number) {
    return api.post<ProjectWriteResult>(`/projects/${id}/start`);
  },
  /** Releases the project's stock claims by dropping it out of the §4.2
   *  aggregate — there is no reservation row to clean up. Parts already on
   *  order are left alone and still arrive (§8.4). */
  stop(id: number) {
    return api.post<ProjectWriteResult>(`/projects/${id}/stop`);
  },
  /** The Parts table (plan §5.4) — computed live for a draft, read back
   *  frozen for a started project. One payload shape either way. */
  getParts(id: number) {
    return api.get<ProjectPartsPayload>(`/projects/${id}/parts`);
  },
  /**
   * Sets what to buy of one part. Drafts and started projects both — a draft
   * stores it against the part until Start freezes it (plan §12), a started
   * project writes `project_parts.missing_qty` directly; one number either
   * way, which is why `partId` is `parts.id` rather than `project_parts.id`
   * (a draft has no project part to name).
   *
   * Answers with the row as the table should now show it, and the board card
   * the change may have moved — so neither has to be read back.
   */
  updatePartQuantity(id: number, partId: number, payload: ProjectPartUpdate) {
    return api.patch<ProjectPartUpdateResult>(
      `/projects/${id}/parts/${partId}/quantity`,
      payload,
    );
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
  /**
   * Sets how much of each named pick-list line is in the job box — the write
   * that moves the part's prepared quantity. Refused above what a line needs,
   * or above what the project holds.
   *
   * A batch, and one request for however many lines: ticking a list is
   * normally an all-at-once action, and sending it line by line cost a
   * transaction and a project-wide lock per checkbox. The answer is the whole
   * list, because two lines sharing a part move each other's headroom.
   */
  setSubProductPicks(id: number, ref: ProjectSubProductRef, picks: ProjectPartPick[]) {
    return api.patch<SubProductPicksResult>(
      `/projects/${id}/preparations/${ref.projectProductId}/${ref.subProductRevisionId}/picks`,
      { picks },
    );
  },
  /** Marks one sub-product prepared: its parts leave the project's pickable
   *  stock, and its *Preparation* card is replaced by a share of its product's
   *  percentage on the *Prepared* card. Refused unless every part is in hand. */
  prepareSubProduct(id: number, ref: ProjectSubProductRef) {
    return api.post<SubProductPreparationResult>(`/projects/${id}/preparations`, ref);
  },
  /** Takes that mark back, returning the parts to the project's pickable
   *  stock. The pair identifies the row — it has no id of its own here. */
  unprepareSubProduct(id: number, ref: ProjectSubProductRef) {
    return api.delete<SubProductPreparationResult>(
      `/projects/${id}/preparations/${ref.projectProductId}/${ref.subProductRevisionId}`,
    );
  },
};

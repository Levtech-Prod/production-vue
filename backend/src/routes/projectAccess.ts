// Taking hold of a project, and the guard that goes with it — shared by every
// route that writes inside one (`projects.ts`, `projectOffers.ts`). It lives
// beside `routeParams.ts` for the same reason that does: both are the small
// piece of a route that every route in the module has to get identically
// right, and a second copy of this one would be a second answer to "may this
// project still be written to".
import type { PoolClient } from 'pg';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import type { ProjectStatus } from '../schemas/projects.schema.js';

export interface LockedProject {
  name: string;
  description: string | null;
  deadline: string | null;
  status: ProjectStatus;
}

/**
 * Lock the project row and read what any transition or edit needs of it, or
 * 404. Taking the lock as the status is read is the point: without it a Start
 * and a PATCH can both pass their own draft check and then both write.
 *
 * One column list for every caller rather than a tailored SELECT each — on a
 * single row by primary key the extra columns cost nothing, and one shape is
 * one thing to keep true.
 *
 * `mode` decides how much of the project the caller is claiming.
 *
 * `exclusive` (`FOR UPDATE`) is for anything that writes the `projects` row
 * itself — Start, Stop, the draft PATCH, Delete — and for the one parts write
 * that touches EVERY row at once, `POST /:id/parts/recalculate`. It is the
 * project's big lock, and holding it is what lets `reseedFromStock` take
 * `FOR UPDATE` over all of `project_parts` in whatever order the scan returns
 * them: nothing else can be holding any of those rows.
 *
 * `shared` (`FOR SHARE`) is for a write that touches NAMED rows: one Parts
 * table cell, one sub-product's pick list, one edited offer column. Those only
 * need the status to hold still while they work. Shared locks do not block
 * each other, so two people editing different rows of one project — or ticking
 * different pick lists — no longer queue behind each other, while either still
 * blocks, and is blocked by, a Stop or a recalculate. What they contend for is
 * locked where it is: the PATCH takes one `project_parts` row,
 * `applySubProductPicks` takes a sub-product's rows in `pp.id` order, the same
 * order `markSubProductPrepared` takes them in, and the offer cells are keyed
 * by a unique index, so no two of them can deadlock.
 */
export async function lockProject(
  client: PoolClient,
  projectId: number,
  mode: 'exclusive' | 'shared' = 'exclusive',
): Promise<LockedProject> {
  const result = await client.query<LockedProject>(
    `SELECT name, description, to_char(deadline, 'YYYY-MM-DD') AS deadline, status
     FROM projects WHERE id = $1 ${mode === 'shared' ? 'FOR SHARE' : 'FOR UPDATE'}`,
    [projectId],
  );
  const project = result.rows[0];
  if (!project) throw new ApiError(404, ErrorCodes.PROJECT_NOT_FOUND);
  return project;
}

/** The lock a write against NAMED rows of a frozen BOM takes, with the guard
 *  that goes with it — the two were already always used together. */
export async function lockProjectForPartsWrite(
  client: PoolClient,
  projectId: number,
): Promise<LockedProject> {
  const project = await lockProject(client, projectId, 'shared');
  requireStartedForPartsWrite(project.status);
  return project;
}

/**
 * Guard for every write that acts on `project_parts` or on what hangs off it —
 * the Parts-table PATCH, recalculate, and the offer grid's columns and cells.
 * None of it exists until Start has frozen the BOM. A draft's rows
 * genuinely don't exist yet, so PROJECT_PARTS_NOT_FROZEN is literally true;
 * a stopped or completed project's rows exist but are a closed record, which
 * PROJECT_NOT_STARTED already means — the same code the Stop route itself
 * uses for "not currently started" — rather than reusing the "not generated"
 * wording for a project whose parts list plainly was generated.
 */
export function requireStartedForPartsWrite(status: ProjectStatus): void {
  if (status === 'draft') throw new ApiError(409, ErrorCodes.PROJECT_PARTS_NOT_FROZEN);
  if (status !== 'started') throw new ApiError(409, ErrorCodes.PROJECT_NOT_STARTED);
}

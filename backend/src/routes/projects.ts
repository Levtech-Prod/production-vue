// Projects — CRUD only (projects-preparation-plan.md §5.2). Start/Stop, the
// Parts table and the offer/order endpoints are separate stories; this file
// owns just `projects` and the product set pinned to it (`project_products`).
import { Router } from 'express';
import type { PoolClient } from 'pg';
import { query, pool, type Queryable } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import { parseId } from './routeParams.js';
import {
  projectPayloadSchema,
  projectListQuerySchema,
  type ProjectProductInput,
} from '../schemas/projects.schema.js';
import {
  logAudit,
  resolveActor,
  diffFields,
  diffKeyedEvents,
  type KeyedValue,
} from '../services/audit.js';

const router = Router();

interface ProductRevisionInfo {
  productId: number;
  productName: string;
  revisionLabel: string;
}

/** Resolve each revision id to the product it actually belongs to (plus the
 *  names an audit event needs), in one round trip. */
async function fetchRevisionInfo(
  db: Queryable,
  revisionIds: number[],
): Promise<Map<number, ProductRevisionInfo>> {
  if (revisionIds.length === 0) return new Map();
  const result = await db.query<{
    id: number;
    productId: number;
    productName: string;
    revisionLabel: string;
  }>(
    `SELECT pr.id, pr.product_id AS "productId", p.name AS "productName",
       pr.label AS "revisionLabel"
     FROM product_revisions pr
     JOIN products p ON p.id = pr.product_id
     WHERE pr.id = ANY($1::int[])`,
    [revisionIds],
  );
  return new Map(
    result.rows.map((r) => [
      r.id,
      { productId: r.productId, productName: r.productName, revisionLabel: r.revisionLabel },
    ]),
  );
}

/** True when every product line's revision actually belongs to the product it
 *  claims — the friendly check in front of the composite FK (§3.2) that would
 *  otherwise surface as a raw constraint violation. Also catches a revision
 *  id that doesn't exist at all (absent from the map). */
function revisionsMatchProducts(
  products: ProjectProductInput[],
  infoByRevisionId: Map<number, ProductRevisionInfo>,
): boolean {
  return products.every(
    (p) => infoByRevisionId.get(p.productRevisionId)?.productId === p.productId,
  );
}

/** True when the same revision was pinned twice in one payload. Left
 *  unchecked, this hits `project_products`' UNIQUE (project_id,
 *  product_revision_id) constraint and surfaces as a raw 500 instead of a
 *  clean 4xx — a plausible slip from a picker that lets the same product be
 *  added twice (pinning the same product at two different revisions is
 *  fine and stays allowed; only the same revision twice is a duplicate). */
function hasDuplicateRevisions(products: ProjectProductInput[]): boolean {
  const seen = new Set<number>();
  for (const p of products) {
    if (seen.has(p.productRevisionId)) return true;
    seen.add(p.productRevisionId);
  }
  return false;
}

/** Bulk-insert the pinned product set in one round trip, position taken from
 *  array order. */
async function insertProjectProducts(
  client: PoolClient,
  projectId: number,
  products: ProjectProductInput[],
): Promise<void> {
  if (products.length === 0) return;
  await client.query(
    `INSERT INTO project_products (project_id, product_id, product_revision_id, quantity, position)
     SELECT $1, product_id, product_revision_id, quantity, ord - 1
     FROM unnest($2::int[], $3::int[], $4::int[]) WITH ORDINALITY
       AS t(product_id, product_revision_id, quantity, ord)`,
    [
      projectId,
      products.map((p) => p.productId),
      products.map((p) => p.productRevisionId),
      products.map((p) => p.quantity),
    ],
  );
}

interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  deadline: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
}

interface ProjectProductRow {
  id: number;
  productId: number;
  name: string;
  sku: string;
  productRevisionId: number;
  revisionLabel: string;
  quantity: number;
  position: number;
}

/** Project + its pinned products (§5.2 `GET /:id`) — also the create/update
 *  response, so all three endpoints agree on one shape. */
async function loadProject(
  db: Queryable,
  projectId: number,
): Promise<(ProjectRow & { products: ProjectProductRow[] }) | null> {
  const projectResult = await db.query<ProjectRow>(
    `SELECT id, name, description, to_char(deadline, 'YYYY-MM-DD') AS deadline, status,
       created_at AS "createdAt", updated_at AS "updatedAt",
       started_at AS "startedAt", stopped_at AS "stoppedAt"
     FROM projects WHERE id = $1`,
    [projectId],
  );
  const project = projectResult.rows[0];
  if (!project) return null;

  const productsResult = await db.query<ProjectProductRow>(
    `SELECT pp.id, pp.product_id AS "productId", p.name, p.sku,
       pp.product_revision_id AS "productRevisionId", pr.label AS "revisionLabel",
       pp.quantity, pp.position
     FROM project_products pp
     JOIN products p ON p.id = pp.product_id
     JOIN product_revisions pr ON pr.id = pp.product_revision_id
     WHERE pp.project_id = $1
     ORDER BY pp.position, pp.id`,
    [projectId],
  );

  return { ...project, products: productsResult.rows };
}

/** Keyed by revision id — the same product pinned to a different revision
 *  reads as remove-old/add-new, which is what actually happened to the
 *  pinned set. */
function productsToKeyed(
  products: { productRevisionId: number; name: string; revisionLabel: string; quantity: number }[],
): KeyedValue[] {
  return products.map((p) => ({
    key: p.productRevisionId,
    label: `${p.name} (${p.revisionLabel})`,
    value: String(p.quantity),
  }));
}

// GET /api/projects — board payload (§4.1): per-project part-line counts,
// with column membership derived here (not in SQL) so the rule stays in one
// readable place. `?status=` is repeatable (defaults to draft+started, see
// §6.3); `?q=` searches the name.
router.get('/', requireAuth, async (req, res) => {
  const data = projectListQuerySchema.parse(req.query);

  const result = await query<{
    id: number;
    name: string;
    description: string | null;
    deadline: string | null;
    status: string;
    createdAt: string;
    productCount: number;
    lineCount: number;
    toBuyLines: number;
    onOrderLines: number;
    toPickLines: number;
  }>(
    `SELECT
       p.id,
       p.name,
       p.description,
       to_char(p.deadline, 'YYYY-MM-DD') AS deadline,
       p.status,
       p.created_at AS "createdAt",
       (SELECT COUNT(*) FROM project_products WHERE project_id = p.id)::int AS "productCount",
       COUNT(pp.id)::int AS "lineCount",
       COUNT(*) FILTER (WHERE pp.missing_qty  > pp.ordered_qty)::int  AS "toBuyLines",
       COUNT(*) FILTER (WHERE pp.ordered_qty  > pp.received_qty)::int AS "onOrderLines",
       COUNT(*) FILTER (WHERE pp.from_stock_qty + pp.received_qty
                            > pp.prepared_qty)::int                  AS "toPickLines"
     FROM projects p
     LEFT JOIN project_parts pp ON pp.project_id = p.id
     WHERE p.status = ANY($1::text[])
       AND ($2::text IS NULL OR p.name ILIKE '%' || $2 || '%')
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [data.status, data.q ?? null],
  );

  // Column membership (§4.1): the middle three columns are ANY ("some parts
  // still need buying"), *Prepared* is ALL ("nothing outstanding any more").
  const projects = result.rows.map((row) => {
    const { toBuyLines, onOrderLines, toPickLines, lineCount } = row;
    return {
      ...row,
      inOffers: toBuyLines > 0,
      inOrdered: onOrderLines > 0,
      inPreparation: toPickLines > 0,
      inPrepared: lineCount > 0 && toBuyLines + onOrderLines + toPickLines === 0,
    };
  });

  res.json(projects);
});

// POST /api/projects — create as `draft` with its pinned products.
router.post('/', requireAuth, async (req, res) => {
  const data = projectPayloadSchema.parse(req.body);
  if (data.products.length === 0) {
    return res.status(422).json({ code: ErrorCodes.PROJECT_HAS_NO_PRODUCTS });
  }
  if (hasDuplicateRevisions(data.products)) {
    return res.status(422).json({ code: ErrorCodes.PRODUCT_REVISION_DUPLICATE });
  }

  const revisionInfo = await fetchRevisionInfo(
    pool,
    data.products.map((p) => p.productRevisionId),
  );
  if (!revisionsMatchProducts(data.products, revisionInfo)) {
    return res.status(422).json({ code: ErrorCodes.PRODUCT_REVISION_MISMATCH });
  }

  const userId = req.user?.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const projectResult = await client.query<{ id: number }>(
      `INSERT INTO projects (name, description, deadline, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [data.name, data.description || null, data.deadline || null, userId ?? null],
    );
    const projectId = projectResult.rows[0].id;

    await insertProjectProducts(client, projectId, data.products);

    const actor = await resolveActor(client, userId);
    await logAudit(
      client,
      'project',
      projectId,
      'created',
      { snapshot: { name: data.name, productCount: data.products.length } },
      actor,
    );

    const project = await loadProject(client, projectId);
    await client.query('COMMIT');
    res.json(project);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/projects/:id — project + its pinned products.
router.get('/:id', requireAuth, async (req, res) => {
  const projectId = parseId(req.params.id);
  if (!projectId) return res.status(400).json({ code: ErrorCodes.INVALID_PROJECT_ID });

  const project = await loadProject(pool, projectId);
  if (!project) return res.status(404).json({ code: ErrorCodes.PROJECT_NOT_FOUND });
  res.json(project);
});

// PATCH /api/projects/:id — replace fields and the whole product set.
// Draft only: 409 PROJECT_NOT_EDITABLE otherwise.
router.patch('/:id', requireAuth, async (req, res) => {
  const projectId = parseId(req.params.id);
  if (!projectId) return res.status(400).json({ code: ErrorCodes.INVALID_PROJECT_ID });

  const data = projectPayloadSchema.parse(req.body);
  if (data.products.length === 0) {
    return res.status(422).json({ code: ErrorCodes.PROJECT_HAS_NO_PRODUCTS });
  }
  if (hasDuplicateRevisions(data.products)) {
    return res.status(422).json({ code: ErrorCodes.PRODUCT_REVISION_DUPLICATE });
  }

  const revisionInfo = await fetchRevisionInfo(
    pool,
    data.products.map((p) => p.productRevisionId),
  );
  if (!revisionsMatchProducts(data.products, revisionInfo)) {
    return res.status(422).json({ code: ErrorCodes.PRODUCT_REVISION_MISMATCH });
  }

  const userId = req.user?.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row before checking status: a concurrent start must not race
    // this edit into a project that is no longer a draft.
    const existing = await client.query<{
      name: string;
      description: string | null;
      deadline: string | null;
      status: string;
    }>(
      `SELECT name, description, to_char(deadline, 'YYYY-MM-DD') AS deadline, status
       FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );
    const before = existing.rows[0];
    if (!before) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PROJECT_NOT_FOUND });
    }
    if (before.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: ErrorCodes.PROJECT_NOT_EDITABLE });
    }

    // Snapshot the current product set (with names) before replacing it, so
    // the audit log can diff old vs new the same way BOM-line edits do.
    const oldProducts = await client.query<{
      productRevisionId: number;
      name: string;
      revisionLabel: string;
      quantity: number;
    }>(
      `SELECT pp.product_revision_id AS "productRevisionId", p.name,
         pr.label AS "revisionLabel", pp.quantity
       FROM project_products pp
       JOIN products p ON p.id = pp.product_id
       JOIN product_revisions pr ON pr.id = pp.product_revision_id
       WHERE pp.project_id = $1`,
      [projectId],
    );

    // RETURNING the written row (not the raw payload) so the audit diff below
    // reflects what's actually in the database — `data.description || null`
    // can turn an incoming '' into a stored NULL, and the diff must agree.
    const updated = await client.query<{
      name: string;
      description: string | null;
      deadline: string | null;
    }>(
      `UPDATE projects SET name = $1, description = $2, deadline = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING name, description, to_char(deadline, 'YYYY-MM-DD') AS deadline`,
      [data.name, data.description || null, data.deadline || null, projectId],
    );
    const after = updated.rows[0];
    await client.query(`DELETE FROM project_products WHERE project_id = $1`, [projectId]);
    await insertProjectProducts(client, projectId, data.products);

    const fields = diffFields(
      { name: before.name, description: before.description, deadline: before.deadline },
      after,
      ['name', 'description', 'deadline'],
    );

    const newKeyed = productsToKeyed(
      data.products.map((p) => ({
        productRevisionId: p.productRevisionId,
        name: revisionInfo.get(p.productRevisionId)!.productName,
        revisionLabel: revisionInfo.get(p.productRevisionId)!.revisionLabel,
        quantity: p.quantity,
      })),
    );
    const events = diffKeyedEvents(productsToKeyed(oldProducts.rows), newKeyed, 'product');

    const changes: Record<string, unknown> = {};
    if (Object.keys(fields).length > 0) changes.fields = fields;
    if (events.length > 0) changes.events = events;
    if (Object.keys(changes).length > 0) {
      const actor = await resolveActor(client, userId);
      await logAudit(client, 'project', projectId, 'updated', changes, actor);
    }

    const project = await loadProject(client, projectId);
    await client.query('COMMIT');
    res.json(project);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /api/projects/:id — draft only: 409 PROJECT_NOT_EDITABLE otherwise.
// Cascades (see migration 023) remove its products; nothing else can
// reference a draft project since the BOM only freezes at Start.
router.delete('/:id', requireAuth, async (req, res) => {
  const projectId = parseId(req.params.id);
  if (!projectId) return res.status(400).json({ code: ErrorCodes.INVALID_PROJECT_ID });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ name: string; status: string }>(
      `SELECT name, status FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );
    const project = existing.rows[0];
    if (!project) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PROJECT_NOT_FOUND });
    }
    if (project.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: ErrorCodes.PROJECT_NOT_EDITABLE });
    }

    await client.query(`DELETE FROM projects WHERE id = $1`, [projectId]);

    const actor = await resolveActor(client, req.user?.id);
    await logAudit(
      client,
      'project',
      projectId,
      'deleted',
      { snapshot: { name: project.name } },
      actor,
    );

    await client.query('COMMIT');
    res.json({ id: projectId, deleted: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;

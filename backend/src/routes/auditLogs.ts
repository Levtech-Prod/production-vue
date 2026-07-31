import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { auditLogQuerySchema } from '../schemas/audit.schema.js';

const router = Router();

// GET /api/audit-logs?entityType=part&entityId=:id
// Change history for one entity, newest-first. Reused across every audited
// entity — the frontend passes a different entityType.
router.get('/', requireAuth, async (req, res) => {
  const { entityType, entityId } = auditLogQuerySchema.parse(req.query);

  const result = await query(
    `SELECT
       al.id,
       al.entity_type AS "entityType",
       al.entity_id   AS "entityId",
       al.action,
       al.changes,
       al.created_at  AS "createdAt",
       -- Prefer the live username; fall back to the snapshot if the user was deleted.
       COALESCE(u.username, al.actor_name) AS "actorName"
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_id
     WHERE al.entity_type = $1 AND al.entity_id = $2
     ORDER BY al.created_at DESC, al.id DESC`,
    [entityType, entityId],
  );

  res.json(result.rows);
});

export default router;

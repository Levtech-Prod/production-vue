-- Generic, append-only audit log for tracking changes to domain entities.
--
-- One row per create / update / delete. `entity_type` + `entity_id` identify
-- the affected record; there is intentionally NO foreign key on entity_id so a
-- log row survives a hard-delete of the entity it describes.
--
-- `changes` holds a JSONB payload whose shape depends on `action`:
--   created  -> { "snapshot": { field: value, ... } }
--   updated  -> { "fields": { field: { "from": .., "to": .. }, ... },
--                 "parameters": { "added": [...], "removed": [...], "changed": [...] } }
--   deleted  -> { "snapshot": { field: value, ... } }
--
-- The actor is stored both as a FK (nullable, SET NULL on user delete) and as a
-- denormalized `actor_name` snapshot so the log still renders after a user is
-- removed.

CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  entity_type VARCHAR(40)  NOT NULL,
  entity_id   INTEGER      NOT NULL,
  action      VARCHAR(10)  NOT NULL,
  changes     JSONB        NOT NULL DEFAULT '{}',
  actor_id    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(120),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_audit_action CHECK (action IN ('created', 'updated', 'deleted'))
);

-- Primary access pattern: newest-first history for one entity.
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id, created_at DESC);

-- Performance indexes for common list / filter / group-by / activity paths.
-- FK columns are not auto-indexed by Postgres, so we add them explicitly.
-- Index names follow Prisma's `<table>_<column>_idx` convention so the schema
-- state stays in sync with future `prisma migrate` runs.
--
-- NOTE: on a very large production table you may prefer to create these with
-- CREATE INDEX CONCURRENTLY (run manually, outside a migration transaction) to
-- avoid write locks. The IF NOT EXISTS guards make this migration idempotent
-- and safe to run even if you create some indexes by hand first.

CREATE INDEX IF NOT EXISTS "assets_type_id_idx" ON "assets" ("type_id");
CREATE INDEX IF NOT EXISTS "assets_status_idx" ON "assets" ("status");
CREATE INDEX IF NOT EXISTS "assets_assigned_to_id_idx" ON "assets" ("assigned_to_id");

CREATE INDEX IF NOT EXISTS "asset_actions_performed_by_idx" ON "asset_actions" ("performed_by");
CREATE INDEX IF NOT EXISTS "asset_actions_from_user_id_idx" ON "asset_actions" ("from_user_id");
CREATE INDEX IF NOT EXISTS "asset_actions_to_user_id_idx" ON "asset_actions" ("to_user_id");
CREATE INDEX IF NOT EXISTS "asset_actions_occurred_at_idx" ON "asset_actions" ("occurred_at");

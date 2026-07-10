-- Asset status overlay flags + app_settings, plus migration of existing
-- 'Repair' / 'Maintenance' base statuses into (In Service + flag).

-- 1) New overlay flags on assets.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "needs_repair" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "maintenance_due" BOOLEAN NOT NULL DEFAULT false;

-- 2) Migrate existing single-status rows into the new model.
--    'Repair'      -> base 'In Service' + needs_repair = true
--    'Maintenance' -> base 'In Service' + maintenance_due = true
UPDATE "assets" SET "needs_repair" = true,    "status" = 'In Service' WHERE "status" = 'Repair';
UPDATE "assets" SET "maintenance_due" = true, "status" = 'In Service' WHERE "status" = 'Maintenance';

-- 3) Indexes for flag-based filters/counts.
CREATE INDEX IF NOT EXISTS "assets_needs_repair_idx" ON "assets" ("needs_repair");
CREATE INDEX IF NOT EXISTS "assets_maintenance_due_idx" ON "assets" ("maintenance_due");

-- 4) Global key/value settings.
CREATE TABLE IF NOT EXISTS "app_settings" (
  "key"        TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" TEXT,
  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- 5) Seed the maintenance-due lead time (28 days = 4 weeks) if not present.
INSERT INTO "app_settings" ("key", "value")
VALUES ('maintenance_due_lead_days', '28')
ON CONFLICT ("key") DO NOTHING;

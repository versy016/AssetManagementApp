-- Add missing columns for HIRE action details
-- Aligns DB with schema.prisma (asset_action_details.hire_project, hire_client)

ALTER TABLE "asset_action_details"
  ADD COLUMN IF NOT EXISTS "hire_project" TEXT,
  ADD COLUMN IF NOT EXISTS "hire_client" TEXT;


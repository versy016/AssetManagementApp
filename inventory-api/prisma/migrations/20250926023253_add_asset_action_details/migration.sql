-- CreateEnum
CREATE TYPE "AssetActionType" AS ENUM ('REPAIR', 'MAINTENANCE', 'HIRE', 'END_OF_LIFE', 'LOST', 'STOLEN', 'CHECK_IN', 'CHECK_OUT', 'TRANSFER', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "ActionPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "asset_actions" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "asset_id" TEXT NOT NULL,
    "type" "AssetActionType" NOT NULL,
    "data" JSONB,
    "note" TEXT,
    "performed_by" TEXT,
    "from_user_id" TEXT,
    "to_user_id" TEXT,
    "occurred_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_action_details" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "action_id" TEXT NOT NULL,
    "action_type" "AssetActionType" NOT NULL,
    "date" DATE,
    "notes" TEXT,
    "summary" TEXT,
    "estimated_cost" DECIMAL(10,2),
    "priority" "ActionPriority",
    "hire_to" TEXT,
    "hire_start" DATE,
    "hire_end" DATE,
    "hire_rate" DECIMAL(10,2),
    "eol_reason" TEXT,
    "where_location" TEXT,
    "police_report" TEXT,

    CONSTRAINT "asset_action_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_actions_asset_id_occurred_at_idx" ON "asset_actions"("asset_id", "occurred_at");

-- CreateIndex
CREATE INDEX "asset_actions_type_idx" ON "asset_actions"("type");

-- CreateIndex
CREATE UNIQUE INDEX "asset_action_details_action_id_key" ON "asset_action_details"("action_id");

-- AddForeignKey
ALTER TABLE "asset_actions" ADD CONSTRAINT "asset_actions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asset_actions" ADD CONSTRAINT "asset_actions_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_actions" ADD CONSTRAINT "asset_actions_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_actions" ADD CONSTRAINT "asset_actions_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_action_details" ADD CONSTRAINT "asset_action_details_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "asset_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "asset_deletions" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "asset_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_by" TEXT,
    "asset_name" TEXT,
    "asset_type" TEXT,
    "image_url" TEXT,

    CONSTRAINT "asset_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_deletions_deleted_at_idx" ON "asset_deletions"("deleted_at");

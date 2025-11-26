/*
  Warnings:

  - The primary key for the `asset_documents` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "asset_documents" DROP CONSTRAINT "asset_documents_asset_id_fkey";

-- DropForeignKey
ALTER TABLE "asset_documents" DROP CONSTRAINT "asset_documents_field_id_fkey";

-- AlterTable
ALTER TABLE "asset_documents" DROP CONSTRAINT "asset_documents_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "asset_documents_pkey" PRIMARY KEY ("id");

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_asset_type_field_id_fkey" FOREIGN KEY ("asset_type_field_id") REFERENCES "asset_type_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "asset_documents_field_id_idx" RENAME TO "asset_documents_asset_type_field_id_idx";

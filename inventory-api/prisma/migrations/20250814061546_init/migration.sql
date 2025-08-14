-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateTable
CREATE TABLE "asset_logs" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "asset_id" TEXT,
    "message" TEXT,
    "date" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,

    CONSTRAINT "asset_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_types" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "image_url" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "type_id" TEXT,
    "serial_number" TEXT,
    "model" TEXT,
    "description" TEXT,
    "assigned_to_id" TEXT,
    "status" TEXT NOT NULL,
    "next_service_date" DATE,
    "documentation_url" TEXT,
    "image_url" TEXT,
    "last_updated" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "last_changed_by" TEXT,
    "location" TEXT,
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "date_purchased" DATE,
    "notes" TEXT,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_field_values" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "asset_id" TEXT NOT NULL,
    "asset_type_field_id" TEXT NOT NULL,
    "value" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_type_fields" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "asset_type_id" TEXT NOT NULL,
    "field_type_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "default_value" TEXT,
    "options" JSONB,
    "validation_rules" JSONB,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_type_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_types" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "has_options" BOOLEAN NOT NULL DEFAULT false,
    "validation_rules" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "userassets" TEXT[],
    "useremail" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_field_values_asset_id_idx" ON "asset_field_values"("asset_id");

-- CreateIndex
CREATE INDEX "asset_field_values_asset_type_field_id_idx" ON "asset_field_values"("asset_type_field_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_field_values_asset_id_asset_type_field_id_key" ON "asset_field_values"("asset_id", "asset_type_field_id");

-- CreateIndex
CREATE INDEX "asset_type_fields_asset_type_id_idx" ON "asset_type_fields"("asset_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_type_fields_asset_type_id_slug_key" ON "asset_type_fields"("asset_type_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "field_types_slug_key" ON "field_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_useremail_key" ON "users"("useremail");

-- AddForeignKey
ALTER TABLE "asset_logs" ADD CONSTRAINT "asset_logs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asset_logs" ADD CONSTRAINT "asset_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "asset_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asset_field_values" ADD CONSTRAINT "asset_field_values_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_field_values" ADD CONSTRAINT "asset_field_values_asset_type_field_id_fkey" FOREIGN KEY ("asset_type_field_id") REFERENCES "asset_type_fields"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_type_fields" ADD CONSTRAINT "asset_type_fields_asset_type_id_fkey" FOREIGN KEY ("asset_type_id") REFERENCES "asset_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_type_fields" ADD CONSTRAINT "asset_type_fields_field_type_id_fkey" FOREIGN KEY ("field_type_id") REFERENCES "field_types"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

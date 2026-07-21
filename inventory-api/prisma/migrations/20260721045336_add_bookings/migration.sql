-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'ACTIVE', 'COMPLETED');

-- AlterTable
ALTER TABLE "asset_types" ADD COLUMN     "bookable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "asset_id" TEXT NOT NULL,
    "booked_by_id" TEXT NOT NULL,
    "project" TEXT,
    "project_ref" TEXT,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "needs_approval" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" TEXT,
    "checked_out_at" TIMESTAMPTZ(6),
    "returned_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookings_asset_id_idx" ON "bookings"("asset_id");

-- CreateIndex
CREATE INDEX "bookings_date_from_date_to_idx" ON "bookings"("date_from", "date_to");

-- CreateIndex
CREATE INDEX "bookings_booked_by_id_idx" ON "bookings"("booked_by_id");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booked_by_id_fkey" FOREIGN KEY ("booked_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

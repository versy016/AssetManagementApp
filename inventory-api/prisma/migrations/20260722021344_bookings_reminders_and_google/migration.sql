/*
  Warnings:

  - A unique constraint covering the columns `[google_event_id]` on the table `bookings` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "asset_types" ALTER COLUMN "bookable" SET DEFAULT true;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "google_event_id" TEXT,
ADD COLUMN     "google_synced_at" TIMESTAMPTZ(6),
ADD COLUMN     "overdue_notified_at" TIMESTAMPTZ(6),
ADD COLUMN     "reminded_end_at" TIMESTAMPTZ(6),
ADD COLUMN     "reminded_start_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_google_event_id_key" ON "bookings"("google_event_id");

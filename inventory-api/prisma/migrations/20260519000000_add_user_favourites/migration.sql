-- Adds per-user "My Favourites" list (up to 5 asset IDs) used by the
-- Search / Inventory quick filter. Defaults to an empty array so existing
-- rows stay valid without a backfill.

ALTER TABLE "users"
  ADD COLUMN "favourite_asset_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

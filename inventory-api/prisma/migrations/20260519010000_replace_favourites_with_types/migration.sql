-- Pivot: favourites were meant to be ASSET TYPES (e.g. "Vehicle", "Total
-- Station"), not specific asset IDs, and the cap is 3 (not 5).  Each
-- favourite type renders as its own quick-filter chip alongside "Needs
-- service" on the Search / Inventory screen.
--
-- Safe to drop the old column outright: it was added in the previous
-- migration in this same session and never received real data.

ALTER TABLE "users" DROP COLUMN IF EXISTS "favourite_asset_ids";

ALTER TABLE "users"
  ADD COLUMN "favourite_type_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

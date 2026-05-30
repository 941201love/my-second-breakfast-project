-- Migration: menu size options + egg add-on support
-- Adds:
-- 1) menu_items.available_sizes (jsonb array)
--    menu_items.size_prices (jsonb object mapping size -> price)
-- 2) order_items.size (text nullable)
--    order_items.egg_count (int default 0)

ALTER TABLE "bf_v10"."menu_items"
  ADD COLUMN IF NOT EXISTS "available_sizes" jsonb;

ALTER TABLE "bf_v10"."menu_items"
  ADD COLUMN IF NOT EXISTS "size_prices" jsonb;

-- order item: chosen size + egg count
ALTER TABLE "bf_v10"."order_items"
  ADD COLUMN IF NOT EXISTS "size" text;

ALTER TABLE "bf_v10"."order_items"
  ADD COLUMN IF NOT EXISTS "egg_count" integer NOT NULL DEFAULT 0;

-- Backfill defaults for existing menu items and order items
UPDATE "bf_v10"."menu_items"
SET
  "available_sizes" = COALESCE("available_sizes", '[]'::jsonb),
  "size_prices" = COALESCE("size_prices", '{}'::jsonb);

UPDATE "bf_v10"."order_items"
SET
  "egg_count" = COALESCE("egg_count", 0);


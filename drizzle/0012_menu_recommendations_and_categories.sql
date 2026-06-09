ALTER TABLE "bf_v10"."menu_items"
ADD COLUMN IF NOT EXISTS "is_recommended" boolean DEFAULT false NOT NULL;

UPDATE "bf_v10"."menu_items"
SET "category" = '點心'
WHERE "category" IN ('主餐', '餐點', '蘿蔔糕')
  AND ("name" LIKE '%蘿蔔糕%' OR "name" LIKE '%蘿蔔%');

UPDATE "bf_v10"."menu_items"
SET "category" = '吐司'
WHERE "category" IN ('主餐', '餐點')
  AND "name" LIKE '%吐司%';

UPDATE "bf_v10"."menu_items"
SET "category" = '漢堡'
WHERE "category" IN ('主餐', '餐點')
  AND ("name" LIKE '%漢堡%' OR "name" LIKE '%堡%');

UPDATE "bf_v10"."menu_items"
SET "category" = '蛋餅'
WHERE "category" IN ('主餐', '餐點')
  AND "name" LIKE '%蛋餅%';

UPDATE "bf_v10"."menu_items"
SET "category" = '飯糰'
WHERE "category" IN ('主餐', '餐點')
  AND ("name" LIKE '%飯糰%' OR "name" LIKE '%飯糉%');

UPDATE "bf_v10"."menu_items"
SET "category" = '麵食'
WHERE "category" IN ('主餐', '餐點')
  AND ("name" LIKE '%麵%' OR "name" LIKE '%炒麵%');

UPDATE "bf_v10"."menu_items"
SET "category" = '其他'
WHERE "category" IN ('主餐', '餐點');

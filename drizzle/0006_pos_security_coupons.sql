ALTER TABLE "bf_v10"."orders"
  ADD COLUMN IF NOT EXISTS "daily_sequence" integer;--> statement-breakpoint
ALTER TABLE "bf_v10"."orders"
  ADD COLUMN IF NOT EXISTS "coupon_code" text;--> statement-breakpoint
ALTER TABLE "bf_v10"."orders"
  ADD COLUMN IF NOT EXISTS "discount_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bf_v10"."coupons" (
  "code" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "discount_type" text DEFAULT 'amount' NOT NULL,
  "discount_value" integer NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint

INSERT INTO "bf_v10"."coupons" (
  "code", "name", "discount_type", "discount_value", "is_active"
)
VALUES ('BREAKFAST10', '早餐折 10 元', 'amount', 10, true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

DROP INDEX IF EXISTS "bf_v10"."order_items_order_menu_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_order_menu_idx"
  ON "bf_v10"."order_items" ("order_id", "menu_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_daily_sequence_idx"
  ON "bf_v10"."orders" ("daily_sequence", "created_at");--> statement-breakpoint

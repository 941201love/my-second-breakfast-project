ALTER TABLE "bf_v10"."orders"
  ADD COLUMN IF NOT EXISTS "payment_method" text;--> statement-breakpoint
ALTER TABLE "bf_v10"."orders"
  ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "bf_v10"."orders"
  ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "bf_v10"."order_items"
  ADD COLUMN IF NOT EXISTS "sugar_level" text;--> statement-breakpoint
ALTER TABLE "bf_v10"."order_items"
  ADD COLUMN IF NOT EXISTS "ice_level" text;--> statement-breakpoint
ALTER TABLE "bf_v10"."order_items"
  ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint

UPDATE "bf_v10"."orders"
SET "payment_method" = 'cash'
WHERE "payment_method" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "orders_status_created_at_idx"
  ON "bf_v10"."orders" ("status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_submitted_at_idx"
  ON "bf_v10"."orders" ("submitted_at");--> statement-breakpoint

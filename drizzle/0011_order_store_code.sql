ALTER TABLE "bf_v10"."orders"
  ADD COLUMN IF NOT EXISTS "store_code" text DEFAULT 'default' NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "orders_store_status_created_at_idx"
  ON "bf_v10"."orders" ("store_code", "status", "created_at");

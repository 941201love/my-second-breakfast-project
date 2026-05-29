ALTER TABLE "bf_v10"."orders"
  ADD COLUMN IF NOT EXISTS "customer_phone" text;--> statement-breakpoint
ALTER TABLE "bf_v10"."orders"
  ADD COLUMN IF NOT EXISTS "pickup_time" text;--> statement-breakpoint

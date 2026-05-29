ALTER TABLE "bf_v10"."coupons"
  ADD COLUMN IF NOT EXISTS "min_spend" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bf_v10"."coupons"
  ADD COLUMN IF NOT EXISTS "max_discount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bf_v10"."coupons"
  ADD COLUMN IF NOT EXISTS "usage_limit_per_user" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bf_v10"."coupons"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;--> statement-breakpoint

UPDATE "bf_v10"."coupons"
SET
  "min_spend" = COALESCE("min_spend", 0),
  "max_discount" = COALESCE("max_discount", 0),
  "usage_limit_per_user" = COALESCE("usage_limit_per_user", 1);--> statement-breakpoint

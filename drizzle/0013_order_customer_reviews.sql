ALTER TABLE "bf_v10"."orders" ADD COLUMN IF NOT EXISTS "review_rating" integer;
ALTER TABLE "bf_v10"."orders" ADD COLUMN IF NOT EXISTS "review_text" text;
ALTER TABLE "bf_v10"."orders" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;

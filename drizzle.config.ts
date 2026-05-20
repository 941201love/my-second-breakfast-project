/*import { defineConfig } from "drizzle-kit";

const migrationUrl =
  process.env.DATABASE_URL_MIGRATION ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error(
    "DATABASE_URL_MIGRATION or DATABASE_URL is required for drizzle-kit.",
  );
}

export default defineConfig({
  schema: ["./db/schema.ts", "./db/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationUrl,
  },
});*/

import { defineConfig } from "drizzle-kit";

// ⚠️ 大絕招：直接把你在 Neon 複製的「直連網址（沒有 -pooler、結尾有 ?sslmode=require）」貼在下面
// 範例：'postgresql://keboxiang_owner:xxx@ep-cool-pool-123456.ap-southeast-1.neon.tech/neondb?sslmode=require'
const neonDirectUrl = "postgresql://neondb_owner:npg_xacCIrKiA4Z9@ep-patient-math-ao1tmpof.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

export default defineConfig({
  schema: ["./db/schema.ts", "./db/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: neonDirectUrl, // 直接指路給它，不讀環境變數
  },
});

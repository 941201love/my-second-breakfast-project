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

const neonDirectUrl =
  process.env.DATABASE_URL_MIGRATION ?? process.env.DATABASE_URL;

if (!neonDirectUrl) {
  throw new Error(
    "DATABASE_URL_MIGRATION or DATABASE_URL is required for drizzle-kit.",
  );
}

export default defineConfig({
  // 🎯 拿掉萬用字元，直接把兩支檔案的路徑硬指給它！
  schema: ["./db/schema.ts", "./db/auth-schema.ts"], 
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["bf_v10", "drizzle"], 
  dbCredentials: {
    url: neonDirectUrl,
  },
});

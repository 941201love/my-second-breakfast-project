import {
  boolean,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.ts";

// PostgreSQL namespace 隔離
// 透過 PG_SCHEMA 環境變數切換，預設 "bf_v10"
// V10 使用 bf_v10，保留 bf_v9 作為可回退的上一版 schema。
// 注意：不能使用 "public" 作為 schema 名稱（Drizzle 限制）
const schemaName = process.env.PG_SCHEMA || "bf_v10";
if (schemaName === "public") {
  throw new Error(
    'PG_SCHEMA cannot be "public". Use a custom schema name or leave it unset to use the default "bf_v10".',
  );
}
const appSchema = pgSchema(schemaName);

// 對照 shared/contracts.ts：
//   MenuItem { id, entityId, logicalId, version, name, price, category, description, imageUrl }
//   Order { id, userId: string, total, status, createdAt, submittedAt }
//   OrderItem { menuItemId, menuItemName, menuItemPrice, qty } → order_items + menu_items JOIN
//
// V9 設計：userId 直接對應 Better Auth 的 user.id（text PK）
// 不再維護獨立的 users 表，身份完全由 Better Auth 管理。

export const menuItemsTable = appSchema.table(
  "menu_items",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").notNull(),
    logicalId: text("logical_id").notNull(),
    version: integer("version").notNull().default(1),
    majorVersion: integer("major_version").notNull().default(1),
    minorVersion: integer("minor_version").notNull().default(0),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    imageUrl: text("image_url").notNull(),
    isCurrentVersion: boolean("is_current_version").notNull().default(true),
    supersedes: text("supersedes").references(
      (): AnyPgColumn => menuItemsTable.id,
    ),
    testGroup: text("test_group").notNull().default("default"),
    changeReason: text("change_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by"),
  },
  (table) => ({
    entityVersionIdx: uniqueIndex("menu_items_entity_version_idx").on(
      table.entityId,
      table.version,
    ),
    logicalIdIdx: index("menu_items_logical_id_idx").on(table.logicalId),
    currentVersionIdx: index("menu_items_current_version_idx").on(
      table.isCurrentVersion,
    ),
  }),
);

export const menuDisplayOrderTable = appSchema.table(
  "menu_display_order",
  {
    logicalId: text("logical_id").primaryKey(),
    displayOrder: integer("display_order").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    displayOrderIdx: index("menu_display_order_display_order_idx").on(
      table.displayOrder,
    ),
  }),
);

export const promotionsTable = appSchema.table("promotions", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  menuItemLogicalId: text("menu_item_logical_id").notNull(),
  discountType: text("discount_type").notNull().default("amount"),
  discountValue: integer("discount_value").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const ordersTable = appSchema.table("orders", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  total: integer("total").notNull().default(0),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

export const orderItemsTable = appSchema.table(
  "order_items",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    menuItemId: text("menu_item_id")
      .notNull()
      .references(() => menuItemsTable.id),
    qty: integer("qty").notNull(),
  },
  (table) => ({
    orderMenuUniqueIdx: uniqueIndex("order_items_order_menu_idx").on(
      table.orderId,
      table.menuItemId,
    ),
  }),
);

import { z } from "zod";

// ─── API Business Schemas（Single Source of Truth）──────────────────────────
// 這裡是前後端共用的業務型別定義。
// 型別（TypeScript type）由 Zod schema 自動推導，不需要手動維護兩份。

export const menuItemSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  logicalId: z.string().min(1),
  version: z.number().int().min(1),
  majorVersion: z.number().int().min(1),
  minorVersion: z.number().int().min(0),
  name: z.string().min(1),
  price: z.number().min(0),
  category: z.string().min(1),
  description: z.string(),
  imageUrl: z.string().min(1),
  isCurrentVersion: z.boolean(),
  testGroup: z.string().min(1),
  displayOrder: z.number().int().min(0).optional(),
  activePromotion: z
    .object({
      id: z.number().int().min(1),
      name: z.string().min(1),
      discountType: z.enum(["amount", "percent"]),
      discountValue: z.number().int().min(1),
    })
    .optional(),
  isRecentlyUpdated: z.boolean().optional(),
  priceChanged: z.boolean().optional(),
  previousPrice: z.number().optional(),
});

export const menuItemVersionHistorySchema = z.object({
  version: z.number().int().min(1),
  majorVersion: z.number().int().min(1),
  minorVersion: z.number().int().min(0),
  id: z.string().min(1),
  name: z.string().min(1),
  price: z.number().min(0),
  category: z.string().min(1),
  description: z.string(),
  imageUrl: z.string().min(1),
  isCurrentVersion: z.boolean(),
  testGroup: z.string().min(1),
  changeReason: z.string().nullable().optional(),
  createdAt: z.string().min(1),
  createdBy: z.string().nullable().optional(),
});

export const activePromotionSchema = z.object({
  id: z.number().int().min(1),
  name: z.string().min(1),
  menuItemLogicalId: z.string().min(1),
  discountType: z.enum(["amount", "percent"]),
  discountValue: z.number().int().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
});

export const couponSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  discountType: z.enum(["amount", "percent"]),
  discountValue: z.number().int().min(1),
  isActive: z.boolean(),
});

export const priceSensitivitySchema = z.object({
  logicalId: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().min(1),
  majorVersion: z.number().int().min(1),
  minorVersion: z.number().int().min(0),
  testGroup: z.string().min(1),
  price: z.number().min(0),
  totalQty: z.number().min(0),
  totalRevenue: z.number().min(0),
});

export const staleCartItemSchema = z.object({
  menuItemId: z.string().min(1),
  menuItemName: z.string().min(1),
  menuItemPrice: z.number().min(0),
  qty: z.number().min(0),
  currentMenuItemId: z.string().min(1).optional(),
  currentMenuItemName: z.string().min(1).optional(),
  currentMenuItemPrice: z.number().min(0).optional(),
});

// ─── User schemas（業務層）──────────────────────────────────────────────────
// userSchema：完整使用者資料（業務/資料層使用，不對外暴露）
// sessionUserSchema：API 回傳的最小安全投影（不含 password 等敏感欄位）
// 注意：V9 使用 Better Auth，userSchema 由 Better Auth DB 負責儲存。
//       sessionUserSchema 為 auth session 對外的唯一輸出格式。

export const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(3),
  name: z.string().min(1),
  password: z.string().min(1),
  // 預留個資欄位（V9+ 實作使用者 profile 時使用）
  birthday: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
});

export const sessionUserSchema = userSchema.pick({
  id: true,
  email: true,
  name: true,
});

export const orderItemSchema = z.object({
  id: z.number().int().min(1).optional(),
  menuItemId: z.string().min(1),
  menuItemName: z.string().min(1),
  menuItemPrice: z.number().min(0),
  qty: z.number().min(0),
  sugarLevel: z.string().optional(),
  iceLevel: z.string().optional(),
  note: z.string().optional(),
});

export const orderSchema = z.object({
  id: z.number().int().min(1),
  userId: z.string().min(1),
  items: z.array(orderItemSchema),
  total: z.number().min(0),
  status: z.enum(["pending", "submitted", "completed"]),
  dailySequence: z.number().int().min(1).optional(),
  paymentMethod: z.enum(["cash", "card"]).optional(),
  note: z.string().optional(),
  couponCode: z.string().optional(),
  customerPhone: z.string().optional(),
  pickupTime: z.string().optional(),
  discountTotal: z.number().min(0).optional(),
  createdAt: z.string().min(1),
  submittedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
});

export const orderProgressSchema = z.object({
  latestSubmittedOrderId: z.number().int().min(1).nullable(),
  latestCompletedOrderId: z.number().int().min(1).nullable(),
});

// ─── Derived TypeScript Types（自動推導，永不過時）───────────────────────────
export type MenuItem = z.infer<typeof menuItemSchema>;
export type MenuItemVersionHistory = z.infer<
  typeof menuItemVersionHistorySchema
>;
export type ActivePromotion = z.infer<typeof activePromotionSchema>;
export type Coupon = z.infer<typeof couponSchema>;
export type PriceSensitivity = z.infer<typeof priceSensitivitySchema>;
export type StaleCartItem = z.infer<typeof staleCartItemSchema>;
export type User = z.infer<typeof userSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderProgress = z.infer<typeof orderProgressSchema>;

export interface ApiDataResponse<T> {
  data: T;
}

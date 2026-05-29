import { z } from "zod";
import type { Order } from "./contracts.ts";
import {
  activePromotionSchema,
  couponSchema,
  menuItemSchema,
  menuItemVersionHistorySchema,
  orderSchema,
  orderProgressSchema,
  priceSensitivitySchema,
  staleCartItemSchema,
} from "./contracts.ts";
import toTaipeiDateTime from "../util.ts";

export type { Order };

// ─── API Layer Error Response（API 層錯誤格式定義）────────────────────────

export const apiErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  staleItems: z.array(staleCartItemSchema).optional(),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

// ─── API Layer Order Response（Order 的 API 層呈現）──────────────────────

export const orderResponseSchema = orderSchema.extend({
  createdAtTaipei: z.string().min(1),
});

export type OrderResponse = z.infer<typeof orderResponseSchema>;

/**
 * 將數據庫/內部 Order 轉換為 API 響應格式
 * 添加台北時區時間戳
 */
export function toOrderResponse(order: Order): OrderResponse {
  return {
    ...order,
    createdAtTaipei: toTaipeiDateTime(order.createdAt),
  };
}

// ─── Request Schemas（按 route 分組）────────────────────────────────────

/** POST /api/menu */
const menuTranslationsBodySchema = z.object({
  "zh-TW": z.object({
    name: z.string().min(1),
    description: z.string().min(1),
  }),
  en: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
  }),
  ja: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
  }),
  ko: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
  }),
});

export const createMenuItemBodySchema = z.object({
  logicalId: z.string().min(1).optional(),
  price: z.number().int().min(0),
  category: z.string().min(1),
  imageUrl: z.string().min(1),
  translations: menuTranslationsBodySchema,
});

/** PATCH /api/menu/:id */
export const updateMenuItemParamsSchema = z.object({
  id: z.string().min(1),
});

export const updateMenuItemBodySchema = z.object({
  changes: z
    .object({
      name: z.string().min(1).optional(),
      price: z.number().int().min(0).optional(),
      category: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      imageUrl: z.string().min(1).optional(),
      testGroup: z.string().min(1).optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, {
      message: "At least one field must be changed",
    }),
  reason: z.string().min(1),
  versionLevel: z.enum(["major", "minor"]).default("minor"),
});

export const adminLoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const adminLoginResponseSchema = z.object({
  data: z.object({
    username: z.string().min(1),
  }),
});

/** PATCH /api/menu/display-order */
export const updateMenuDisplayOrderBodySchema = z.object({
  items: z.array(
    z.object({
      logicalId: z.string().min(1),
      displayOrder: z.number().int().min(0),
    }),
  ),
});

/** DELETE /api/menu/:id */
export const deleteMenuItemParamsSchema = z.object({
  id: z.string().min(1),
});

/** GET /api/orders/:id */
export const getOrderByIdParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

/** PATCH /api/orders/:id */
export const updateOrderParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

export const updateOrderBodySchema = z.object({
  orderItemId: z.number().int().min(1).optional(),
  itemId: z.string().min(1),
  qty: z.number().min(0),
  sugarLevel: z.string().optional(),
  iceLevel: z.string().optional(),
  note: z.string().optional(),
  forceNew: z.boolean().optional(),
});

/** POST /api/orders/:id/submit */
export const submitOrderParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
});

export const submitOrderBodySchema = z.object({
  paymentMethod: z.enum(["cash", "card"]).default("cash"),
  note: z.string().optional(),
  couponCode: z.string().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  pickupTime: z.string().optional(),
});

export const createCouponBodySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  discountType: z.enum(["amount", "percent"]).default("amount"),
  discountValue: z.number().int().min(1),
  minSpend: z.number().int().min(0).default(0),
  usageLimitPerUser: z.number().int().min(1).default(1),
  expiresAt: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const couponParamsSchema = z.object({
  code: z.string().min(1),
});

// ─── Response Schemas（API envelope 層）─────────────────────────────────

export const menuListResponseSchema = z.object({
  data: z.array(menuItemSchema),
});

export const menuItemResponseSchema = z.object({
  data: menuItemSchema,
});

export const menuItemVersionHistoryListResponseSchema = z.object({
  data: z.array(menuItemVersionHistorySchema),
});

export const activePromotionListResponseSchema = z.object({
  data: z.array(activePromotionSchema),
});

export const couponListResponseSchema = z.object({
  data: z.array(couponSchema),
});

export const couponResponseSchema = z.object({
  data: couponSchema,
});

export const priceSensitivityListResponseSchema = z.object({
  data: z.array(priceSensitivitySchema),
});

export const orderListResponseSchema = z.object({
  data: z.array(orderResponseSchema),
});

export const orderResponseEnvelopeSchema = z.object({
  data: orderResponseSchema,
});

export const nullableOrderResponseEnvelopeSchema = z.object({
  data: orderResponseSchema.nullable(),
});

export const orderProgressResponseSchema = z.object({
  data: orderProgressSchema,
});

export const healthResponseSchema = z.object({
  status: z.string(),
});

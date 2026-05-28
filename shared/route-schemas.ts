import { z } from "zod";
import type { Order } from "./contracts.ts";
import {
  menuItemSchema,
  menuItemVersionHistorySchema,
  orderSchema,
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
export const createMenuItemBodySchema = z.object({
  logicalId: z.string().min(1).optional(),
  name: z.string().min(1),
  price: z.number().int().min(0),
  category: z.string().min(1),
  description: z.string().min(1),
  imageUrl: z.string().min(1),
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
    })
    .refine((changes) => Object.keys(changes).length > 0, {
      message: "At least one field must be changed",
    }),
  reason: z.string().min(1),
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
  itemId: z.string().min(1),
  qty: z.number().min(0),
});

/** POST /api/orders/:id/submit */
export const submitOrderParamsSchema = z.object({
  id: z.string().regex(/^[0-9]+$/),
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

export const orderListResponseSchema = z.object({
  data: z.array(orderResponseSchema),
});

export const orderResponseEnvelopeSchema = z.object({
  data: orderResponseSchema,
});

export const nullableOrderResponseEnvelopeSchema = z.object({
  data: orderResponseSchema.nullable(),
});

export const healthResponseSchema = z.object({
  status: z.string(),
});

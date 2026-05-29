import type { MenuItem, Order, StaleCartItem } from "../shared/contracts.ts";
import type { Coupon } from "../shared/contracts.ts";

export type UpdateOrderItemErrorCode =
  | "ORDER_NOT_FOUND"
  | "MENU_ITEM_NOT_FOUND"
  | "ORDER_NOT_OWNED"
  | "ORDER_NOT_EDITABLE";

export type SubmitOrderErrorCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_OWNED"
  | "ORDER_NOT_EDITABLE"
  | "EMPTY_ORDER"
  | "MENU_VERSION_STALE";

export interface SubmitOrderError {
  ok: false;
  code: SubmitOrderErrorCode;
  staleItems?: StaleCartItem[];
}

export interface Store {
  init(): Promise<void>;

  getMenu(): ReadonlyArray<MenuItem>;
  createMenuItem(input: {
    logicalId?: string;
    name: string;
    price: number;
    category: string;
    description: string;
    imageUrl: string;
    createdBy?: string;
  }): Promise<MenuItem>;
  updateMenuItem(
    menuId: string,
    patch: {
      changes: {
        name?: string;
        price?: number;
        category?: string;
        description?: string;
        imageUrl?: string;
        testGroup?: string;
      };
      reason: string;
      versionLevel?: "major" | "minor";
      userId?: string;
    },
  ): Promise<MenuItem | null>;
  deleteMenuItem(menuId: string): Promise<MenuItem | null>;

  getOrders(): ReadonlyArray<Order>;
  getCurrentOrderByUserId(userId: string): Order | undefined;
  getOrderHistoryByUserId(userId: string): ReadonlyArray<Order>;
  getOrderById(orderId: number): Order | undefined;
  createOrder(input: { userId: string }): Promise<Order>;
  updateOrderItem(
    orderId: number,
    input: {
      userId: string;
      orderItemId?: number;
      itemId: string;
      qty: number;
      sugarLevel?: string;
      iceLevel?: string;
      note?: string;
      forceNew?: boolean;
    },
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: UpdateOrderItemErrorCode }
  >;
  submitOrder(
    orderId: number,
    input: {
      userId: string;
      paymentMethod?: "cash" | "card";
      note?: string;
      couponCode?: string;
    },
  ): Promise<{ ok: true; order: Order } | SubmitOrderError>;
  completeOrder(orderId: number): Promise<Order | null>;
  getCoupons(): ReadonlyArray<Coupon>;
  createCoupon(input: Coupon): Promise<Coupon>;
}

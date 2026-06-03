import type {
  AddonSettings,
  MenuItem,
  Order,
  StaleCartItem,
} from "../shared/contracts.ts";
import type { z } from "zod";
import type { menuItemSchema } from "../shared/contracts.ts";
import type { Coupon } from "../shared/contracts.ts";

type MenuTranslations = z.infer<typeof menuItemSchema>["translations"];

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
  | "MENU_VERSION_STALE"
  | "COUPON_NOT_AVAILABLE";

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
    name?: string;
    price: number;
    largePrice?: number;
    eggPrice?: number;
    cheesePrice?: number;
    addonKeys?: string[];
    category: string;
    description?: string;
    imageUrl: string;
    translations?: MenuTranslations;
    createdBy?: string;
  }): Promise<MenuItem>;
  updateMenuItem(
    menuId: string,
    patch: {
      changes: {
        name?: string;
        price?: number;
        largePrice?: number | null;
        eggPrice?: number | null;
        cheesePrice?: number | null;
        addonKeys?: string[];
        category?: string;
        description?: string;
        imageUrl?: string;
        translations?: MenuTranslations;
        testGroup?: string;
      };
      reason: string;
      versionLevel?: "major" | "minor";
      userId?: string;
    },
  ): Promise<MenuItem | null>;
  deleteMenuItem(menuId: string): Promise<MenuItem | null>;
  getAddonSettings(): AddonSettings;
  updateAddonSettings(input: AddonSettings): Promise<AddonSettings>;

  getOrders(): ReadonlyArray<Order>;
  getCurrentOrderByUserId(userId: string): Order | undefined;
  getOrderHistoryByUserId(userId: string): ReadonlyArray<Order>;
  getOrderById(orderId: number): Order | undefined;
  createOrder(input: { userId: string }): Promise<Order>;
  createOrder(input: { userId: string; storeCode?: string }): Promise<Order>;
  updateOrderItem(
    orderId: number,
    input: {
      userId: string;
      orderItemId?: number;
      itemId: string;
      qty: number;
      size?: "small" | "large";
      eggQty?: number;
      cheeseQty?: number;
      addons?: Order["items"][number]["addons"];
      sugarLevel?: string;
      iceLevel?: string;
      note?: string;
      forceNew?: boolean;
    },
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: UpdateOrderItemErrorCode }
  >;
  clearOrderItems(
    orderId: number,
    input: { userId: string },
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
      customerName?: string;
      customerPhone?: string;
      pickupTime?: string;
    },
  ): Promise<{ ok: true; order: Order } | SubmitOrderError>;
  completeOrder(orderId: number): Promise<Order | null>;
  pickUpOrder(orderId: number): Promise<Order | null>;
  getCoupons(): ReadonlyArray<Coupon>;
  createCoupon(input: Coupon): Promise<Coupon>;
  deleteCoupon(code: string): Promise<Coupon | null>;
}

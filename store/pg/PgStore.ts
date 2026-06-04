import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type {
  AddonSettings,
  Employee,
  MenuItem,
  Order,
  OrderItem,
  StaleCartItem,
  Coupon,
} from "../../shared/contracts.ts";
import { db } from "../../db/client.ts";
import { menuRepository } from "../../db/repositories/menuRepository.ts";
import {
  menuItemsTable,
  orderItemsTable,
  ordersTable,
  couponsTable,
  productAddonSettingsTable,
} from "../../db/schema.ts";
import type { Store } from "../Store.ts";

interface PgStoreOptions {
  dataFilePath?: string;
}

interface SeedData {
  menu?: Array<
    Partial<MenuItem> & {
      id?: number | string;
      image_url?: string;
    }
  >;
}

const schemaName = process.env.PG_SCHEMA || "bf_v10";
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
  throw new Error(`Unsafe PG_SCHEMA: ${schemaName}`);
}

function calculateTotal(items: ReadonlyArray<OrderItem>): number {
  return items.reduce((sum, item) => sum + item.menuItemPrice * item.qty, 0);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function logicalIdFromSeedId(id: string | number | undefined, index: number) {
  if (typeof id === "number") return String(id).padStart(3, "0");
  if (typeof id === "string" && /^\d+$/.test(id)) {
    return id.padStart(3, "0");
  }
  return String(index + 1).padStart(3, "0");
}

function sameOrderItemOptions(
  item: OrderItem,
  input: {
    sugarLevel?: string;
    iceLevel?: string;
    note?: string;
    size?: "small" | "large";
    eggQty?: number;
    cheeseQty?: number;
    addons?: OrderItem["addons"];
  },
) {
  const sugar = (input.sugarLevel || "正常糖").trim();
  const ice = (input.iceLevel || "正常冰").trim();
  const note = (input.note || "").trim();

  return (
    (item.sugarLevel || "正常糖").trim() === sugar &&
    (item.iceLevel || "正常冰").trim() === ice &&
    (item.note || "").trim() === note &&
    (item.size || "small") === (input.size || "small") &&
    (item.eggQty || 0) === (input.eggQty || 0) &&
    (item.cheeseQty || 0) === (input.cheeseQty || 0) &&
    JSON.stringify(item.addons ?? []) === JSON.stringify(input.addons ?? [])
  );
}

const defaultEmployees: Employee[] = [
  {
    employeeId: "TPE001",
    name: "小明",
    storeCode: "taipei",
    title: "正職人員",
    isActive: true,
  },
  {
    employeeId: "TPE002",
    name: "小美",
    storeCode: "taipei",
    title: "早班人員",
    isActive: true,
  },
  {
    employeeId: "TNN001",
    name: "阿哲",
    storeCode: "tainan",
    title: "店員",
    isActive: true,
  },
  {
    employeeId: "KHH001",
    name: "怡君",
    storeCode: "kaohsiung",
    title: "店員",
    isActive: true,
  },
];

export class PgStore implements Store {
  private readonly dataFilePath: string;
  private menu: MenuItem[] = [];
  private orders: Order[] = [];
  private coupons: Coupon[] = [];
  private employees: Employee[] = [...defaultEmployees];
  private addonSettings: AddonSettings = {
    eggPrice: 10,
    cheesePrice: 10,
    items: [],
  };

  constructor(options: PgStoreOptions = {}) {
    this.dataFilePath = options.dataFilePath ?? "./data/store.json";
  }

  async init(): Promise<void> {
    await db.execute(sql`select 1`);
    await this.ensureProductOptionColumns();
    await this.ensureOrderPickupColumn();
    await this.ensureOrderStoreCodeColumn();
    await this.ensureAddonSettingsTable();
    await this.ensureCouponRuleColumns();
    await this.seedFromJsonIfEmpty();
    await this.reloadFromDatabase();
  }

  getMenu(): ReadonlyArray<MenuItem> {
    return this.menu;
  }

  getAddonSettings(): AddonSettings {
    return {
      ...this.addonSettings,
      items: (this.addonSettings.items ?? []).map((item) => ({ ...item })),
    };
  }

  async updateAddonSettings(input: AddonSettings): Promise<AddonSettings> {
    await db
      .delete(productAddonSettingsTable)
      .where(
        and(
          ne(productAddonSettingsTable.key, "egg"),
          ne(productAddonSettingsTable.key, "cheese"),
        ),
      );
    await db
      .insert(productAddonSettingsTable)
      .values([
        { key: "egg", name: "加蛋", price: input.eggPrice, isActive: true },
        {
          key: "cheese",
          name: "加起司",
          price: input.cheesePrice,
          isActive: true,
        },
        ...(input.items ?? [])
          .filter((item) => item.key !== "egg" && item.key !== "cheese")
          .map((item) => ({ ...item })),
      ])
      .onConflictDoUpdate({
        target: productAddonSettingsTable.key,
        set: {
          name: sql`excluded.name`,
          price: sql`excluded.price`,
          isActive: sql`excluded.is_active`,
          updatedAt: new Date(),
        },
      });
    await this.reloadAddonSettings();
    this.menu = this.menu.map((item) => this.withAddonSettings(item));
    return this.getAddonSettings();
  }

  async createMenuItem(input: {
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
    translations?: MenuItem["translations"];
    createdBy?: string;
  }): Promise<MenuItem> {
    const logicalId = input.logicalId ?? (await this.nextLogicalId());
    const created = await menuRepository.createMenuItem({
      ...input,
      logicalId,
    });

    this.menu.push(this.withAddonSettings(created));
    this.menu.sort((a, b) => a.logicalId.localeCompare(b.logicalId));
    return this.withAddonSettings(created);
  }

  async updateMenuItem(
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
        translations?: MenuItem["translations"];
        testGroup?: string;
      };
      reason: string;
      versionLevel?: "major" | "minor";
      userId?: string;
    },
  ): Promise<MenuItem | null> {
    const updated = await menuRepository.updateMenuItem(
      menuId,
      patch.changes,
      patch.reason,
      patch.versionLevel,
      patch.userId,
    );

    if (!updated) return null;
    this.menu = (await menuRepository.getCurrentMenu()).map((item) =>
      this.withAddonSettings(item),
    );
    return this.withAddonSettings(updated);
  }

  async deleteMenuItem(menuId: string): Promise<MenuItem | null> {
    const existing = this.menu.find(
      (item) => item.id === menuId || item.logicalId === menuId,
    );
    if (!existing) return null;

    const [updated] = await db
      .update(menuItemsTable)
      .set({ isCurrentVersion: false, changeReason: "Removed from menu" })
      .where(eq(menuItemsTable.id, existing.id))
      .returning();

    this.menu = (await menuRepository.getCurrentMenu()).map((item) =>
      this.withAddonSettings(item),
    );
    return updated
      ? {
          id: updated.id,
          entityId: updated.entityId,
          logicalId: updated.logicalId,
          version: updated.version,
          majorVersion: updated.majorVersion,
          minorVersion: updated.minorVersion,
          name: updated.name,
          price: updated.price,
          category: updated.category,
          description: updated.description,
          imageUrl: updated.imageUrl,
          isCurrentVersion: updated.isCurrentVersion,
          testGroup: updated.testGroup,
        }
      : null;
  }

  getOrders(): ReadonlyArray<Order> {
    return this.orders;
  }

  getCurrentOrderByUserId(userId: string): Order | undefined {
    const pendingOrders = this.orders.filter(
      (o) => o.userId === userId && o.status === "pending",
    );

    if (pendingOrders.length === 0) return undefined;
    return pendingOrders.reduce((latest, current) =>
      current.id > latest.id ? current : latest,
    );
  }

  getOrderHistoryByUserId(userId: string): ReadonlyArray<Order> {
    return this.orders
      .filter((o) => o.userId === userId && o.status !== "pending")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getOrderById(orderId: number): Order | undefined {
    return this.orders.find((o) => o.id === orderId);
  }

  async createOrder(input: {
    userId: string;
    storeCode?: string;
  }): Promise<Order> {
    const existingOrder = this.getCurrentOrderByUserId(input.userId);
    if (existingOrder) return existingOrder;

    const createdAt = new Date();
    const storeCode = input.storeCode?.trim() || "default";
    const [inserted] = await db
      .insert(ordersTable)
      .values({
        userId: input.userId,
        status: "pending",
        total: 0,
        storeCode,
        createdAt,
      })
      .returning();

    if (!inserted) throw new Error("Failed to create order");

    const order: Order = {
      id: inserted.id,
      userId: input.userId,
      items: [],
      total: inserted.total,
      status: "pending",
      storeCode: inserted.storeCode,
      createdAt: toIsoString(inserted.createdAt),
    };

    this.orders.push(order);
    return order;
  }

  async updateOrderItem(
    orderId: number,
    input: {
      userId: string;
      orderItemId?: number;
      itemId: string;
      qty: number;
      size?: "small" | "large";
      eggQty?: number;
      cheeseQty?: number;
      addons?: OrderItem["addons"];
      sugarLevel?: string;
      iceLevel?: string;
      note?: string;
      forceNew?: boolean;
    },
  ): Promise<
    | { ok: true; order: Order }
    | {
        ok: false;
        code:
          | "ORDER_NOT_FOUND"
          | "MENU_ITEM_NOT_FOUND"
          | "ORDER_NOT_OWNED"
          | "ORDER_NOT_EDITABLE";
      }
  > {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
    if (order.userId !== input.userId)
      return { ok: false, code: "ORDER_NOT_OWNED" };
    if (order.status !== "pending")
      return { ok: false, code: "ORDER_NOT_EDITABLE" };

    const menuItem = this.menu.find((item) => item.id === input.itemId);
    if (!menuItem) return { ok: false, code: "MENU_ITEM_NOT_FOUND" };
    const addonByKey = new Map(
      (this.addonSettings.items ?? []).map((item) => [item.key, item]),
    );
    const addons = (input.addons ?? [])
      .filter(
        (item) =>
          (menuItem.addonKeys ?? []).includes(item.key) &&
          (addonByKey.get(item.key)?.isActive ?? false) &&
          item.qty > 0,
      )
      .map((item) => ({
        key: item.key,
        name: addonByKey.get(item.key)?.name ?? item.name,
        price: addonByKey.get(item.key)?.price ?? item.price,
        qty: item.qty,
      }));
    const addonTotal = addons.reduce(
      (sum, item) => sum + item.price * item.qty,
      0,
    );
    input = {
      ...input,
      eggQty: menuItem.eggPrice === undefined ? 0 : (input.eggQty ?? 0),
      cheeseQty:
        menuItem.cheesePrice === undefined ? 0 : (input.cheeseQty ?? 0),
      addons,
    };
    const baseMenuItemPrice =
      input.size === "large" && menuItem.largePrice !== undefined
        ? menuItem.largePrice
        : menuItem.price;
    const promotionalMenuItemPrice = await menuRepository.getPromotionalPrice(
      menuItem.logicalId,
      baseMenuItemPrice,
    );
    const unitPrice =
      promotionalMenuItemPrice +
      (menuItem.eggPrice === undefined ? 0 : this.addonSettings.eggPrice) *
        (input.eggQty ?? 0) +
      (menuItem.cheesePrice === undefined
        ? 0
        : this.addonSettings.cheesePrice) *
        (input.cheeseQty ?? 0) +
      addonTotal;

    const existingIdx =
      input.orderItemId !== undefined
        ? order.items.findIndex((item) => item.id === input.orderItemId)
        : input.forceNew
          ? -1
          : order.items.findIndex(
              (item) =>
                item.menuItemId === input.itemId &&
                sameOrderItemOptions(item, input),
            );

    if (existingIdx !== -1) {
      if (input.qty === 0) {
        await db
          .delete(orderItemsTable)
          .where(
            and(
              eq(orderItemsTable.orderId, orderId),
              input.orderItemId !== undefined
                ? eq(orderItemsTable.id, input.orderItemId)
                : eq(orderItemsTable.menuItemId, input.itemId),
            ),
          );
        order.items.splice(existingIdx, 1);
      } else {
        const nextQty =
          input.orderItemId !== undefined
            ? input.qty
            : (order.items[existingIdx]?.qty ?? 0) + input.qty;
        await db
          .update(orderItemsTable)
          .set({
            qty: nextQty,
            sugarLevel: input.sugarLevel,
            iceLevel: input.iceLevel,
            note: input.note,
            size: input.size,
            eggQty: input.eggQty ?? 0,
            cheeseQty: input.cheeseQty ?? 0,
            addons,
            unitPrice,
          })
          .where(
            and(
              eq(orderItemsTable.orderId, orderId),
              input.orderItemId !== undefined
                ? eq(orderItemsTable.id, input.orderItemId)
                : eq(orderItemsTable.menuItemId, input.itemId),
            ),
          );
        const target = order.items[existingIdx];
        if (target) {
          target.qty = nextQty;
          target.sugarLevel = input.sugarLevel;
          target.iceLevel = input.iceLevel;
          target.note = input.note;
          target.size = input.size;
          target.eggQty = input.eggQty;
          target.cheeseQty = input.cheeseQty;
          target.addons = addons;
          target.menuItemPrice = unitPrice;
        }
      }
    } else if (input.qty > 0) {
      const [insertedItem] = await db
        .insert(orderItemsTable)
        .values({
          orderId,
          menuItemId: menuItem.id,
          qty: input.qty,
          sugarLevel: input.sugarLevel,
          iceLevel: input.iceLevel,
          note: input.note,
          size: input.size,
          eggQty: input.eggQty ?? 0,
          cheeseQty: input.cheeseQty ?? 0,
          addons,
          unitPrice,
        })
        .returning();
      order.items.push({
        id: insertedItem?.id,
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        menuItemPrice: unitPrice,
        qty: input.qty,
        sugarLevel: input.sugarLevel,
        iceLevel: input.iceLevel,
        note: input.note,
        size: input.size,
        eggQty: input.eggQty,
        cheeseQty: input.cheeseQty,
        addons,
      });
    }

    order.total = calculateTotal(order.items);
    await db
      .update(ordersTable)
      .set({ total: order.total })
      .where(eq(ordersTable.id, orderId));

    return { ok: true, order };
  }

  async clearOrderItems(
    orderId: number,
    input: { userId: string },
  ): Promise<
    | { ok: true; order: Order }
    | {
        ok: false;
        code:
          | "ORDER_NOT_FOUND"
          | "MENU_ITEM_NOT_FOUND"
          | "ORDER_NOT_OWNED"
          | "ORDER_NOT_EDITABLE";
      }
  > {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
    if (order.userId !== input.userId)
      return { ok: false, code: "ORDER_NOT_OWNED" };
    if (order.status !== "pending")
      return { ok: false, code: "ORDER_NOT_EDITABLE" };

    await db
      .delete(orderItemsTable)
      .where(eq(orderItemsTable.orderId, orderId));
    order.items = [];
    order.total = 0;
    await db
      .update(ordersTable)
      .set({ total: 0 })
      .where(eq(ordersTable.id, orderId));

    return { ok: true, order };
  }

  async submitOrder(
    orderId: number,
    input: {
      userId: string;
      paymentMethod?: "cash" | "card";
      note?: string;
      couponCode?: string;
      storeCode?: string;
      customerName?: string;
      customerPhone?: string;
      pickupTime?: string;
    },
  ): Promise<
    | { ok: true; order: Order }
    | {
        ok: false;
        code:
          | "ORDER_NOT_FOUND"
          | "ORDER_NOT_OWNED"
          | "ORDER_NOT_EDITABLE"
          | "EMPTY_ORDER"
          | "MENU_VERSION_STALE"
          | "COUPON_NOT_AVAILABLE";
        staleItems?: StaleCartItem[];
      }
  > {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
    if (order.userId !== input.userId)
      return { ok: false, code: "ORDER_NOT_OWNED" };
    if (order.status !== "pending")
      return { ok: false, code: "ORDER_NOT_EDITABLE" };
    if (order.items.length === 0) return { ok: false, code: "EMPTY_ORDER" };

    const validation = await menuRepository.validateMenuItemsAreCurrent(
      order.items.map((item) => item.menuItemId),
    );
    if (!validation.valid) {
      const qtyById = new Map(
        order.items.map((item) => [item.menuItemId, item.qty]),
      );
      return {
        ok: false,
        code: "MENU_VERSION_STALE",
        staleItems: validation.staleItems.map((item) => ({
          ...item,
          qty: qtyById.get(item.menuItemId) ?? item.qty,
        })),
      };
    }

    const submittedAt = new Date().toISOString();
    const storeCode = input.storeCode?.trim() || order.storeCode || "default";
    const dailySequence = this.nextDailySequence(storeCode);
    const coupon = input.couponCode
      ? this.coupons.find(
          (item) => item.code === input.couponCode && item.isActive,
        )
      : undefined;
    if (input.couponCode && !this.canUseCoupon(coupon, order, input.userId)) {
      return { ok: false, code: "COUPON_NOT_AVAILABLE" };
    }
    const discountTotal = coupon
      ? coupon.discountType === "percent"
        ? Math.min(
            coupon.maxDiscount && coupon.maxDiscount > 0
              ? coupon.maxDiscount
              : order.total,
            Math.floor((order.total * (100 - coupon.discountValue)) / 100),
          )
        : Math.min(order.total, coupon.discountValue)
      : 0;
    order.total = Math.max(0, order.total - discountTotal);
    await db
      .update(ordersTable)
      .set({
        status: "submitted",
        dailySequence,
        total: order.total,
        paymentMethod: input.paymentMethod ?? "cash",
        note: input.note,
        couponCode: coupon?.code,
        storeCode,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        pickupTime: input.pickupTime,
        discountTotal,
        submittedAt: new Date(submittedAt),
      })
      .where(eq(ordersTable.id, orderId));

    order.status = "submitted";
    order.dailySequence = dailySequence;
    order.paymentMethod = input.paymentMethod ?? "cash";
    order.note = input.note;
    order.couponCode = coupon?.code;
    order.storeCode = storeCode;
    order.customerName = input.customerName;
    order.customerPhone = input.customerPhone;
    order.pickupTime = input.pickupTime;
    order.discountTotal = discountTotal;
    order.submittedAt = submittedAt;

    return { ok: true, order };
  }

  async completeOrder(orderId: number): Promise<Order | null> {
    const completedAt = new Date().toISOString();
    const [updated] = await db
      .update(ordersTable)
      .set({ status: "completed", completedAt: new Date(completedAt) })
      .where(
        and(eq(ordersTable.id, orderId), eq(ordersTable.status, "submitted")),
      )
      .returning();
    if (!updated) return null;

    const order = this.orders.find((o) => o.id === orderId);
    if (!order) {
      await this.reloadFromDatabase();
      return this.orders.find((o) => o.id === orderId) ?? null;
    }
    order.status = "completed";
    order.completedAt = completedAt;
    return order;
  }

  async reopenOrder(orderId: number): Promise<Order | null> {
    const [updated] = await db
      .update(ordersTable)
      .set({ status: "submitted", completedAt: null })
      .where(
        and(eq(ordersTable.id, orderId), eq(ordersTable.status, "completed")),
      )
      .returning();

    if (!updated) return null;

    const order = this.orders.find((o) => o.id === orderId);
    if (!order) {
      await this.reloadFromDatabase();
      return this.orders.find((o) => o.id === orderId) ?? null;
    }
    order.status = "submitted";
    order.completedAt = undefined;
    return order;
  }

  async pickUpOrder(orderId: number): Promise<Order | null> {
    const pickedUpAt = new Date().toISOString();
    const [updated] = await db
      .update(ordersTable)
      .set({ status: "picked_up", pickedUpAt: new Date(pickedUpAt) })
      .where(
        and(eq(ordersTable.id, orderId), eq(ordersTable.status, "completed")),
      )
      .returning();
    if (!updated) return null;

    const order = this.orders.find((o) => o.id === orderId);
    if (!order) {
      await this.reloadFromDatabase();
      return this.orders.find((o) => o.id === orderId) ?? null;
    }
    order.status = "picked_up";
    order.pickedUpAt = pickedUpAt;
    return order;
  }

  getCoupons(): ReadonlyArray<Coupon> {
    return this.coupons;
  }

  async createCoupon(input: Coupon): Promise<Coupon> {
    const [row] = await db
      .insert(couponsTable)
      .values({
        ...input,
        code: input.code,
        minSpend: input.minSpend ?? 0,
        maxDiscount: input.maxDiscount ?? 0,
        usageLimitPerUser: input.usageLimitPerUser ?? 1,
        usageLimitTotal: input.usageLimitTotal ?? 0,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .onConflictDoUpdate({
        target: couponsTable.code,
        set: {
          name: input.name,
          discountType: input.discountType,
          discountValue: input.discountValue,
          minSpend: input.minSpend ?? 0,
          maxDiscount: input.maxDiscount ?? 0,
          usageLimitPerUser: input.usageLimitPerUser ?? 1,
          usageLimitTotal: input.usageLimitTotal ?? 0,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          isActive: input.isActive,
        },
      })
      .returning();

    await this.reloadCoupons();
    return {
      code: row?.code ?? input.code,
      name: row?.name ?? input.name,
      discountType: row?.discountType === "percent" ? "percent" : "amount",
      discountValue: row?.discountValue ?? input.discountValue,
      minSpend: row?.minSpend ?? input.minSpend ?? 0,
      maxDiscount: row?.maxDiscount ?? input.maxDiscount ?? 0,
      usageLimitPerUser: row?.usageLimitPerUser ?? input.usageLimitPerUser ?? 1,
      usageLimitTotal: row?.usageLimitTotal ?? input.usageLimitTotal ?? 0,
      startsAt: row?.startsAt?.toISOString() ?? input.startsAt,
      expiresAt: row?.expiresAt?.toISOString() ?? input.expiresAt,
      isActive: row?.isActive ?? input.isActive,
    };
  }

  async deleteCoupon(code: string): Promise<Coupon | null> {
    const coupon = this.coupons.find((item) => item.code === code);
    if (!coupon) return null;

    await db.delete(couponsTable).where(eq(couponsTable.code, code));
    await this.reloadCoupons();
    return coupon;
  }

  getEmployees(): ReadonlyArray<Employee> {
    return this.employees;
  }

  async upsertEmployee(input: Employee): Promise<Employee> {
    const employee: Employee = {
      employeeId: input.employeeId.trim().toUpperCase(),
      name: input.name.trim(),
      storeCode: input.storeCode.trim(),
      title: input.title.trim() || "店員",
      isActive: input.isActive,
    };
    const index = this.employees.findIndex(
      (item) => item.employeeId === employee.employeeId,
    );
    if (index === -1) {
      this.employees.push(employee);
    } else {
      this.employees[index] = employee;
    }
    return employee;
  }

  private async seedFromJsonIfEmpty(): Promise<void> {
    const [countRow] = await db
      .select({ value: sql<number>`count(*)` })
      .from(menuItemsTable);

    if (Number(countRow?.value ?? 0) > 0) return;

    const file = Bun.file(this.dataFilePath);
    if (!(await file.exists())) return;

    const parsed = JSON.parse(await file.text()) as SeedData;
    const menu = Array.isArray(parsed.menu) ? parsed.menu : [];

    for (const [index, item] of menu.entries()) {
      if (!item.name || item.price === undefined || !item.category) continue;
      await menuRepository.createMenuItem({
        logicalId: logicalIdFromSeedId(item.id, index),
        name: item.name,
        price: item.price,
        largePrice: item.largePrice,
        eggPrice: item.eggPrice,
        cheesePrice: item.cheesePrice,
        category: item.category,
        description: item.description ?? "",
        imageUrl: item.imageUrl ?? item.image_url ?? "",
        createdBy: "seed",
      });
    }
  }

  private async reloadFromDatabase(): Promise<void> {
    await this.reloadAddonSettings();
    this.menu = (await menuRepository.getCurrentMenu()).map((item) =>
      this.withAddonSettings(item),
    );
    await this.reloadCoupons();

    const orderRows = await db
      .select()
      .from(ordersTable)
      .orderBy(desc(ordersTable.createdAt), desc(ordersTable.id));

    const orderItemRows = await db
      .select({
        orderId: orderItemsTable.orderId,
        id: orderItemsTable.id,
        menuItemId: orderItemsTable.menuItemId,
        qty: orderItemsTable.qty,
        sugarLevel: orderItemsTable.sugarLevel,
        iceLevel: orderItemsTable.iceLevel,
        note: orderItemsTable.note,
        size: orderItemsTable.size,
        eggQty: orderItemsTable.eggQty,
        cheeseQty: orderItemsTable.cheeseQty,
        addons: orderItemsTable.addons,
        unitPrice: orderItemsTable.unitPrice,
        menuItemName: menuItemsTable.name,
        menuItemPrice: menuItemsTable.price,
      })
      .from(orderItemsTable)
      .innerJoin(
        menuItemsTable,
        eq(orderItemsTable.menuItemId, menuItemsTable.id),
      )
      .orderBy(asc(orderItemsTable.id));

    const itemsByOrderId = new Map<number, OrderItem[]>();
    for (const row of orderItemRows) {
      const items = itemsByOrderId.get(row.orderId) ?? [];
      items.push({
        id: row.id,
        menuItemId: row.menuItemId,
        menuItemName: row.menuItemName,
        menuItemPrice: row.unitPrice ?? row.menuItemPrice,
        qty: row.qty,
        sugarLevel: row.sugarLevel ?? undefined,
        iceLevel: row.iceLevel ?? undefined,
        note: row.note ?? undefined,
        size: row.size === "large" ? "large" : "small",
        eggQty: row.eggQty,
        cheeseQty: row.cheeseQty,
        addons: (row.addons as OrderItem["addons"] | null) ?? [],
      });
      itemsByOrderId.set(row.orderId, items);
    }

    this.orders = orderRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      items: itemsByOrderId.get(row.id) ?? [],
      total: row.total,
      status:
        row.status === "picked_up"
          ? "picked_up"
          : row.status === "completed"
            ? "completed"
            : row.status === "submitted"
              ? "submitted"
              : "pending",
      dailySequence: row.dailySequence ?? undefined,
      paymentMethod:
        row.paymentMethod === "card" || row.paymentMethod === "cash"
          ? row.paymentMethod
          : undefined,
      note: row.note ?? undefined,
      couponCode: row.couponCode ?? undefined,
      customerName: row.customerName ?? undefined,
      customerPhone: row.customerPhone ?? undefined,
      pickupTime: row.pickupTime ?? undefined,
      discountTotal: row.discountTotal,
      storeCode: row.storeCode,
      createdAt: toIsoString(row.createdAt),
      submittedAt: row.submittedAt ? toIsoString(row.submittedAt) : undefined,
      completedAt: row.completedAt ? toIsoString(row.completedAt) : undefined,
      pickedUpAt: row.pickedUpAt ? toIsoString(row.pickedUpAt) : undefined,
    }));
  }

  private async nextLogicalId(): Promise<string> {
    const [row] = await db
      .select({ logicalId: menuItemsTable.logicalId })
      .from(menuItemsTable)
      .orderBy(desc(menuItemsTable.logicalId))
      .limit(1);

    const next = Number(row?.logicalId ?? "0") + 1;
    return String(next).padStart(3, "0");
  }

  private nextDailySequence(storeCode: string): number {
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Taipei",
    });
    const todayOrders = this.orders.filter((order) => {
      const source = order.submittedAt ?? order.createdAt;
      return (
        new Date(source).toLocaleDateString("sv-SE", {
          timeZone: "Asia/Taipei",
        }) === today &&
        order.dailySequence !== undefined &&
        (order.storeCode ?? "default") === storeCode
      );
    });

    return (
      Math.max(0, ...todayOrders.map((order) => order.dailySequence ?? 0)) + 1
    );
  }

  private async reloadCoupons(): Promise<void> {
    const rows = await db.select().from(couponsTable);
    this.coupons = rows.map((row) => ({
      code: row.code,
      name: row.name,
      discountType: row.discountType === "percent" ? "percent" : "amount",
      discountValue: row.discountValue,
      minSpend: row.minSpend,
      maxDiscount: row.maxDiscount,
      usageLimitPerUser: row.usageLimitPerUser,
      usageLimitTotal: row.usageLimitTotal,
      startsAt: row.startsAt?.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
      isActive: row.isActive,
    }));
  }

  private async ensureCouponRuleColumns(): Promise<void> {
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."coupons"
        ADD COLUMN IF NOT EXISTS "min_spend" integer DEFAULT 0 NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."coupons"
        ADD COLUMN IF NOT EXISTS "max_discount" integer DEFAULT 0 NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."coupons"
        ADD COLUMN IF NOT EXISTS "usage_limit_per_user" integer DEFAULT 1 NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."coupons"
        ADD COLUMN IF NOT EXISTS "usage_limit_total" integer DEFAULT 0 NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."coupons"
        ADD COLUMN IF NOT EXISTS "starts_at" timestamp with time zone
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."coupons"
        ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone
    `);
  }

  private async ensureProductOptionColumns(): Promise<void> {
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."menu_items"
        ADD COLUMN IF NOT EXISTS "large_price" integer
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."menu_items"
        ADD COLUMN IF NOT EXISTS "egg_price" integer
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."menu_items"
        ADD COLUMN IF NOT EXISTS "cheese_price" integer
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."menu_items"
        ADD COLUMN IF NOT EXISTS "addon_keys" jsonb DEFAULT '[]'::jsonb NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."order_items"
        ADD COLUMN IF NOT EXISTS "unit_price" integer
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."order_items"
        ADD COLUMN IF NOT EXISTS "size" text
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."order_items"
        ADD COLUMN IF NOT EXISTS "egg_qty" integer DEFAULT 0 NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."order_items"
        ADD COLUMN IF NOT EXISTS "cheese_qty" integer DEFAULT 0 NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."order_items"
        ADD COLUMN IF NOT EXISTS "addons" jsonb DEFAULT '[]'::jsonb NOT NULL
    `);
  }

  private async ensureAddonSettingsTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${sql.raw(`"${schemaName}"`)}."product_addon_settings" (
        "key" text PRIMARY KEY,
        "name" text DEFAULT '' NOT NULL,
        "price" integer NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."product_addon_settings"
        ADD COLUMN IF NOT EXISTS "name" text DEFAULT '' NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."product_addon_settings"
        ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL
    `);
    await db
      .insert(productAddonSettingsTable)
      .values([
        { key: "egg", name: "加蛋", price: 10, isActive: true },
        { key: "cheese", name: "加起司", price: 10, isActive: true },
      ])
      .onConflictDoNothing();
  }

  private async ensureOrderPickupColumn(): Promise<void> {
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."orders"
      ADD COLUMN IF NOT EXISTS "picked_up_at" timestamp with time zone
    `);
  }

  private async ensureOrderStoreCodeColumn(): Promise<void> {
    await db.execute(sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"`)}."orders"
      ADD COLUMN IF NOT EXISTS "store_code" text DEFAULT 'default' NOT NULL
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "orders_store_status_created_at_idx"
      ON ${sql.raw(`"${schemaName}"`)}."orders" ("store_code", "status", "created_at")
    `);
  }

  private async reloadAddonSettings(): Promise<void> {
    const rows = await db.select().from(productAddonSettingsTable);
    const priceByKey = new Map(rows.map((row) => [row.key, row.price]));
    this.addonSettings = {
      eggPrice: priceByKey.get("egg") ?? 10,
      cheesePrice: priceByKey.get("cheese") ?? 10,
      items: rows
        .filter((row) => row.isActive)
        .map((row) => ({
          key: row.key,
          name:
            row.name ||
            (row.key === "egg"
              ? "加蛋"
              : row.key === "cheese"
                ? "加起司"
                : row.key),
          price: row.price,
          isActive: row.isActive,
        })),
    };
  }

  private withAddonSettings(item: MenuItem): MenuItem {
    return {
      ...item,
      eggPrice:
        item.eggPrice === undefined ? undefined : this.addonSettings.eggPrice,
      cheesePrice:
        item.cheesePrice === undefined
          ? undefined
          : this.addonSettings.cheesePrice,
    };
  }

  private canUseCoupon(
    coupon: Coupon | undefined,
    order: Order,
    userId: string,
  ): coupon is Coupon {
    if (!coupon || !coupon.isActive) return false;
    if ((coupon.minSpend ?? 0) > order.total) return false;
    if (coupon.startsAt && new Date(coupon.startsAt).getTime() > Date.now()) {
      return false;
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
      return false;
    }
    const totalUsedCount = this.orders.filter(
      (item) => item.status !== "pending" && item.couponCode === coupon.code,
    ).length;
    const usageLimitTotal = coupon.usageLimitTotal ?? 0;
    if (usageLimitTotal > 0 && totalUsedCount >= usageLimitTotal) {
      return false;
    }

    const usedCount = this.orders.filter(
      (item) =>
        item.userId === userId &&
        item.status !== "pending" &&
        item.couponCode === coupon.code,
    ).length;
    return usedCount < (coupon.usageLimitPerUser ?? 1);
  }
}

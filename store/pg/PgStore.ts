import { and, asc, desc, eq, sql } from "drizzle-orm";
import type {
  MenuItem,
  Order,
  OrderItem,
  StaleCartItem,
} from "../../shared/contracts.ts";
import { db } from "../../db/client.ts";
import { menuRepository } from "../../db/repositories/menuRepository.ts";
import {
  menuItemsTable,
  orderItemsTable,
  ordersTable,
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

function calculateTotal(items: ReadonlyArray<OrderItem>): number {
  return items.reduce(
    (sum, item) => sum + item.menuItemPrice * item.qty,
    0,
  );
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function logicalIdFromSeedId(id: string | number | undefined, index: number) {
  if (typeof id === "number") return String(id).padStart(3, "0");
  if (typeof id === "string" && /^\d+$/.test(id)) {
    return id.padStart(3, "0");
  }
  return String(index + 1).padStart(3, "0");
}

export class PgStore implements Store {
  private readonly dataFilePath: string;
  private menu: MenuItem[] = [];
  private orders: Order[] = [];

  constructor(options: PgStoreOptions = {}) {
    this.dataFilePath = options.dataFilePath ?? "./data/store.json";
  }

  async init(): Promise<void> {
    await db.execute(sql`select 1`);
    await this.seedFromJsonIfEmpty();
    await this.reloadFromDatabase();
  }

  getMenu(): ReadonlyArray<MenuItem> {
    return this.menu;
  }

  async createMenuItem(input: {
    logicalId?: string;
    name: string;
    price: number;
    category: string;
    description: string;
    imageUrl: string;
    createdBy?: string;
  }): Promise<MenuItem> {
    const logicalId = input.logicalId ?? (await this.nextLogicalId());
    const created = await menuRepository.createMenuItem({
      ...input,
      logicalId,
    });

    this.menu.push(created);
    this.menu.sort((a, b) => a.logicalId.localeCompare(b.logicalId));
    return created;
  }

  async updateMenuItem(
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
  ): Promise<MenuItem | null> {
    const updated = await menuRepository.updateMenuItem(
      menuId,
      patch.changes,
      patch.reason,
      patch.versionLevel,
      patch.userId,
    );

    if (!updated) return null;
    this.menu = await menuRepository.getCurrentMenu();
    return updated;
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

    this.menu = await menuRepository.getCurrentMenu();
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
      .filter((o) => o.userId === userId && o.status === "submitted")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getOrderById(orderId: number): Order | undefined {
    return this.orders.find((o) => o.id === orderId);
  }

  async createOrder(input: { userId: string }): Promise<Order> {
    const existingOrder = this.getCurrentOrderByUserId(input.userId);
    if (existingOrder) return existingOrder;

    const createdAt = new Date();
    const [inserted] = await db
      .insert(ordersTable)
      .values({ userId: input.userId, status: "pending", total: 0, createdAt })
      .returning();

    if (!inserted) throw new Error("Failed to create order");

    const order: Order = {
      id: inserted.id,
      userId: input.userId,
      items: [],
      total: inserted.total,
      status: "pending",
      createdAt: toIsoString(inserted.createdAt),
    };

    this.orders.push(order);
    return order;
  }

  async updateOrderItem(
    orderId: number,
    input: { userId: string; itemId: string; qty: number },
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

    const existingIdx = order.items.findIndex(
      (item) => item.menuItemId === input.itemId,
    );

    if (existingIdx !== -1) {
      if (input.qty === 0) {
        await db
          .delete(orderItemsTable)
          .where(
            and(
              eq(orderItemsTable.orderId, orderId),
              eq(orderItemsTable.menuItemId, input.itemId),
            ),
          );
        order.items.splice(existingIdx, 1);
      } else {
        await db
          .update(orderItemsTable)
          .set({ qty: input.qty })
          .where(
            and(
              eq(orderItemsTable.orderId, orderId),
              eq(orderItemsTable.menuItemId, input.itemId),
            ),
          );
        const target = order.items[existingIdx];
        if (target) target.qty = input.qty;
      }
    } else if (input.qty > 0) {
      await db.insert(orderItemsTable).values({
        orderId,
        menuItemId: menuItem.id,
        qty: input.qty,
      });
      order.items.push({
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        menuItemPrice: menuItem.price,
        qty: input.qty,
      });
    }

    order.total = calculateTotal(order.items);
    await db
      .update(ordersTable)
      .set({ total: order.total })
      .where(eq(ordersTable.id, orderId));

    return { ok: true, order };
  }

  async submitOrder(
    orderId: number,
    input: { userId: string },
  ): Promise<
    | { ok: true; order: Order }
    | {
        ok: false;
        code:
          | "ORDER_NOT_FOUND"
          | "ORDER_NOT_OWNED"
          | "ORDER_NOT_EDITABLE"
          | "EMPTY_ORDER"
          | "MENU_VERSION_STALE";
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
    await db
      .update(ordersTable)
      .set({ status: "submitted", submittedAt: new Date(submittedAt) })
      .where(eq(ordersTable.id, orderId));

    order.status = "submitted";
    order.submittedAt = submittedAt;

    return { ok: true, order };
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
        category: item.category,
        description: item.description ?? "",
        imageUrl: item.imageUrl ?? item.image_url ?? "",
        createdBy: "seed",
      });
    }
  }

  private async reloadFromDatabase(): Promise<void> {
    this.menu = await menuRepository.getCurrentMenu();

    const orderRows = await db
      .select()
      .from(ordersTable)
      .orderBy(desc(ordersTable.createdAt), desc(ordersTable.id));

    const orderItemRows = await db
      .select({
        orderId: orderItemsTable.orderId,
        menuItemId: orderItemsTable.menuItemId,
        qty: orderItemsTable.qty,
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
        menuItemId: row.menuItemId,
        menuItemName: row.menuItemName,
        menuItemPrice: row.menuItemPrice,
        qty: row.qty,
      });
      itemsByOrderId.set(row.orderId, items);
    }

    this.orders = orderRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      items: itemsByOrderId.get(row.id) ?? [],
      total: row.total,
      status: row.status === "submitted" ? "submitted" : "pending",
      createdAt: toIsoString(row.createdAt),
      submittedAt: row.submittedAt ? toIsoString(row.submittedAt) : undefined,
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
}

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../client.ts";
import {
  menuDisplayOrderTable,
  menuItemsTable,
  orderItemsTable,
  ordersTable,
  promotionsTable,
} from "../schema.ts";
import type {
  ActivePromotion,
  MenuItem,
  PriceSensitivity,
  StaleCartItem,
} from "../../shared/contracts.ts";

type MenuRow = typeof menuItemsTable.$inferSelect;

function fallbackTranslations(
  name: string,
  description: string,
): NonNullable<MenuItem["translations"]> {
  return {
    "zh-TW": { name, description },
    en: { name, description },
    ja: { name, description },
    ko: { name, description },
  };
}

export interface MenuItemChanges {
  name?: string;
  price?: number;
  category?: string;
  description?: string;
  imageUrl?: string;
  translations?: MenuItem["translations"];
  testGroup?: string;
}

function toMenuItem(row: MenuRow): MenuItem {
  const translations = row.translations as MenuItem["translations"] | null;
  return {
    id: row.id,
    entityId: row.entityId,
    logicalId: row.logicalId,
    version: row.version,
    majorVersion: row.majorVersion,
    minorVersion: row.minorVersion,
    name: row.name,
    price: row.price,
    category: row.category,
    description: row.description,
    translations: translations ?? fallbackTranslations(row.name, row.description),
    imageUrl: row.imageUrl,
    isCurrentVersion: row.isCurrentVersion,
    testGroup: row.testGroup,
  };
}

function toPromotion(
  row: typeof promotionsTable.$inferSelect,
): ActivePromotion {
  return {
    id: row.id,
    name: row.name,
    menuItemLogicalId: row.menuItemLogicalId,
    discountType: row.discountType === "percent" ? "percent" : "amount",
    discountValue: row.discountValue,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  };
}

function versionedId(logicalId: string, version: number): string {
  return `${logicalId}-${String(version).padStart(2, "0")}`;
}

export class MenuRepository {
  async getCurrentMenu(): Promise<MenuItem[]> {
    const rows = await db
      .select()
      .from(menuItemsTable)
      .where(eq(menuItemsTable.isCurrentVersion, true))
      .orderBy(asc(menuItemsTable.logicalId));

    const displayRows = await db
      .select()
      .from(menuDisplayOrderTable)
      .where(eq(menuDisplayOrderTable.isActive, true))
      .orderBy(asc(menuDisplayOrderTable.displayOrder));
    const orderByLogicalId = new Map(
      displayRows.map((row) => [row.logicalId, row.displayOrder]),
    );

    const promotionRows = await this.getActivePromotionRows();
    const promotionByLogicalId = new Map(
      promotionRows.map((row) => [row.menuItemLogicalId, row]),
    );

    const previousIds = rows
      .map((row) => row.supersedes)
      .filter((id): id is string => Boolean(id));
    const previousRows =
      previousIds.length > 0
        ? await db
            .select()
            .from(menuItemsTable)
            .where(inArray(menuItemsTable.id, previousIds))
        : [];
    const previousById = new Map(previousRows.map((row) => [row.id, row]));

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return rows
      .map((row) => {
        const previous = row.supersedes
          ? previousById.get(row.supersedes)
          : null;
        const priceChanged = Boolean(previous && previous.price !== row.price);
        const activePromotion = promotionByLogicalId.get(row.logicalId);
        const discountType: "amount" | "percent" =
          activePromotion?.discountType === "percent" ? "percent" : "amount";

        return {
          ...toMenuItem(row),
          displayOrder: orderByLogicalId.get(row.logicalId),
          activePromotion: activePromotion
            ? {
                id: activePromotion.id,
                name: activePromotion.name,
                discountType,
                discountValue: activePromotion.discountValue,
              }
            : undefined,
          isRecentlyUpdated: row.createdAt.getTime() >= sevenDaysAgo,
          priceChanged,
          previousPrice: priceChanged ? previous?.price : undefined,
        };
      })
      .sort(
        (a, b) =>
          (a.displayOrder ?? Number.MAX_SAFE_INTEGER) -
            (b.displayOrder ?? Number.MAX_SAFE_INTEGER) ||
          a.logicalId.localeCompare(b.logicalId),
      );
  }

  async getMenuVersion(id: string): Promise<MenuItem | null> {
    const [row] = await db
      .select()
      .from(menuItemsTable)
      .where(eq(menuItemsTable.id, id))
      .limit(1);

    return row ? toMenuItem(row) : null;
  }

  async getMenuVersionHistory(logicalId: string) {
    const rows = await db
      .select()
      .from(menuItemsTable)
      .where(eq(menuItemsTable.logicalId, logicalId))
      .orderBy(desc(menuItemsTable.version));

    return rows.map((row) => ({
      version: row.version,
      majorVersion: row.majorVersion,
      minorVersion: row.minorVersion,
      id: row.id,
      name: row.name,
      price: row.price,
      category: row.category,
      description: row.description,
      imageUrl: row.imageUrl,
      isCurrentVersion: row.isCurrentVersion,
      testGroup: row.testGroup,
      changeReason: row.changeReason,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
    }));
  }

  async createMenuItem(input: {
    logicalId: string;
    name?: string;
    price: number;
    category: string;
    description?: string;
    imageUrl: string;
    translations?: MenuItem["translations"];
    createdBy?: string;
  }): Promise<MenuItem> {
    const now = new Date();
    const zh = input.translations?.["zh-TW"];
    const [inserted] = await db
      .insert(menuItemsTable)
      .values({
        id: versionedId(input.logicalId, 1),
        entityId: crypto.randomUUID(),
        logicalId: input.logicalId,
        version: 1,
        majorVersion: 1,
        minorVersion: 0,
        name: input.name ?? zh?.name ?? "",
        price: input.price,
        category: input.category,
        description: input.description ?? zh?.description ?? "",
        translations: input.translations,
        imageUrl: input.imageUrl,
        isCurrentVersion: true,
        testGroup: "default",
        changeReason: "Initial creation",
        createdAt: now,
        createdBy: input.createdBy,
      })
      .returning();

    if (!inserted) throw new Error("Failed to insert menu item");
    return toMenuItem(inserted);
  }

  async updateMenuItem(
    idOrLogicalId: string,
    changes: MenuItemChanges,
    reason: string,
    versionLevel: "major" | "minor" = "minor",
    userId?: string,
  ): Promise<MenuItem | null> {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(menuItemsTable)
        .where(
          and(
            eq(menuItemsTable.isCurrentVersion, true),
            idOrLogicalId.includes("-")
              ? eq(menuItemsTable.id, idOrLogicalId)
              : eq(menuItemsTable.logicalId, idOrLogicalId),
          ),
        )
        .limit(1);

      if (!current) return null;

      await tx
        .update(menuItemsTable)
        .set({ isCurrentVersion: false })
        .where(eq(menuItemsTable.id, current.id));

      const nextVersion = current.version + 1;
      const nextMajorVersion =
        versionLevel === "major"
          ? current.majorVersion + 1
          : current.majorVersion;
      const nextMinorVersion =
        versionLevel === "major" ? 0 : current.minorVersion + 1;
      const nextTranslations =
        changes.translations ?? (current.translations as MenuItem["translations"]);
      const zh = nextTranslations?.["zh-TW"];
      const [inserted] = await tx
        .insert(menuItemsTable)
        .values({
          id: versionedId(current.logicalId, nextVersion),
          entityId: current.entityId,
          logicalId: current.logicalId,
          version: nextVersion,
          majorVersion: nextMajorVersion,
          minorVersion: nextMinorVersion,
          name: changes.name ?? zh?.name ?? current.name,
          price: changes.price ?? current.price,
          category: changes.category ?? current.category,
          description: changes.description ?? zh?.description ?? current.description,
          translations: nextTranslations,
          imageUrl: changes.imageUrl ?? current.imageUrl,
          isCurrentVersion: true,
          supersedes: current.id,
          testGroup: changes.testGroup ?? current.testGroup,
          changeReason: reason,
          createdBy: userId,
        })
        .returning();

      if (!inserted) throw new Error("Failed to insert menu item version");
      return toMenuItem(inserted);
    });
  }

  async updateDisplayOrder(
    items: { logicalId: string; displayOrder: number }[],
  ): Promise<void> {
    if (items.length === 0) return;

    await db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .insert(menuDisplayOrderTable)
          .values({
            logicalId: item.logicalId,
            displayOrder: item.displayOrder,
            isActive: true,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: menuDisplayOrderTable.logicalId,
            set: {
              displayOrder: item.displayOrder,
              isActive: true,
              updatedAt: new Date(),
            },
          });
      }
    });
  }

  async getActivePromotions(): Promise<ActivePromotion[]> {
    const rows = await this.getActivePromotionRows();
    return rows.map(toPromotion);
  }

  async getPriceSensitivity(): Promise<PriceSensitivity[]> {
    const rows = await db
      .select({
        logicalId: menuItemsTable.logicalId,
        name: menuItemsTable.name,
        version: menuItemsTable.version,
        majorVersion: menuItemsTable.majorVersion,
        minorVersion: menuItemsTable.minorVersion,
        testGroup: menuItemsTable.testGroup,
        price: menuItemsTable.price,
        totalQty: sql<number>`coalesce(sum(${orderItemsTable.qty}), 0)`,
        totalRevenue: sql<number>`coalesce(sum(${orderItemsTable.qty} * ${menuItemsTable.price}), 0)`,
      })
      .from(orderItemsTable)
      .innerJoin(
        menuItemsTable,
        eq(orderItemsTable.menuItemId, menuItemsTable.id),
      )
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(eq(ordersTable.status, "submitted"))
      .groupBy(
        menuItemsTable.logicalId,
        menuItemsTable.name,
        menuItemsTable.version,
        menuItemsTable.majorVersion,
        menuItemsTable.minorVersion,
        menuItemsTable.testGroup,
        menuItemsTable.price,
      )
      .orderBy(desc(sql<number>`sum(${orderItemsTable.qty})`));

    return rows.map((row) => ({
      ...row,
      totalQty: Number(row.totalQty),
      totalRevenue: Number(row.totalRevenue),
    }));
  }

  private async getActivePromotionRows(): Promise<
    (typeof promotionsTable.$inferSelect)[]
  > {
    const now = new Date();
    return await db
      .select()
      .from(promotionsTable)
      .where(
        and(
          eq(promotionsTable.isActive, true),
          lte(promotionsTable.startsAt, now),
          gte(promotionsTable.endsAt, now),
        ),
      )
      .orderBy(asc(promotionsTable.endsAt), asc(promotionsTable.id));
  }

  async validateMenuItemsAreCurrent(menuItemIds: string[]): Promise<{
    valid: boolean;
    outdatedIds: string[];
    staleItems: StaleCartItem[];
  }> {
    const uniqueIds = Array.from(new Set(menuItemIds));
    if (uniqueIds.length === 0) {
      return { valid: true, outdatedIds: [], staleItems: [] };
    }

    const rows = await db
      .select()
      .from(menuItemsTable)
      .where(inArray(menuItemsTable.id, uniqueIds));

    const found = new Set(rows.map((row) => row.id));
    const missingIds = uniqueIds.filter((id) => !found.has(id));
    const outdatedRows = rows.filter((row) => !row.isCurrentVersion);
    const outdatedIds = outdatedRows.map((row) => row.id);
    const currentRows =
      outdatedRows.length > 0
        ? await db
            .select()
            .from(menuItemsTable)
            .where(
              inArray(
                menuItemsTable.logicalId,
                outdatedRows.map((row) => row.logicalId),
              ),
            )
        : [];
    const currentByLogicalId = new Map(
      currentRows
        .filter((row) => row.isCurrentVersion)
        .map((row) => [row.logicalId, row]),
    );
    const staleItems = outdatedRows.map((row) => {
      const current = currentByLogicalId.get(row.logicalId);
      return {
        menuItemId: row.id,
        menuItemName: row.name,
        menuItemPrice: row.price,
        qty: 0,
        currentMenuItemId: current?.id,
        currentMenuItemName: current?.name,
        currentMenuItemPrice: current?.price,
      };
    });

    return {
      valid: missingIds.length === 0 && outdatedIds.length === 0,
      outdatedIds: [...missingIds, ...outdatedIds],
      staleItems,
    };
  }
}

export const menuRepository = new MenuRepository();

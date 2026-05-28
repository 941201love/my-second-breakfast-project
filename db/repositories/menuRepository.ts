import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../client.ts";
import { menuItemsTable } from "../schema.ts";
import type { MenuItem } from "../../shared/contracts.ts";

type MenuRow = typeof menuItemsTable.$inferSelect;

export interface MenuItemChanges {
  name?: string;
  price?: number;
  category?: string;
  description?: string;
  imageUrl?: string;
}

function toMenuItem(row: MenuRow): MenuItem {
  return {
    id: row.id,
    entityId: row.entityId,
    logicalId: row.logicalId,
    version: row.version,
    name: row.name,
    price: row.price,
    category: row.category,
    description: row.description,
    imageUrl: row.imageUrl,
    isCurrentVersion: row.isCurrentVersion,
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

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return rows.map((row) => ({
      ...toMenuItem(row),
      isRecentlyUpdated: row.createdAt.getTime() >= sevenDaysAgo,
    }));
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
      id: row.id,
      name: row.name,
      price: row.price,
      changeReason: row.changeReason,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
    }));
  }

  async createMenuItem(input: {
    logicalId: string;
    name: string;
    price: number;
    category: string;
    description: string;
    imageUrl: string;
    createdBy?: string;
  }): Promise<MenuItem> {
    const now = new Date();
    const [inserted] = await db
      .insert(menuItemsTable)
      .values({
        id: versionedId(input.logicalId, 1),
        entityId: crypto.randomUUID(),
        logicalId: input.logicalId,
        version: 1,
        name: input.name,
        price: input.price,
        category: input.category,
        description: input.description,
        imageUrl: input.imageUrl,
        isCurrentVersion: true,
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
      const [inserted] = await tx
        .insert(menuItemsTable)
        .values({
          id: versionedId(current.logicalId, nextVersion),
          entityId: current.entityId,
          logicalId: current.logicalId,
          version: nextVersion,
          name: changes.name ?? current.name,
          price: changes.price ?? current.price,
          category: changes.category ?? current.category,
          description: changes.description ?? current.description,
          imageUrl: changes.imageUrl ?? current.imageUrl,
          isCurrentVersion: true,
          supersedes: current.id,
          changeReason: reason,
          createdBy: userId,
        })
        .returning();

      if (!inserted) throw new Error("Failed to insert menu item version");
      return toMenuItem(inserted);
    });
  }

  async validateMenuItemsAreCurrent(menuItemIds: string[]): Promise<{
    valid: boolean;
    outdatedIds: string[];
  }> {
    const uniqueIds = Array.from(new Set(menuItemIds));
    if (uniqueIds.length === 0) return { valid: true, outdatedIds: [] };

    const rows = await db
      .select({
        id: menuItemsTable.id,
        isCurrentVersion: menuItemsTable.isCurrentVersion,
      })
      .from(menuItemsTable)
      .where(inArray(menuItemsTable.id, uniqueIds));

    const found = new Set(rows.map((row) => row.id));
    const missingIds = uniqueIds.filter((id) => !found.has(id));
    const outdatedIds = rows
      .filter((row) => !row.isCurrentVersion)
      .map((row) => row.id);

    return {
      valid: missingIds.length === 0 && outdatedIds.length === 0,
      outdatedIds: [...missingIds, ...outdatedIds],
    };
  }
}

export const menuRepository = new MenuRepository();

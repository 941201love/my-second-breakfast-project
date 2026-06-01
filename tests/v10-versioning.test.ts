import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonFileStore } from "../store/json/JsonFileStore.ts";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "breakfast-v10-"));
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("menu updates create a new current version", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const before = store.getMenu()[0];
  expect(before).toBeDefined();

  const updated = await store.updateMenuItem(before!.id, {
    changes: { price: before!.price + 5 },
    reason: "price adjustment",
    userId: "tester",
  });

  expect(updated).not.toBeNull();
  expect(updated!.logicalId).toBe(before!.logicalId);
  expect(updated!.version).toBe(before!.version + 1);
  expect(updated!.majorVersion).toBe(before!.majorVersion);
  expect(updated!.minorVersion).toBe(before!.minorVersion + 1);
  expect(updated!.isCurrentVersion).toBe(true);
  expect(store.getMenu().filter((item) => item.isCurrentVersion)).toHaveLength(
    4,
  );
});

test("major menu updates reset the minor version and keep test group", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const before = store.getMenu()[0];
  expect(before).toBeDefined();

  const updated = await store.updateMenuItem(before!.id, {
    changes: { testGroup: "variant-a" },
    reason: "A/B test",
    versionLevel: "major",
    userId: "tester",
  });

  expect(updated).not.toBeNull();
  expect(updated!.majorVersion).toBe(before!.majorVersion + 1);
  expect(updated!.minorVersion).toBe(0);
  expect(updated!.testGroup).toBe("variant-a");
});

test("menu content edits create a translated current version", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const before = store.getMenu()[0]!;
  const translations = {
    "zh-TW": { name: "新版吐司", description: "中文介紹" },
    en: { name: "New Toast", description: "English description" },
    ja: { name: "新しいトースト", description: "日本語の紹介" },
    ko: { name: "새 토스트", description: "한국어 소개" },
  };

  const updated = await store.updateMenuItem(before.id, {
    changes: {
      category: "吐司",
      imageUrl: "/imgs/menu/new-toast.webp",
      translations,
    },
    reason: "content refresh",
    userId: "tester",
  });

  expect(updated).not.toBeNull();
  expect(updated!.name).toBe("新版吐司");
  expect(updated!.description).toBe("中文介紹");
  expect(updated!.translations).toEqual(translations);
  expect(updated!.category).toBe("吐司");
  expect(updated!.imageUrl).toBe("/imgs/menu/new-toast.webp");
  expect(before.name).not.toBe(updated!.name);
});

test("submitting an order with a stale menu version is rejected", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const item = store.getMenu()[0]!;
  const order = await store.createOrder({ userId: "user-1" });
  const cartResult = await store.updateOrderItem(order.id, {
    userId: "user-1",
    itemId: item.id,
    qty: 1,
  });
  expect(cartResult.ok).toBe(true);

  await store.updateMenuItem(item.id, {
    changes: { price: item.price + 10 },
    reason: "new price",
    userId: "tester",
  });

  const submitResult = await store.submitOrder(order.id, { userId: "user-1" });
  expect(submitResult.ok).toBe(false);
  if (!submitResult.ok) {
    expect(submitResult.code).toBe("MENU_VERSION_STALE");
    expect(submitResult.staleItems).toHaveLength(1);
    expect(submitResult.staleItems?.[0]?.menuItemId).toBe(item.id);
    expect(submitResult.staleItems?.[0]?.qty).toBe(1);
    expect(submitResult.staleItems?.[0]?.currentMenuItemPrice).toBe(
      item.price + 10,
    );
  }
});

test("checkout contact details are stored on submitted orders", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const item = store.getMenu()[0]!;
  const order = await store.createOrder({ userId: "user-1" });
  await store.updateOrderItem(order.id, {
    userId: "user-1",
    itemId: item.id,
    qty: 1,
  });

  const submitResult = await store.submitOrder(order.id, {
    userId: "user-1",
    paymentMethod: "cash",
    customerName: "小翔",
    customerPhone: "0912345678",
    pickupTime: "08:30",
  });

  expect(submitResult.ok).toBe(true);
  if (submitResult.ok) {
    expect(submitResult.order.customerName).toBe("小翔");
    expect(submitResult.order.customerPhone).toBe("0912345678");
    expect(submitResult.order.pickupTime).toBe("08:30");
  }
});

test("cart can keep separate option lines and clear all items", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const item = store.getMenu()[0]!;
  const order = await store.createOrder({ userId: "user-1" });

  const firstLine = await store.updateOrderItem(order.id, {
    userId: "user-1",
    itemId: item.id,
    qty: 1,
    sugarLevel: "無糖",
    iceLevel: "正常冰",
    forceNew: true,
  });
  expect(firstLine.ok).toBe(true);

  const secondLine = await store.updateOrderItem(order.id, {
    userId: "user-1",
    itemId: item.id,
    qty: 1,
    sugarLevel: "半糖",
    iceLevel: "微冰",
    forceNew: true,
  });
  expect(secondLine.ok).toBe(true);
  if (secondLine.ok) {
    expect(secondLine.order.items).toHaveLength(2);
  }

  const cleared = await store.clearOrderItems(order.id, { userId: "user-1" });
  expect(cleared.ok).toBe(true);
  if (cleared.ok) {
    expect(cleared.order.items).toHaveLength(0);
    expect(cleared.order.total).toBe(0);
  }
});

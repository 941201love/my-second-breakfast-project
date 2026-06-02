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

test("cart snapshots size and egg extras into the order price", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const item = store.getMenu()[0]!;
  const configured = await store.updateMenuItem(item.id, {
    changes: {
      largePrice: item.price + 15,
      eggPrice: 10,
      cheesePrice: 10,
    },
    reason: "add product options",
    userId: "tester",
  });
  expect(configured).not.toBeNull();

  const order = await store.createOrder({ userId: "user-1" });
  const added = await store.updateOrderItem(order.id, {
    userId: "user-1",
    itemId: configured!.id,
    qty: 2,
    size: "large",
    eggQty: 2,
    cheeseQty: 1,
    forceNew: true,
  });

  expect(added.ok).toBe(true);
  if (!added.ok) return;
  expect(added.order.items[0]?.menuItemPrice).toBe(item.price + 45);
  expect(added.order.total).toBe((item.price + 45) * 2);

  const line = added.order.items[0]!;
  const changed = await store.updateOrderItem(order.id, {
    userId: "user-1",
    itemId: configured!.id,
    orderItemId: line.id,
    qty: 2,
    size: "small",
    eggQty: 1,
    cheeseQty: 2,
  });

  expect(changed.ok).toBe(true);
  if (!changed.ok) return;
  expect(changed.order.items[0]?.menuItemPrice).toBe(item.price + 30);
  expect(changed.order.total).toBe((item.price + 30) * 2);
});

test("shared addon prices update all eligible products without editing them", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const item = store.getMenu()[0]!;
  const configured = await store.updateMenuItem(item.id, {
    changes: { eggPrice: 10, cheesePrice: 10 },
    reason: "allow shared addons",
    userId: "tester",
  });
  expect(configured).not.toBeNull();

  await store.updateAddonSettings({ eggPrice: 15, cheesePrice: 10 });
  const refreshed = store.getMenu().find((entry) => entry.id === configured!.id);
  expect(refreshed?.eggPrice).toBe(15);

  const order = await store.createOrder({ userId: "user-1" });
  const added = await store.updateOrderItem(order.id, {
    userId: "user-1",
    itemId: configured!.id,
    qty: 1,
    eggQty: 2,
    cheeseQty: 1,
  });

  expect(added.ok).toBe(true);
  if (added.ok) {
    expect(added.order.items[0]?.menuItemPrice).toBe(item.price + 40);
    expect(added.order.total).toBe(item.price + 40);
  }
});

test("custom addon snapshots keep the charged price after later price changes", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const item = store.getMenu()[0]!;
  await store.updateAddonSettings({
    eggPrice: 10,
    cheesePrice: 10,
    items: [{ key: "bacon", name: "培根", price: 15, isActive: true }],
  });
  const configured = await store.updateMenuItem(item.id, {
    changes: { addonKeys: ["bacon"] },
    reason: "allow bacon",
    userId: "tester",
  });
  expect(configured).not.toBeNull();

  const order = await store.createOrder({ userId: "user-1" });
  const added = await store.updateOrderItem(order.id, {
    userId: "user-1",
    itemId: configured!.id,
    qty: 1,
    addons: [{ key: "bacon", name: "培根", price: 15, qty: 2 }],
  });
  expect(added.ok).toBe(true);
  if (!added.ok) return;
  expect(added.order.total).toBe(item.price + 30);

  await store.updateAddonSettings({
    eggPrice: 10,
    cheesePrice: 10,
    items: [{ key: "bacon", name: "培根", price: 20, isActive: true }],
  });
  expect(added.order.items[0]?.addons?.[0]?.price).toBe(15);
  expect(added.order.total).toBe(item.price + 30);
});

test("completed orders remain ready for pickup until the customer takes them", async () => {
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

  const submitted = await store.submitOrder(order.id, { userId: "user-1" });
  expect(submitted.ok).toBe(true);
  expect(await store.pickUpOrder(order.id)).toBeNull();

  const completed = await store.completeOrder(order.id);
  expect(completed?.status).toBe("completed");
  expect(completed?.completedAt).toBeDefined();

  const pickedUp = await store.pickUpOrder(order.id);
  expect(pickedUp?.status).toBe("picked_up");
  expect(pickedUp?.pickedUpAt).toBeDefined();
  expect(await store.pickUpOrder(order.id)).toBeNull();
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonFileStore } from "../store/json/JsonFileStore.ts";
import { calculateOrderProgress } from "../order-progress.ts";

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

test("new item showcase is controlled manually", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const created = await store.createMenuItem({
    price: 60,
    category: "吐司",
    imageUrl: "/imgs/menu/showcase-toast.webp",
    isRecentlyUpdated: true,
    translations: {
      "zh-TW": { name: "新品吐司", description: "手動新品展示" },
      en: { name: "Showcase Toast", description: "Manual showcase" },
      ja: { name: "新商品トースト", description: "手動表示" },
      ko: { name: "신상 토스트", description: "수동 표시" },
    },
  });

  expect(created.isRecentlyUpdated).toBe(true);

  const updated = await store.updateMenuItem(created.logicalId, {
    changes: { isRecentlyUpdated: false },
    reason: "turn off showcase",
    userId: "tester",
  });

  expect(updated).not.toBeNull();
  expect(updated!.isRecentlyUpdated).toBe(false);
  expect(
    store.getMenu().find((item) => item.logicalId === created.logicalId)
      ?.isRecentlyUpdated,
  ).toBe(false);
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

test("orders keep their branch code and branch pickup numbers are independent", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const item = store.getMenu()[0]!;
  const taipeiOrder = await store.createOrder({
    userId: "user-taipei",
    storeCode: "taipei",
  });
  const tainanOrder = await store.createOrder({
    userId: "user-tainan",
    storeCode: "tainan",
  });

  await store.updateOrderItem(taipeiOrder.id, {
    userId: "user-taipei",
    itemId: item.id,
    qty: 1,
  });
  await store.updateOrderItem(tainanOrder.id, {
    userId: "user-tainan",
    itemId: item.id,
    qty: 1,
  });

  const taipeiSubmitted = await store.submitOrder(taipeiOrder.id, {
    userId: "user-taipei",
  });
  const tainanSubmitted = await store.submitOrder(tainanOrder.id, {
    userId: "user-tainan",
  });

  expect(taipeiSubmitted.ok).toBe(true);
  expect(tainanSubmitted.ok).toBe(true);
  if (taipeiSubmitted.ok && tainanSubmitted.ok) {
    expect(taipeiSubmitted.order.storeCode).toBe("taipei");
    expect(tainanSubmitted.order.storeCode).toBe("tainan");
    expect(taipeiSubmitted.order.dailySequence).toBe(1);
    expect(tainanSubmitted.order.dailySequence).toBe(1);
  }
});

test("coupon store restrictions are enforced on submit", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  await store.createCoupon({
    code: "TAINANONLY",
    name: "台南限定",
    discountType: "amount",
    discountValue: 10,
    minSpend: 0,
    maxDiscount: 0,
    usageLimitPerUser: 1,
    usageLimitTotal: 0,
    applicableStoreCodes: ["tainan"],
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    isActive: true,
  });

  const item = store.getMenu()[0]!;
  const taipeiOrder = await store.createOrder({
    userId: "user-taipei",
    storeCode: "taipei",
  });
  await store.updateOrderItem(taipeiOrder.id, {
    userId: "user-taipei",
    itemId: item.id,
    qty: 1,
  });

  const rejected = await store.submitOrder(taipeiOrder.id, {
    userId: "user-taipei",
    couponCode: "TAINANONLY",
  });
  expect(rejected.ok).toBe(false);
  if (!rejected.ok) {
    expect(rejected.code).toBe("COUPON_NOT_AVAILABLE");
  }

  const tainanOrder = await store.createOrder({
    userId: "user-tainan",
    storeCode: "tainan",
  });
  await store.updateOrderItem(tainanOrder.id, {
    userId: "user-tainan",
    itemId: item.id,
    qty: 1,
  });

  const accepted = await store.submitOrder(tainanOrder.id, {
    userId: "user-tainan",
    couponCode: "TAINANONLY",
  });
  expect(accepted.ok).toBe(true);
});

test("order progress is filtered by selected branch", () => {
  const today = new Date("2026-06-04T08:00:00+08:00");
  const submittedAt = "2026-06-04T01:30:00.000Z";
  const createdAt = "2026-06-04T01:00:00.000Z";
  const orders = [
    {
      id: 1,
      dailySequence: 4,
      status: "completed",
      storeCode: "taipei",
      createdAt,
      submittedAt,
    },
    {
      id: 2,
      dailySequence: 4,
      status: "submitted",
      storeCode: "tainan",
      createdAt,
      submittedAt,
    },
    {
      id: 3,
      dailySequence: 7,
      status: "completed",
      storeCode: "kaohsiung",
      createdAt,
      submittedAt,
    },
  ];

  expect(
    calculateOrderProgress(orders, { storeCode: "taipei", now: today }),
  ).toMatchObject({
    readyPickupNumbers: [4],
    waitingPickupNumbers: [],
  });
  expect(
    calculateOrderProgress(orders, { storeCode: "tainan", now: today }),
  ).toMatchObject({
    readyPickupNumbers: [],
    waitingPickupNumbers: [4],
  });
  expect(
    calculateOrderProgress(orders, { storeCode: "kaohsiung", now: today }),
  ).toMatchObject({
    readyPickupNumbers: [7],
    waitingPickupNumbers: [],
  });
});

test("same user can keep separate pending carts per branch", async () => {
  const store = new JsonFileStore({
    dataFilePath: join(tempDir, "store.json"),
  });
  await store.init();

  const taipeiOrder = await store.createOrder({
    userId: "user-branch-switch",
    storeCode: "taipei",
  });
  const tainanOrder = await store.createOrder({
    userId: "user-branch-switch",
    storeCode: "tainan",
  });

  expect(taipeiOrder.id).not.toBe(tainanOrder.id);
  expect(taipeiOrder.storeCode).toBe("taipei");
  expect(tainanOrder.storeCode).toBe("tainan");
  expect(
    store.getCurrentOrderByUserId("user-branch-switch", "taipei")?.id,
  ).toBe(taipeiOrder.id);
  expect(
    store.getCurrentOrderByUserId("user-branch-switch", "tainan")?.id,
  ).toBe(tainanOrder.id);
});

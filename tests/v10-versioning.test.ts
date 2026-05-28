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
  expect(updated!.isCurrentVersion).toBe(true);
  expect(store.getMenu().filter((item) => item.isCurrentVersion)).toHaveLength(
    4,
  );
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
  expect(submitResult).toEqual({
    ok: false,
    code: "MENU_VERSION_STALE",
  });
});

import { expect, test } from "bun:test";
import { applyPromotionToPrice } from "../shared/pricing.ts";

test("amount promotions subtract from the menu price", () => {
  expect(
    applyPromotionToPrice(50, {
      discountType: "amount",
      discountValue: 10,
    }),
  ).toBe(40);
});

test("percent promotions use the configured paid ratio", () => {
  expect(
    applyPromotionToPrice(135, {
      discountType: "percent",
      discountValue: 80,
    }),
  ).toBe(108);
});

test("promotions never create negative menu prices", () => {
  expect(
    applyPromotionToPrice(30, {
      discountType: "amount",
      discountValue: 50,
    }),
  ).toBe(0);
});

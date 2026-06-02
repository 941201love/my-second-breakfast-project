export interface PricePromotion {
  discountType: string;
  discountValue: number;
}

export function applyPromotionToPrice(
  price: number,
  promotion?: PricePromotion | null,
): number {
  if (!promotion) return price;

  if (promotion.discountType === "percent") {
    return Math.max(0, Math.floor((price * promotion.discountValue) / 100));
  }

  return Math.max(0, price - promotion.discountValue);
}

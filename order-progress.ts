import type { OrderProgress } from "./shared/contracts.ts";

type ProgressOrder = {
  status: string;
  createdAt: string;
  submittedAt?: string;
  dailySequence?: number;
  id: number;
  storeCode?: string;
};

function taipeiDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("sv-SE", {
    timeZone: "Asia/Taipei",
  });
}

export function calculateOrderProgress(
  orders: ProgressOrder[],
  options: { storeCode?: string | null; now?: Date } = {},
): OrderProgress {
  const today = taipeiDate(options.now ?? new Date());
  const filteredOrders = options.storeCode
    ? orders.filter((order) => (order.storeCode ?? "default") === options.storeCode)
    : orders;
  const isTodayOrder = (order: ProgressOrder) =>
    taipeiDate(order.submittedAt ?? order.createdAt) === today;
  const pickupNumber = (order: ProgressOrder) => order.dailySequence ?? order.id;
  const submittedOrders = filteredOrders.filter(
    (order) => order.status !== "pending" && isTodayOrder(order),
  );
  const completedOrders = filteredOrders.filter(
    (order) =>
      (order.status === "completed" || order.status === "picked_up") &&
      isTodayOrder(order),
  );
  const waitingOrders = filteredOrders.filter(
    (order) => order.status === "submitted" && isTodayOrder(order),
  );
  const readyPickupNumbers = completedOrders
    .filter((order) => order.status === "completed")
    .map(pickupNumber)
    .sort((a, b) => a - b);
  const waitingPickupNumbers = waitingOrders
    .map(pickupNumber)
    .sort((a, b) => a - b);

  return {
    latestSubmittedOrderId:
      submittedOrders.length > 0
        ? Math.max(...submittedOrders.map(pickupNumber))
        : null,
    latestCompletedOrderId:
      completedOrders.length > 0
        ? Math.max(...completedOrders.map(pickupNumber))
        : null,
    waitingCount: waitingOrders.length,
    readyPickupNumbers,
    waitingPickupNumbers,
  };
}

import { mkdir, rename } from "node:fs/promises";
import type {
  AddonSettings,
  MenuItem,
  Order,
  OrderItem,
  StaleCartItem,
  Coupon,
} from "../../shared/contracts.ts";
import type { Store } from "../Store.ts";
import { applyPromotionToPrice } from "../../shared/pricing.ts";

interface StoredUser {
  id: string;
  email: string;
  name: string;
  password: string;
}

interface DataStore {
  users: StoredUser[];
  menu: MenuItem[];
  orders: Order[];
  coupons?: Coupon[];
  addonSettings?: AddonSettings;
  userIdCounter: number;
  menuIdCounter: number;
  orderIdCounter: number;
}

interface JsonFileStoreOptions {
  dataFilePath: string;
}

type LegacyMenuItem = Partial<MenuItem> & {
  id?: number | string;
  image_url?: string;
};

type LegacyOrderItem = Partial<OrderItem> & {
  item?: LegacyMenuItem;
};

const defaultMenu: MenuItem[] = [
  {
    id: "001-01",
    entityId: "json-001",
    logicalId: "001",
    version: 1,
    majorVersion: 1,
    minorVersion: 0,
    name: "火腿蛋吐司",
    price: 40,
    category: "餐點",
    description: "現煎雞蛋搭配火腿與生菜，使用微烤白吐司，口感清爽不油膩。",
    translations: {
      "zh-TW": {
        name: "火腿蛋吐司",
        description: "現煎雞蛋搭配火腿與生菜，使用微烤白吐司，口感清爽不油膩。",
      },
      en: {
        name: "Ham Egg Toast",
        description: "Pan-fried egg with ham and lettuce on lightly toasted white bread.",
      },
      ja: {
        name: "ハムエッグトースト",
        description: "焼き卵、ハム、レタスを軽く焼いた白トーストで挟んだ朝食定番。",
      },
      ko: {
        name: "햄 에그 토스트",
        description: "구운 달걀, 햄, 양상추를 살짝 구운 식빵에 넣은 아침 메뉴입니다.",
      },
    },
    imageUrl: "/imgs/menu/ham-egg-toast.webp",
    isCurrentVersion: true,
    testGroup: "default",
    displayOrder: 1,
  },
  {
    id: "002-01",
    entityId: "json-002",
    logicalId: "002",
    version: 1,
    majorVersion: 1,
    minorVersion: 0,
    name: "起司豬排堡",
    price: 65,
    category: "餐點",
    description: "厚切豬排搭配起司與生菜，外酥內嫩，適合喜歡有咬勁的你。",
    translations: {
      "zh-TW": {
        name: "起司豬排堡",
        description: "厚切豬排搭配起司與生菜，外酥內嫩，適合喜歡有咬勁的你。",
      },
      en: {
        name: "Cheese Pork Cutlet Burger",
        description: "Thick pork cutlet with cheese and lettuce, crisp outside and juicy inside.",
      },
      ja: {
        name: "チーズポークカツバーガー",
        description: "厚切りポークカツにチーズとレタスを合わせた食べ応えのあるバーガー。",
      },
      ko: {
        name: "치즈 돈가스 버거",
        description: "두툼한 돈가스에 치즈와 양상추를 더한 든든한 버거입니다.",
      },
    },
    imageUrl: "/imgs/menu/cheese-pork-burger.webp",
    isCurrentVersion: true,
    testGroup: "default",
    displayOrder: 2,
  },
  {
    id: "003-01",
    entityId: "json-003",
    logicalId: "003",
    version: 1,
    majorVersion: 1,
    minorVersion: 0,
    name: "鮪魚蛋吐司",
    price: 45,
    category: "餐點",
    description: "自調鮪魚沙拉配上煎蛋與生菜，口味濃郁但不會太鹹。",
    translations: {
      "zh-TW": {
        name: "鮪魚蛋吐司",
        description: "自調鮪魚沙拉配上煎蛋與生菜，口味濃郁但不會太鹹。",
      },
      en: {
        name: "Tuna Egg Toast",
        description: "House tuna salad with fried egg and lettuce, rich but not too salty.",
      },
      ja: {
        name: "ツナエッグトースト",
        description: "自家製ツナサラダに卵とレタスを合わせた、濃厚で食べやすいトースト。",
      },
      ko: {
        name: "참치 에그 토스트",
        description: "직접 만든 참치 샐러드에 달걀과 양상추를 더한 고소한 토스트입니다.",
      },
    },
    imageUrl: "/imgs/menu/tuna-egg-toast.webp",
    isCurrentVersion: true,
    testGroup: "default",
    displayOrder: 3,
  },
  {
    id: "004-01",
    entityId: "json-004",
    logicalId: "004",
    version: 1,
    majorVersion: 1,
    minorVersion: 0,
    name: "培根蛋餅",
    price: 45,
    category: "餐點",
    description: "煎到微酥的蛋餅皮包裹煙燻培根與雞蛋，是經典台式早餐選擇。",
    translations: {
      "zh-TW": {
        name: "培根蛋餅",
        description: "煎到微酥的蛋餅皮包裹煙燻培根與雞蛋，是經典台式早餐選擇。",
      },
      en: {
        name: "Bacon Egg Pancake Roll",
        description: "Crisp Taiwanese egg pancake filled with smoked bacon and egg.",
      },
      ja: {
        name: "ベーコン蛋餅",
        description: "香ばしく焼いた台湾風蛋餅にスモークベーコンと卵を包みました。",
      },
      ko: {
        name: "베이컨 단빙",
        description: "바삭하게 구운 대만식 달걀 전병에 훈제 베이컨과 달걀을 넣었습니다.",
      },
    },
    imageUrl: "/imgs/menu/bacon-egg-roll.webp",
    isCurrentVersion: true,
    testGroup: "default",
    displayOrder: 4,
  },
];

function cloneDefaultMenu(): MenuItem[] {
  return defaultMenu.map((item) => ({ ...item }));
}

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

function calculateOrderTotal(items: OrderItem[]): number {
  return items.reduce((sum, orderItem) => {
    return sum + orderItem.menuItemPrice * orderItem.qty;
  }, 0);
}

function logicalIdFromRawId(rawId: number | string | undefined): string {
  if (typeof rawId === "number") return String(rawId).padStart(3, "0");
  if (typeof rawId === "string" && /^\d+$/.test(rawId)) {
    return rawId.padStart(3, "0");
  }
  if (typeof rawId === "string" && rawId.includes("-")) {
    return rawId.split("-")[0] ?? "001";
  }
  return "001";
}

function normalizeMenuItem(item: LegacyMenuItem): MenuItem {
  const logicalId = item.logicalId ?? logicalIdFromRawId(item.id);
  const version = item.version ?? 1;
  return {
    id:
      typeof item.id === "string" && item.id.includes("-")
        ? item.id
        : `${logicalId}-${String(version).padStart(2, "0")}`,
    entityId: item.entityId ?? `json-${logicalId}`,
    logicalId,
    version,
    majorVersion: item.majorVersion ?? 1,
    minorVersion: item.minorVersion ?? Math.max(0, version - 1),
    name: item.name ?? "",
    price: item.price ?? 0,
    largePrice: item.largePrice,
    eggPrice: item.eggPrice,
    cheesePrice: item.cheesePrice,
    addonKeys: item.addonKeys ?? [],
    category: item.category ?? "",
    description: item.description ?? "",
    translations:
      item.translations ?? fallbackTranslations(item.name ?? "", item.description ?? ""),
    imageUrl: item.imageUrl ?? item.image_url ?? "",
    isCurrentVersion: item.isCurrentVersion ?? true,
    testGroup: item.testGroup ?? "default",
    displayOrder: item.displayOrder ?? Number(logicalId),
  };
}

function normalizeOrderItem(orderItem: LegacyOrderItem): OrderItem {
  if (orderItem.menuItemId && orderItem.menuItemName) {
    return {
      menuItemId: orderItem.menuItemId,
      menuItemName: orderItem.menuItemName,
      menuItemPrice: orderItem.menuItemPrice ?? 0,
      qty: orderItem.qty ?? 0,
      size: orderItem.size,
      eggQty: orderItem.eggQty,
      cheeseQty: orderItem.cheeseQty,
      addons: orderItem.addons ?? [],
    };
  }

  const item = normalizeMenuItem(orderItem.item ?? {});
  return {
    menuItemId: item.id,
    menuItemName: item.name,
    menuItemPrice: item.price,
    qty: orderItem.qty ?? 0,
    size: orderItem.size,
    eggQty: orderItem.eggQty,
    cheeseQty: orderItem.cheeseQty,
    addons: orderItem.addons ?? [],
  };
}

function normalizeUserId(rawId: unknown): string {
  if (typeof rawId === "number" && Number.isInteger(rawId) && rawId > 0) {
    return String(rawId).padStart(4, "0");
  }

  if (typeof rawId === "string" && rawId.trim() !== "") {
    const trimmed = rawId.trim();
    if (/^\d+$/.test(trimmed)) {
      return trimmed.padStart(4, "0");
    }
    return trimmed;
  }

  return "0001";
}

function normalizeUser(user: Partial<StoredUser>): StoredUser {
  return {
    id: normalizeUserId(user.id),
    email: user.email ?? "",
    name: user.name ?? "",
    password: user.password ?? "",
  };
}

function sameOrderItemOptions(
  item: OrderItem,
  input: {
    sugarLevel?: string;
    iceLevel?: string;
    note?: string;
    size?: "small" | "large";
    eggQty?: number;
    cheeseQty?: number;
    addons?: OrderItem["addons"];
  },
) {
  const sugar = (input.sugarLevel || "正常糖").trim();
  const ice = (input.iceLevel || "正常冰").trim();
  const note = (input.note || "").trim();

  return (
    (item.sugarLevel || "正常糖").trim() === sugar &&
    (item.iceLevel || "正常冰").trim() === ice &&
    (item.note || "").trim() === note &&
    (item.size || "small") === (input.size || "small") &&
    (item.eggQty || 0) === (input.eggQty || 0) &&
    (item.cheeseQty || 0) === (input.cheeseQty || 0) &&
    JSON.stringify(item.addons ?? []) === JSON.stringify(input.addons ?? [])
  );
}

const defaultUsers: StoredUser[] = [
  {
    id: "0001",
    email: "demo@example.com",
    name: "示範使用者",
    password: "1234",
  },
  {
    id: "0002",
    email: "amy@example.com",
    name: "Amy",
    password: "1234",
  },
];

function cloneDefaultUsers(): StoredUser[] {
  return defaultUsers.map((user) => ({ ...user }));
}

export class JsonFileStore implements Store {
  private readonly dataFilePath: string;

  private users: StoredUser[] = [];
  private menu: MenuItem[] = [];
  private orders: Order[] = [];
  private coupons: Coupon[] = [];
  private addonSettings: AddonSettings = {
    eggPrice: 10,
    cheesePrice: 10,
    items: [],
  };
  private userIdCounter = 0;
  private menuIdCounter = 0;
  private orderIdCounter = 0;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(options: JsonFileStoreOptions) {
    this.dataFilePath = options.dataFilePath;
  }

  async init(): Promise<void> {
    const file = Bun.file(this.dataFilePath);

    if (!(await file.exists())) {
      const initialStore = this.createInitialStore();
      this.applyStore(initialStore);
      await this.saveStore(initialStore);
      return;
    }

    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as Partial<DataStore>;

      if (!Array.isArray(parsed.menu) || !Array.isArray(parsed.orders)) {
        throw new Error("Invalid store schema");
      }

      const normalizedUsers = Array.isArray(parsed.users)
        ? parsed.users.map((user) => normalizeUser(user))
        : cloneDefaultUsers();

      const fallbackUserId = normalizedUsers[0]?.id ?? "0001";

      this.applyStore({
        users: normalizedUsers,
        menu: parsed.menu.map((item) => normalizeMenuItem(item)),
        orders: parsed.orders.map((order) => ({
          ...order,
          userId: normalizeUserId(order.userId ?? fallbackUserId),
          items: order.items.map((orderItem) =>
            normalizeOrderItem(orderItem as LegacyOrderItem),
          ),
          status:
            order.status === "picked_up"
              ? "picked_up"
              : order.status === "completed"
              ? "completed"
              : order.status === "submitted"
                ? "submitted"
                : "pending",
          paymentMethod:
            order.paymentMethod === "card" || order.paymentMethod === "cash"
              ? order.paymentMethod
              : undefined,
          dailySequence: order.dailySequence,
          note: order.note,
          couponCode: order.couponCode,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          pickupTime: order.pickupTime,
          discountTotal: order.discountTotal ?? 0,
          submittedAt:
            order.status === "submitted" ||
            order.status === "completed" ||
            order.status === "picked_up"
              ? order.submittedAt
              : undefined,
          completedAt:
            order.status === "completed" || order.status === "picked_up"
              ? order.completedAt
              : undefined,
          pickedUpAt:
            order.status === "picked_up" ? order.pickedUpAt : undefined,
        })),
        coupons: Array.isArray(parsed.coupons)
          ? parsed.coupons.map((coupon) => ({
              code: coupon.code,
              name: coupon.name,
              discountType:
                coupon.discountType === "percent" ? "percent" : "amount",
              discountValue: coupon.discountValue,
              minSpend: coupon.minSpend ?? 0,
              maxDiscount: coupon.maxDiscount ?? 0,
              usageLimitPerUser: coupon.usageLimitPerUser ?? 1,
              usageLimitTotal: coupon.usageLimitTotal ?? 0,
              startsAt: coupon.startsAt,
              expiresAt: coupon.expiresAt,
              isActive: coupon.isActive,
            }))
          : [{ code: "BREAKFAST10", name: "早餐折 10 元", discountType: "amount", discountValue: 10, minSpend: 0, maxDiscount: 0, usageLimitPerUser: 1, isActive: true }],
        addonSettings: {
          eggPrice: parsed.addonSettings?.eggPrice ?? 10,
          cheesePrice: parsed.addonSettings?.cheesePrice ?? 10,
          items: parsed.addonSettings?.items ?? [],
        },
        userIdCounter: parsed.userIdCounter ?? 0,
        menuIdCounter: parsed.menuIdCounter ?? 0,
        orderIdCounter: parsed.orderIdCounter ?? 0,
      });
    } catch (error) {
      console.warn("[store] load failed, fallback to initial store", error);
      const initialStore = this.createInitialStore();
      this.applyStore(initialStore);
      await this.saveStore(initialStore);
    }
  }

  getMenu(): ReadonlyArray<MenuItem> {
    return this.menu
      .filter((item) => item.isCurrentVersion)
      .map((item) => this.withAddonSettings(item))
      .sort(
        (a, b) =>
          (a.displayOrder ?? Number.MAX_SAFE_INTEGER) -
            (b.displayOrder ?? Number.MAX_SAFE_INTEGER) ||
          a.logicalId.localeCompare(b.logicalId),
      );
  }

  getAddonSettings(): AddonSettings {
    return {
      ...this.addonSettings,
      items: (this.addonSettings.items ?? []).map((item) => ({ ...item })),
    };
  }

  async updateAddonSettings(input: AddonSettings): Promise<AddonSettings> {
    this.addonSettings = { ...input, items: input.items ?? [] };
    await this.persist();
    return this.getAddonSettings();
  }

  async createMenuItem(input: {
    logicalId?: string;
    name?: string;
    price: number;
    largePrice?: number;
    eggPrice?: number;
    cheesePrice?: number;
    addonKeys?: string[];
    category: string;
    description?: string;
    imageUrl: string;
    translations?: MenuItem["translations"];
    createdBy?: string;
  }): Promise<MenuItem> {
    const logicalId =
      input.logicalId ?? String(++this.menuIdCounter).padStart(3, "0");
    const zh = input.translations?.["zh-TW"];
    const newMenuItem: MenuItem = {
      id: `${logicalId}-01`,
      entityId: crypto.randomUUID(),
      logicalId,
      version: 1,
      majorVersion: 1,
      minorVersion: 0,
      name: input.name ?? zh?.name ?? "",
      price: input.price,
      largePrice: input.largePrice,
      eggPrice: input.eggPrice,
      cheesePrice: input.cheesePrice,
      addonKeys: input.addonKeys ?? [],
      category: input.category,
      description: input.description ?? zh?.description ?? "",
      translations: input.translations,
      imageUrl: input.imageUrl,
      isCurrentVersion: true,
      testGroup: "default",
      displayOrder: Number(logicalId),
    };

    this.menu.push(newMenuItem);
    await this.persist();

    return this.withAddonSettings(newMenuItem);
  }

  async updateMenuItem(
    menuId: string,
    patch: {
      changes: {
        name?: string;
        price?: number;
        largePrice?: number | null;
        eggPrice?: number | null;
        cheesePrice?: number | null;
        addonKeys?: string[];
        category?: string;
        description?: string;
        imageUrl?: string;
        translations?: MenuItem["translations"];
        testGroup?: string;
      };
      reason: string;
      versionLevel?: "major" | "minor";
      userId?: string;
    },
  ): Promise<MenuItem | null> {
    const menuItem = this.menu.find(
      (item) => item.id === menuId || item.logicalId === menuId,
    );
    if (!menuItem) {
      return null;
    }

    menuItem.isCurrentVersion = false;
    const newVersion = menuItem.version + 1;
    const versionLevel = patch.versionLevel ?? "minor";
    const translations = patch.changes.translations ?? menuItem.translations;
    const zh = translations?.["zh-TW"];
    const next: MenuItem = {
      ...menuItem,
      id: `${menuItem.logicalId}-${String(newVersion).padStart(2, "0")}`,
      version: newVersion,
      majorVersion:
        versionLevel === "major"
          ? menuItem.majorVersion + 1
          : menuItem.majorVersion,
      minorVersion:
        versionLevel === "major" ? 0 : menuItem.minorVersion + 1,
      name: patch.changes.name ?? zh?.name ?? menuItem.name,
      price: patch.changes.price ?? menuItem.price,
      largePrice:
        patch.changes.largePrice === undefined
          ? menuItem.largePrice
          : patch.changes.largePrice ?? undefined,
      eggPrice:
        patch.changes.eggPrice === undefined
          ? menuItem.eggPrice
          : patch.changes.eggPrice ?? undefined,
      cheesePrice:
        patch.changes.cheesePrice === undefined
          ? menuItem.cheesePrice
          : patch.changes.cheesePrice ?? undefined,
      addonKeys: patch.changes.addonKeys ?? menuItem.addonKeys ?? [],
      category: patch.changes.category ?? menuItem.category,
      description: patch.changes.description ?? zh?.description ?? menuItem.description,
      translations,
      imageUrl: patch.changes.imageUrl ?? menuItem.imageUrl,
      testGroup: patch.changes.testGroup ?? menuItem.testGroup,
      isCurrentVersion: true,
    };
    this.menu.push(next);

    await this.persist();

    return this.withAddonSettings(next);
  }

  async deleteMenuItem(menuId: string): Promise<MenuItem | null> {
    const targetIndex = this.menu.findIndex(
      (item) => item.id === menuId || item.logicalId === menuId,
    );
    if (targetIndex === -1) {
      return null;
    }

    const [removedMenuItem] = this.menu.splice(targetIndex, 1);
    await this.persist();

    return removedMenuItem ?? null;
  }

  getOrders(): ReadonlyArray<Order> {
    return this.orders;
  }

  getCurrentOrderByUserId(userId: string): Order | undefined {
    const pendingOrders = this.orders.filter(
      (order) => order.userId === userId && order.status === "pending",
    );

    if (pendingOrders.length === 0) {
      return undefined;
    }

    // 取最新 pending（id 越大越新），避免拿到舊的空購物車訂單。
    return pendingOrders.reduce((latest, current) =>
      current.id > latest.id ? current : latest,
    );
  }

  getOrderHistoryByUserId(userId: string): ReadonlyArray<Order> {
    return this.orders
      .filter(
        (order) => order.userId === userId && order.status !== "pending",
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getOrderById(orderId: number): Order | undefined {
    return this.orders.find((order) => order.id === orderId);
  }

  async createOrder(input: { userId: string }): Promise<Order> {
    const existingOrder = this.getCurrentOrderByUserId(input.userId);
    if (existingOrder) {
      return existingOrder;
    }

    const newOrder: Order = {
      id: ++this.orderIdCounter,
      userId: input.userId,
      items: [],
      total: 0,
      status: "pending",
      storeCode: (input as any).storeCode ?? "default",
      createdAt: new Date().toISOString(),
    };

    this.orders.push(newOrder);
    await this.persist();

    return newOrder;
  }

  async updateOrderItem(
    orderId: number,
    input: {
      userId: string;
      orderItemId?: number;
      itemId: string;
      qty: number;
      size?: "small" | "large";
      eggQty?: number;
      cheeseQty?: number;
      addons?: OrderItem["addons"];
      sugarLevel?: string;
      iceLevel?: string;
      note?: string;
      forceNew?: boolean;
    },
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
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }

    if (order.userId !== input.userId) {
      return { ok: false, code: "ORDER_NOT_OWNED" };
    }

    if (order.status !== "pending") {
      return { ok: false, code: "ORDER_NOT_EDITABLE" };
    }

    const menuItem = this.menu.find(
      (item) => item.id === input.itemId && item.isCurrentVersion,
    );
    if (!menuItem) {
      return { ok: false, code: "MENU_ITEM_NOT_FOUND" };
    }
    const addonByKey = new Map(
      (this.addonSettings.items ?? []).map((item) => [item.key, item]),
    );
    const addons = (input.addons ?? [])
      .filter(
        (item) =>
          (menuItem.addonKeys ?? []).includes(item.key) &&
          (addonByKey.get(item.key)?.isActive ?? false) &&
          item.qty > 0,
      )
      .map((item) => ({
        key: item.key,
        name: addonByKey.get(item.key)?.name ?? item.name,
        price: addonByKey.get(item.key)?.price ?? item.price,
        qty: item.qty,
      }));
    const addonTotal = addons.reduce(
      (sum, item) => sum + item.price * item.qty,
      0,
    );
    input = {
      ...input,
      eggQty: menuItem.eggPrice === undefined ? 0 : input.eggQty ?? 0,
      cheeseQty: menuItem.cheesePrice === undefined ? 0 : input.cheeseQty ?? 0,
      addons,
    };
    const baseMenuItemPrice =
      input.size === "large" && menuItem.largePrice !== undefined
        ? menuItem.largePrice
        : menuItem.price;
    const unitPrice =
      applyPromotionToPrice(baseMenuItemPrice, menuItem.activePromotion) +
      (menuItem.eggPrice === undefined ? 0 : this.addonSettings.eggPrice) *
        (input.eggQty ?? 0) +
      (menuItem.cheesePrice === undefined
        ? 0
        : this.addonSettings.cheesePrice) *
        (input.cheeseQty ?? 0) +
      addonTotal;

    const existingItemIndex =
      input.orderItemId !== undefined
        ? order.items.findIndex((orderItem) => orderItem.id === input.orderItemId)
        : input.forceNew
          ? -1
          : order.items.findIndex(
              (orderItem) =>
                orderItem.menuItemId === input.itemId &&
                sameOrderItemOptions(orderItem, input),
            );

    if (existingItemIndex !== -1) {
      const existingOrderItem = order.items[existingItemIndex];

      if (input.qty === 0) {
        order.items.splice(existingItemIndex, 1);
      } else if (existingOrderItem) {
        existingOrderItem.qty =
          input.orderItemId !== undefined
            ? input.qty
            : existingOrderItem.qty + input.qty;
        existingOrderItem.sugarLevel = input.sugarLevel;
        existingOrderItem.iceLevel = input.iceLevel;
        existingOrderItem.note = input.note;
        existingOrderItem.size = input.size;
        existingOrderItem.eggQty = input.eggQty;
        existingOrderItem.cheeseQty = input.cheeseQty;
        existingOrderItem.addons = addons;
        existingOrderItem.menuItemPrice = unitPrice;
      }
    } else if (input.qty > 0) {
      order.items.push({
        id: Date.now() + order.items.length,
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        menuItemPrice: unitPrice,
        qty: input.qty,
        sugarLevel: input.sugarLevel,
        iceLevel: input.iceLevel,
        note: input.note,
        size: input.size,
        eggQty: input.eggQty,
        cheeseQty: input.cheeseQty,
        addons,
      });
    }

    order.total = calculateOrderTotal(order.items);
    await this.persist();

    return { ok: true, order };
  }

  async clearOrderItems(
    orderId: number,
    input: { userId: string },
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
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }

    if (order.userId !== input.userId) {
      return { ok: false, code: "ORDER_NOT_OWNED" };
    }

    if (order.status !== "pending") {
      return { ok: false, code: "ORDER_NOT_EDITABLE" };
    }

    order.items = [];
    order.total = 0;
    await this.persist();

    return { ok: true, order };
  }

  async submitOrder(
    orderId: number,
    input: {
      userId: string;
      paymentMethod?: "cash" | "card";
      note?: string;
      couponCode?: string;
      customerName?: string;
      customerPhone?: string;
      pickupTime?: string;
    },
  ): Promise<
    | { ok: true; order: Order }
    | {
        ok: false;
        code:
          | "ORDER_NOT_FOUND"
          | "ORDER_NOT_OWNED"
          | "ORDER_NOT_EDITABLE"
          | "EMPTY_ORDER"
          | "MENU_VERSION_STALE"
          | "COUPON_NOT_AVAILABLE";
        staleItems?: StaleCartItem[];
      }
  > {
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }

    if (order.userId !== input.userId) {
      return { ok: false, code: "ORDER_NOT_OWNED" };
    }

    if (order.status !== "pending") {
      return { ok: false, code: "ORDER_NOT_EDITABLE" };
    }

    if (order.items.length === 0) {
      return { ok: false, code: "EMPTY_ORDER" };
    }

    const staleItem = order.items.find((orderItem) => {
      const menuItem = this.menu.find((item) => item.id === orderItem.menuItemId);
      return !menuItem?.isCurrentVersion;
    });
    if (staleItem) {
      const staleItems = order.items
        .map((orderItem): StaleCartItem | null => {
          const menuItem = this.menu.find(
            (item) => item.id === orderItem.menuItemId,
          );
          if (menuItem?.isCurrentVersion) return null;

          const current = menuItem
            ? this.menu.find(
                (item) =>
                  item.logicalId === menuItem.logicalId &&
                  item.isCurrentVersion,
              )
            : undefined;

          return {
            menuItemId: orderItem.menuItemId,
            menuItemName: orderItem.menuItemName,
            menuItemPrice: orderItem.menuItemPrice,
            qty: orderItem.qty,
            ...(current
              ? {
                  currentMenuItemId: current.id,
                  currentMenuItemName: current.name,
                  currentMenuItemPrice: current.price,
                }
              : {}),
          };
        })
        .filter((item): item is StaleCartItem => item !== null);

      return { ok: false, code: "MENU_VERSION_STALE", staleItems };
    }

    const coupon = input.couponCode
      ? this.coupons.find(
          (item) =>
            item.code === input.couponCode &&
            item.isActive,
        )
      : undefined;
    if (input.couponCode && !this.canUseCoupon(coupon, order, input.userId)) {
      return { ok: false, code: "COUPON_NOT_AVAILABLE" };
    }
    const discountTotal = coupon
      ? coupon.discountType === "percent"
        ? Math.min(
            coupon.maxDiscount && coupon.maxDiscount > 0
              ? coupon.maxDiscount
              : order.total,
            Math.floor((order.total * (100 - coupon.discountValue)) / 100),
          )
        : Math.min(order.total, coupon.discountValue)
      : 0;
    order.total = Math.max(0, order.total - discountTotal);
    order.status = "submitted";
    order.dailySequence = this.nextDailySequence(order.storeCode ?? "default");
    order.paymentMethod = input.paymentMethod ?? "cash";
    order.note = input.note;
    order.couponCode = coupon?.code;
    order.customerName = input.customerName;
    order.customerPhone = input.customerPhone;
    order.pickupTime = input.pickupTime;
    order.discountTotal = discountTotal;
    order.submittedAt = new Date().toISOString();
    await this.persist();

    return { ok: true, order };
  }

  async completeOrder(orderId: number): Promise<Order | null> {
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order || order.status !== "submitted") {
      return null;
    }

    order.status = "completed";
    order.completedAt = new Date().toISOString();
    await this.persist();
    return order;
  }

  async pickUpOrder(orderId: number): Promise<Order | null> {
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order || order.status !== "completed") {
      return null;
    }

    order.status = "picked_up";
    order.pickedUpAt = new Date().toISOString();
    await this.persist();
    return order;
  }

  getCoupons(): ReadonlyArray<Coupon> {
    return this.coupons;
  }

  async createCoupon(input: Coupon): Promise<Coupon> {
    const coupon = {
      ...input,
      code: input.code,
      minSpend: input.minSpend ?? 0,
      maxDiscount: input.maxDiscount ?? 0,
      usageLimitPerUser: input.usageLimitPerUser ?? 1,
      usageLimitTotal: input.usageLimitTotal ?? 0,
      startsAt: input.startsAt || undefined,
      expiresAt: input.expiresAt || undefined,
    };
    const index = this.coupons.findIndex((item) => item.code === coupon.code);
    if (index === -1) {
      this.coupons.push(coupon);
    } else {
      this.coupons[index] = coupon;
    }
    await this.persist();
    return coupon;
  }

  async deleteCoupon(code: string): Promise<Coupon | null> {
    const coupon = this.coupons.find((item) => item.code === code);
    if (!coupon) return null;

    this.coupons = this.coupons.filter((item) => item.code !== code);
    await this.persist();
    return coupon;
  }

  private canUseCoupon(
    coupon: Coupon | undefined,
    order: Order,
    userId: string,
  ): coupon is Coupon {
    if (!coupon || !coupon.isActive) return false;
    if ((coupon.minSpend ?? 0) > order.total) return false;
    if (coupon.startsAt && new Date(coupon.startsAt).getTime() > Date.now()) {
      return false;
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
      return false;
    }
    const totalUsedCount = this.orders.filter(
      (item) =>
        item.status !== "pending" &&
        item.couponCode === coupon.code,
    ).length;
    const usageLimitTotal = coupon.usageLimitTotal ?? 0;
    if (usageLimitTotal > 0 && totalUsedCount >= usageLimitTotal) {
      return false;
    }

    const usedCount = this.orders.filter(
      (item) =>
        item.userId === userId &&
        item.status !== "pending" &&
        item.couponCode === coupon.code,
    ).length;
    return usedCount < (coupon.usageLimitPerUser ?? 1);
  }

  private createInitialStore(): DataStore {
    return {
      users: cloneDefaultUsers(),
      menu: cloneDefaultMenu(),
      orders: [],
      coupons: [
        {
          code: "BREAKFAST10",
          name: "早餐折 10 元",
          discountType: "amount",
          discountValue: 10,
          isActive: true,
        },
      ],
      addonSettings: { eggPrice: 10, cheesePrice: 10, items: [] },
      userIdCounter: defaultUsers.length,
      menuIdCounter: defaultMenu.length,
      orderIdCounter: 0,
    };
  }

  private applyStore(store: DataStore): void {
    this.users = store.users;
    this.menu = store.menu;
    this.orders = store.orders;
    this.coupons = store.coupons ?? [];
    this.addonSettings = store.addonSettings ?? {
      eggPrice: 10,
      cheesePrice: 10,
      items: [],
    };

    const maxUserId = this.users.reduce((max, user) => {
      const asNumber = Number.parseInt(user.id, 10);
      return Number.isFinite(asNumber) ? Math.max(max, asNumber) : max;
    }, 0);

    const maxMenuId = this.menu.reduce(
      (max, item) => Math.max(max, Number(item.logicalId)),
      0,
    );
    const maxOrderId = this.orders.reduce(
      (max, order) => Math.max(max, order.id),
      0,
    );

    this.userIdCounter = Math.max(store.userIdCounter || 0, maxUserId);
    this.menuIdCounter = Math.max(store.menuIdCounter || 0, maxMenuId);
    this.orderIdCounter = Math.max(store.orderIdCounter || 0, maxOrderId);
  }

  private buildStoreSnapshot(): DataStore {
    return {
      users: this.users,
      menu: this.menu,
      orders: this.orders,
      coupons: this.coupons,
      addonSettings: this.addonSettings,
      userIdCounter: this.userIdCounter,
      menuIdCounter: this.menuIdCounter,
      orderIdCounter: this.orderIdCounter,
    };
  }

  private withAddonSettings(item: MenuItem): MenuItem {
    return {
      ...item,
      eggPrice:
        item.eggPrice === undefined ? undefined : this.addonSettings.eggPrice,
      cheesePrice:
        item.cheesePrice === undefined
          ? undefined
          : this.addonSettings.cheesePrice,
    };
  }

  private async saveStore(snapshot: DataStore): Promise<void> {
    await mkdir("./data", { recursive: true });
    const tmpPath = `${this.dataFilePath}.tmp`;
    await Bun.write(tmpPath, JSON.stringify(snapshot, null, 2));
    await rename(tmpPath, this.dataFilePath);
  }

  private async persist(): Promise<void> {
    const snapshot = this.buildStoreSnapshot();

    this.persistQueue = this.persistQueue.then(async () => {
      await this.saveStore(snapshot);
    });

    await this.persistQueue;
  }

  private nextDailySequence(storeCode: string): number {
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Taipei",
    });
    const todayOrders = this.orders.filter((order) => {
      const source = order.submittedAt ?? order.createdAt;
      const sameDay =
        new Date(source).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }) ===
        today;
      const sameStore = (order.storeCode ?? "default") === storeCode;
      return sameDay && order.dailySequence !== undefined && sameStore;
    });

    return Math.max(0, ...todayOrders.map((order) => order.dailySequence ?? 0)) + 1;
  }
}

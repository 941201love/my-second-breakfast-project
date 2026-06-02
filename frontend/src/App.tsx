import { useEffect, useState, useMemo } from "react";
import "./App.css";
import type {
  ApiDataResponse,
  ActivePromotion,
  AddonSettings,
  Coupon,
  MenuItem,
  MenuItemVersionHistory,
  Order,
  OrderItem,
  OrderProgress,
  SessionUser,
  StaleCartItem,
} from "../../shared/contracts.ts";
import { applyPromotionToPrice } from "../../shared/pricing.ts";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const fallbackMenuImage = "/imgs/menu/鮪魚蛋吐司.webp";

function buildApiUrl(path: string) {
  return `${apiBaseUrl}${path}`;
}

function isDrink(item: MenuItem) {
  return item.category.includes("飲") || item.category.includes("茶");
}

function formatTaipeiDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function orderStatusLabel(status: Order["status"]) {
  if (status === "picked_up") return "已取貨";
  if (status === "completed") return "已完成";
  if (status === "submitted") return "製作中";
  return "購物車";
}

function orderStatusBadgeClass(status: Order["status"]) {
  if (status === "picked_up") return "badge-ghost";
  if (status === "completed") return "badge-success";
  if (status === "submitted") return "badge-warning";
  return "badge-ghost";
}

function orderWaitMinutes(order: Order) {
  const value = order.submittedAt ?? order.createdAt;
  const startedAt = new Date(value).getTime();
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
}

function orderWaitClass(minutes: number) {
  if (minutes >= 15) return "bg-error/20";
  if (minutes >= 10) return "bg-warning/20";
  return "";
}

function formatMoney(amount: number) {
  return `NT$${amount}`;
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function parseWholeNumber(value: string, fallback = 0) {
  const digits = onlyDigits(value);
  if (!digits) return fallback;
  return Number(digits);
}

function normalizeAddonSettings(value?: Partial<AddonSettings> | null): AddonSettings {
  return {
    eggPrice: value?.eggPrice ?? 10,
    cheesePrice: value?.cheesePrice ?? 10,
    items: Array.isArray(value?.items) ? value.items : [],
  };
}

function todayTaipeiDate() {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Taipei",
  });
}

function dateInputValue(value?: string) {
  if (!value) return todayTaipeiDate();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return todayTaipeiDate();
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

function taipeiDayBoundaryIso(date: string, endOfDay: boolean) {
  if (!date) return "";
  const time = endOfDay ? "23:59:59" : "00:00:00";
  return new Date(`${date}T${time}+08:00`).toISOString();
}

function isTaiwanMobilePhone(phone: string) {
  return /^09\d{8}$/.test(phone);
}

function calculateCouponDiscount(coupon: Coupon | null, amount: number) {
  if (!coupon) return 0;
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > Date.now()) {
    return 0;
  }
  if (coupon.discountType === "percent") {
    const discount = Math.floor((amount * (100 - coupon.discountValue)) / 100);
    return coupon.maxDiscount && coupon.maxDiscount > 0
      ? Math.min(discount, coupon.maxDiscount)
      : Math.min(amount, discount);
  }

  return Math.min(amount, coupon.discountValue);
}

function promotionalMenuItemPrice(item: MenuItem, price = item.price) {
  return applyPromotionToPrice(price, item.activePromotion);
}

function submittedOrderDate(order: Order) {
  return new Date(order.submittedAt ?? order.createdAt).toLocaleDateString(
    "sv-SE",
    { timeZone: "Asia/Taipei" },
  );
}

function submittedOrderHour(order: Order) {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(order.submittedAt ?? order.createdAt))
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart);
  return Number.isFinite(hour) ? hour % 24 : 0;
}

function buildOrderStats(orders: Order[], date: string) {
  const submittedOrders = orders.filter(
    (order) => submittedOrderDate(order) === date && order.status !== "pending",
  );
  const revenue = submittedOrders.reduce((sum, order) => sum + order.total, 0);
  const itemSales = new Map<string, { name: string; qty: number }>();
  const hourlySales = new Map<number, number>();

  for (const order of submittedOrders) {
    const hour = submittedOrderHour(order);
    hourlySales.set(hour, (hourlySales.get(hour) ?? 0) + 1);

    for (const item of order.items) {
      const current = itemSales.get(item.menuItemId) ?? {
        name: item.menuItemName,
        qty: 0,
      };
      current.qty += item.qty;
      itemSales.set(item.menuItemId, current);
    }
  }

  return {
    submittedOrders,
    revenue,
    itemRanking: Array.from(itemSales.values()).sort((a, b) => b.qty - a.qty),
    hourlyRanking: Array.from(hourlySales.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour),
  };
}

function buildOrderRangeStats(orders: Order[], startDate: string, endDate: string) {
  const from = startDate || endDate;
  const to = endDate || startDate;
  const submittedOrders = orders.filter((order) => {
    if (order.status === "pending") return false;
    const orderDate = submittedOrderDate(order);
    if (from && orderDate < from) return false;
    if (to && orderDate > to) return false;
    return true;
  });
  const revenue = submittedOrders.reduce((sum, order) => sum + order.total, 0);
  const itemQty = submittedOrders.reduce(
    (sum, order) =>
      sum + order.items.reduce((itemSum, item) => itemSum + item.qty, 0),
    0,
  );

  return {
    submittedOrders,
    revenue,
    itemQty,
    averageTicket:
      submittedOrders.length === 0
        ? 0
        : Math.round(revenue / submittedOrders.length),
  };
}

type UserProfile = {
  nickname: string;
  phone: string;
  language: "zh-TW" | "en" | "ja" | "ko";
};

type CartDetail = {
  itemId: string;
  orderItemId: number | undefined;
  qty: number;
  item: MenuItem;
  orderItem: OrderItem;
  subtotal: number;
};

const sugarOptions = ["正常糖", "少糖", "半糖", "微糖", "無糖"];
const iceOptions = ["正常冰", "少冰", "微冰", "去冰", "熱飲"];
const sugarOptionLabels: Record<
  UserProfile["language"],
  Record<string, string>
> = {
  "zh-TW": {
    正常糖: "正常糖",
    少糖: "少糖",
    半糖: "半糖",
    微糖: "微糖",
    無糖: "無糖",
  },
  en: {
    正常糖: "Regular",
    少糖: "Less",
    半糖: "Half",
    微糖: "Light",
    無糖: "No sugar",
  },
  ja: {
    正常糖: "通常",
    少糖: "少なめ",
    半糖: "半分",
    微糖: "微糖",
    無糖: "無糖",
  },
  ko: {
    正常糖: "보통",
    少糖: "덜 달게",
    半糖: "반당",
    微糖: "약간",
    無糖: "무가당",
  },
};
const iceOptionLabels: Record<UserProfile["language"], Record<string, string>> = {
  "zh-TW": {
    正常冰: "正常冰",
    少冰: "少冰",
    微冰: "微冰",
    去冰: "去冰",
    熱飲: "熱飲",
  },
  en: {
    正常冰: "Regular ice",
    少冰: "Less ice",
    微冰: "Light ice",
    去冰: "No ice",
    熱飲: "Hot",
  },
  ja: {
    正常冰: "通常氷",
    少冰: "氷少なめ",
    微冰: "氷少し",
    去冰: "氷なし",
    熱飲: "ホット",
  },
  ko: {
    正常冰: "보통 얼음",
    少冰: "얼음 적게",
    微冰: "얼음 조금",
    去冰: "얼음 없음",
    熱飲: "따뜻하게",
  },
};
const categoryLabels: Record<UserProfile["language"], Record<string, string>> = {
  "zh-TW": {
    飲料: "飲料",
    餐點: "餐點",
    主餐: "主餐",
    蛋餅: "蛋餅",
    吐司: "吐司",
    漢堡: "漢堡",
    飯糰: "飯糰",
    麵食: "麵食",
    點心: "點心",
    套餐: "套餐",
    其他: "其他",
    未分類: "未分類",
  },
  en: {
    飲料: "Drinks",
    餐點: "Meals",
    主餐: "Mains",
    蛋餅: "Egg Pancakes",
    吐司: "Toast",
    漢堡: "Burgers",
    飯糰: "Rice Balls",
    麵食: "Noodles",
    點心: "Snacks",
    套餐: "Combos",
    其他: "Other",
    未分類: "Other",
  },
  ja: {
    飲料: "ドリンク",
    餐點: "食事",
    主餐: "メイン",
    蛋餅: "蛋餅",
    吐司: "トースト",
    漢堡: "バーガー",
    飯糰: "おにぎり",
    麵食: "麺類",
    點心: "軽食",
    套餐: "セット",
    其他: "その他",
    未分類: "その他",
  },
  ko: {
    飲料: "음료",
    餐點: "식사",
    主餐: "메인",
    蛋餅: "단빙",
    吐司: "토스트",
    漢堡: "버거",
    飯糰: "주먹밥",
    麵食: "면류",
    點心: "간식",
    套餐: "세트",
    其他: "기타",
    未分類: "기타",
  },
};
const breakfastCategoryOptions = [
  "飲料",
  "主餐",
  "蛋餅",
  "吐司",
  "漢堡",
  "飯糰",
  "麵食",
  "點心",
  "套餐",
  "其他",
];
const builtInMenuTranslations: Record<
  string,
  NonNullable<MenuItem["translations"]>
> = {
  火腿蛋吐司: {
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
  起司豬排堡: {
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
  鮪魚蛋吐司: {
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
  培根蛋餅: {
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
  起司蔬菜蛋餅: {
    "zh-TW": {
      name: "起司蔬菜蛋餅",
      description: "加入起司與高麗菜絲，口感滑順、起司香氣濃郁，適合想吃清爽一點的客人。",
    },
    en: {
      name: "Cheese Vegetable Egg Pancake Roll",
      description: "Cheese and shredded cabbage in a soft egg pancake roll with a lighter taste.",
    },
    ja: {
      name: "チーズ野菜蛋餅",
      description: "チーズとキャベツを包んだ、なめらかで軽めの台湾風蛋餅。",
    },
    ko: {
      name: "치즈 야채 단빙",
      description: "치즈와 양배추를 넣어 부드럽고 산뜻한 대만식 달걀 전병입니다.",
    },
  },
  蘿蔔糕加蛋: {
    "zh-TW": {
      name: "蘿蔔糕加蛋",
      description: "外表煎到金黃微酥的蘿蔔糕，搭配荷包蛋與特調醬油膏。",
    },
    en: {
      name: "Radish Cake with Egg",
      description: "Golden pan-fried radish cake served with egg and house soy paste.",
    },
    ja: {
      name: "大根餅 卵付き",
      description: "外は香ばしく焼いた大根餅に卵と特製醤油だれを添えました。",
    },
    ko: {
      name: "무떡 계란 추가",
      description: "노릇하게 구운 무떡에 달걀과 특제 간장 소스를 곁들였습니다.",
    },
  },
  紅茶: {
    "zh-TW": {
      name: "紅茶",
      description: "古早味紅茶，微糖微冰為店內推薦比例，適合作為早餐基本配備。",
    },
    en: {
      name: "Black Tea",
      description: "Classic Taiwanese black tea; light sugar and light ice are recommended.",
    },
    ja: {
      name: "紅茶",
      description: "昔ながらの台湾紅茶。微糖・氷少なめがおすすめです。",
    },
    ko: {
      name: "홍차",
      description: "대만식 클래식 홍차입니다. 약간의 당도와 얼음을 추천합니다.",
    },
  },
  奶茶: {
    "zh-TW": {
      name: "奶茶",
      description: "使用紅茶搭配奶精調和，香濃順口，是最受歡迎的經典飲品。",
    },
    en: {
      name: "Milk Tea",
      description: "Black tea blended with creamer, smooth and aromatic.",
    },
    ja: {
      name: "ミルクティー",
      description: "紅茶とクリーマーを合わせた、香り高く飲みやすい定番ドリンク。",
    },
    ko: {
      name: "밀크티",
      description: "홍차와 크리머를 섞어 부드럽고 향이 진한 인기 음료입니다.",
    },
  },
  豆漿: {
    "zh-TW": {
      name: "豆漿",
      description: "每日現煮黃豆漿，口感濃郁不稀薄，提供無糖與微糖兩種甜度選擇。",
    },
    en: {
      name: "Soy Milk",
      description: "Freshly cooked soy milk, rich and smooth, available unsweetened or lightly sweet.",
    },
    ja: {
      name: "豆乳",
      description: "毎日煮出す濃厚な豆乳。無糖と微糖から選べます。",
    },
    ko: {
      name: "두유",
      description: "매일 끓이는 진한 두유입니다. 무가당과 약간 달게를 선택할 수 있습니다.",
    },
  },
  鮮奶茶: {
    "zh-TW": {
      name: "鮮奶茶",
      description: "以鮮奶取代奶精，茶味與奶味平衡，適合喜歡濃郁口感的客人。",
    },
    en: {
      name: "Fresh Milk Tea",
      description: "Black tea with fresh milk for a balanced, rich flavor.",
    },
    ja: {
      name: "フレッシュミルクティー",
      description: "クリーマーではなく牛乳を使った、茶とミルクのバランスが良い一杯。",
    },
    ko: {
      name: "생우유 밀크티",
      description: "크리머 대신 우유를 넣어 차와 우유의 균형이 좋은 음료입니다.",
    },
  },
  冰美式咖啡: {
    "zh-TW": {
      name: "冰美式咖啡",
      description: "使用中焙咖啡豆現萃，帶有堅果香氣與微微果酸，無糖風味清爽。",
    },
    en: {
      name: "Iced Americano",
      description: "Freshly brewed medium-roast coffee with nutty aroma and light acidity.",
    },
    ja: {
      name: "アイスアメリカーノ",
      description: "中煎り豆を使った、ナッツの香りと軽い酸味のすっきりしたコーヒー。",
    },
    ko: {
      name: "아이스 아메리카노",
      description: "중배전 원두로 추출해 고소한 향과 산뜻한 산미가 있는 커피입니다.",
    },
  },
  熱拿鐵咖啡: {
    "zh-TW": {
      name: "熱拿鐵咖啡",
      description: "義式濃縮搭配蒸煮鮮奶，奶泡綿密，適合作為慢慢享用的早晨飲品。",
    },
    en: {
      name: "Hot Latte",
      description: "Espresso with steamed milk and soft foam for a slow morning drink.",
    },
    ja: {
      name: "ホットラテ",
      description: "エスプレッソにスチームミルクを合わせた、朝にゆっくり楽しめる一杯。",
    },
    ko: {
      name: "핫 라떼",
      description: "에스프레소와 스팀 우유, 부드러운 거품이 어우러진 따뜻한 라떼입니다.",
    },
  },
};
const languageOptions: Array<{
  value: UserProfile["language"];
  label: string;
}> = [
  { value: "zh-TW", label: "中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];
const menuLanguageOptions = languageOptions;

const uiText: Record<UserProfile["language"], Record<string, string>> = {
  "zh-TW": {
    appTitle: "博翔早餐菜單",
    currentDone: "目前已做到",
    waitingCount: "等候人數",
    readyForPickup: "可取餐",
    waitingPickup: "待取餐",
    cartDetails: "購物車明細",
    orderHistory: "歷史訂單",
    profile: "個人",
    logout: "登出",
    googleTitle: "使用 Google 帳號登入",
    googleDescription: "點擊下方按鈕，使用您的 Google 帳號登入後即可開始點餐。",
    googleLoading: "導向 Google 中...",
    googleLogin: "使用 Google 登入",
    completedTitle: "餐點已完成，可以取餐",
    pickupNumber: "取餐編號",
    addToCart: "加入購物車",
    newItems: "新品推出",
    newBadge: "新品",
    adding: "加入中...",
    loading: "讀取中...",
    noHistory: "目前尚無歷史訂單。",
    order: "訂單",
    pendingCart: "購物車",
    making: "製作中",
    completed: "已完成",
    pickedUp: "已取貨",
    defaultSugar: "預設糖",
    defaultIce: "預設冰",
    close: "關閉",
    customerName: "訂購人",
    phone: "電話",
    createdAt: "建立時間",
    submittedAt: "下單時間",
    completedAt: "完成時間",
    cash: "現金",
    card: "刷卡",
    total: "總額",
    buyAgain: "再買一次",
    profileTitle: "個人資料",
    nicknamePlaceholder: "暱稱",
    phonePlaceholder: "電話",
    save: "儲存",
    qty: "數量",
    portion: "份量",
    small: "小份",
    large: "大份",
    addEgg: "加蛋",
    addCheese: "加起司",
    sugar: "糖度",
    ice: "冰塊",
    note: "備註",
    edit: "編輯",
    itemNotePlaceholder: "例如：不要醬、餐點分開裝、吐司烤焦一點",
    back: "返回",
    checkout: "結帳",
    cartEmpty: "購物車目前是空的。",
    staleCart: "購物車有品項已更新",
    totalItems: "總件數",
    totalAmount: "總金額",
    checkoutNamePlaceholder: "暱稱，例如 小翔",
    checkoutPhonePlaceholder: "電話號碼（必填），例如 0912345678",
    phoneRequired: "請填寫電話號碼，方便店家確認取餐。",
    phoneInvalid: "電話號碼需為 09 開頭、總共 10 碼。",
    pickupTimePlaceholder: "大概幾點拿，例如 08:30",
    orderNotePlaceholder: "整張訂單備註，例如：餐點分開裝、到店再做",
    couponPlaceholder: "優惠碼，例如 BREAKFAST10",
    addCoupon: "新增",
    couponApplied: "已使用優惠券",
    couponInvalid: "找不到可使用的優惠券。",
    couponAlreadyUsed: "你已用過此優惠券。",
    couponUnavailable: "優惠券尚未符合使用條件",
    couponMinSpend: "最低消費",
    originalAmount: "金額",
    confirmClearCart: "確定要清空購物車嗎？",
    confirm: "確定",
    cancel: "取消",
    discount: "優惠折抵",
    couponLimitOnce: "每個帳號限一次",
    couponLimitedQuantity: "數量有限",
    couponAmountBenefit: "現折 {amount}",
    couponPercentBenefit: "結帳享 {ratio} 折",
    couponWallet: "優惠券",
    couponWalletTitle: "我的優惠券",
    recommendedCoupons: "推薦優惠券",
    collectedCoupons: "已新增優惠券",
    collectCoupon: "新增",
    couponCollected: "已新增",
    useCoupon: "使用",
    couponSelected: "已選用",
    selectCoupon: "選擇已新增優惠券",
    useCouponTitle: "使用優惠券",
    enterCouponCode: "輸入優惠碼",
    availableCoupons: "可使用的優惠券",
    unavailableCoupons: "不適用於此訂單的優惠券",
    noAvailableCoupons: "目前沒有符合條件的優惠券。",
    noUnavailableCoupons: "目前沒有其他優惠券。",
    noRecommendedCoupons: "目前沒有推薦優惠券。",
    noCollectedCoupons: "目前尚未新增優惠券。",
    promotionNoticeTitle: "限時優惠",
    promotionNoticeDescription: "活動期間點選商品即可享有優惠價。",
    clearing: "清空中...",
    clearCart: "清空購物車",
    submitting: "結帳中...",
    confirmSubmit: "確認送出",
  },
  en: {
    appTitle: "Boxiang Breakfast Menu",
    currentDone: "Now serving",
    waitingCount: "Waiting",
    readyForPickup: "Ready for pickup",
    waitingPickup: "In progress",
    cartDetails: "Cart",
    orderHistory: "Order history",
    profile: "Profile",
    logout: "Log out",
    googleTitle: "Sign in with Google",
    googleDescription: "Sign in with your Google account to start ordering.",
    googleLoading: "Redirecting to Google...",
    googleLogin: "Sign in with Google",
    completedTitle: "Your order is ready for pickup",
    pickupNumber: "Pickup number",
    addToCart: "Add to cart",
    newItems: "New arrivals",
    newBadge: "New",
    adding: "Adding...",
    loading: "Loading...",
    noHistory: "No order history yet.",
    order: "Order",
    pendingCart: "Cart",
    making: "In progress",
    completed: "Completed",
    pickedUp: "Picked up",
    defaultSugar: "Default sugar",
    defaultIce: "Default ice",
    close: "Close",
    customerName: "Name",
    phone: "Phone",
    createdAt: "Created",
    submittedAt: "Submitted",
    completedAt: "Completed",
    cash: "Cash",
    card: "Card",
    total: "Total",
    buyAgain: "Order again",
    profileTitle: "Profile",
    nicknamePlaceholder: "Nickname",
    phonePlaceholder: "Phone",
    save: "Save",
    qty: "Quantity",
    portion: "Portion",
    small: "Small",
    large: "Large",
    addEgg: "Add egg",
    addCheese: "Add cheese",
    sugar: "Sugar",
    ice: "Ice",
    note: "Note",
    edit: "Edit",
    itemNotePlaceholder: "e.g. no sauce, separate packaging, toast darker",
    back: "Back",
    checkout: "Checkout",
    cartEmpty: "Your cart is empty.",
    staleCart: "Some cart items were updated",
    totalItems: "Items",
    totalAmount: "Amount",
    checkoutNamePlaceholder: "Nickname, e.g. Sean",
    checkoutPhonePlaceholder: "Phone required, e.g. 0912345678",
    phoneRequired: "Please enter your phone number for pickup confirmation.",
    phoneInvalid: "Phone must start with 09 and contain 10 digits.",
    pickupTimePlaceholder: "Pickup time, e.g. 08:30",
    orderNotePlaceholder: "Order note, e.g. separate packaging",
    couponPlaceholder: "Coupon code, e.g. BREAKFAST10",
    addCoupon: "Add",
    couponApplied: "Coupon applied",
    couponInvalid: "No available coupon found.",
    couponAlreadyUsed: "You have already used this coupon.",
    couponUnavailable: "Coupon requirements not met",
    couponMinSpend: "Minimum spend",
    originalAmount: "Amount",
    confirmClearCart: "Clear the cart?",
    confirm: "Confirm",
    cancel: "Cancel",
    discount: "Discount",
    couponLimitOnce: "Once per account",
    couponLimitedQuantity: "Limited quantity",
    couponAmountBenefit: "Save {amount}",
    couponPercentBenefit: "Pay {percent}%",
    couponWallet: "Coupons",
    couponWalletTitle: "My coupons",
    recommendedCoupons: "Recommended coupons",
    collectedCoupons: "Added coupons",
    collectCoupon: "Add",
    couponCollected: "Added",
    useCoupon: "Use",
    couponSelected: "Selected",
    selectCoupon: "Choose an added coupon",
    useCouponTitle: "Use a coupon",
    enterCouponCode: "Enter coupon code",
    availableCoupons: "Available coupons",
    unavailableCoupons: "Coupons not applicable to this order",
    noAvailableCoupons: "No coupons meet the requirements.",
    noUnavailableCoupons: "No other coupons.",
    noRecommendedCoupons: "No recommended coupons available.",
    noCollectedCoupons: "You have not added any coupons yet.",
    promotionNoticeTitle: "Limited-time offers",
    promotionNoticeDescription: "Select an item to enjoy its promotional price.",
    clearing: "Clearing...",
    clearCart: "Clear cart",
    submitting: "Checking out...",
    confirmSubmit: "Place order",
  },
  ja: {
    appTitle: "博翔 朝食メニュー",
    currentDone: "現在提供中",
    waitingCount: "待ち人数",
    readyForPickup: "受取可能",
    waitingPickup: "調理中",
    cartDetails: "カート",
    orderHistory: "注文履歴",
    profile: "プロフィール",
    logout: "ログアウト",
    googleTitle: "Googleでログイン",
    googleDescription: "Googleアカウントでログインすると注文できます。",
    googleLoading: "Googleへ移動中...",
    googleLogin: "Googleでログイン",
    completedTitle: "注文ができました。受け取りできます",
    pickupNumber: "受取番号",
    addToCart: "カートに追加",
    newItems: "新商品",
    newBadge: "新商品",
    adding: "追加中...",
    loading: "読み込み中...",
    noHistory: "注文履歴はまだありません。",
    order: "注文",
    pendingCart: "カート",
    making: "調理中",
    completed: "完了",
    pickedUp: "受取済み",
    defaultSugar: "標準の甘さ",
    defaultIce: "標準の氷",
    close: "閉じる",
    customerName: "注文者",
    phone: "電話",
    createdAt: "作成時間",
    submittedAt: "注文時間",
    completedAt: "完成時間",
    cash: "現金",
    card: "カード",
    total: "合計",
    buyAgain: "もう一度買う",
    profileTitle: "個人情報",
    nicknamePlaceholder: "ニックネーム",
    phonePlaceholder: "電話",
    save: "保存",
    qty: "数量",
    portion: "サイズ",
    small: "小",
    large: "大",
    addEgg: "卵追加",
    addCheese: "チーズ追加",
    sugar: "甘さ",
    ice: "氷",
    note: "メモ",
    edit: "編集",
    itemNotePlaceholder: "例：ソースなし、別包装、トースト強め",
    back: "戻る",
    checkout: "会計",
    cartEmpty: "カートは空です。",
    staleCart: "カート内の商品が更新されました",
    totalItems: "合計点数",
    totalAmount: "合計金額",
    checkoutNamePlaceholder: "ニックネーム、例：翔",
    checkoutPhonePlaceholder: "電話番号（必須）、例：0912345678",
    phoneRequired: "受け取り確認のため電話番号を入力してください。",
    phoneInvalid: "電話番号は09で始まる10桁で入力してください。",
    pickupTimePlaceholder: "受取予定時刻、例：08:30",
    orderNotePlaceholder: "注文メモ、例：別包装",
    couponPlaceholder: "クーポンコード、例：BREAKFAST10",
    addCoupon: "追加",
    couponApplied: "クーポン適用済み",
    couponInvalid: "利用できるクーポンが見つかりません。",
    couponAlreadyUsed: "このクーポンはすでに使用済みです。",
    couponUnavailable: "クーポンの利用条件を満たしていません",
    couponMinSpend: "最低利用額",
    originalAmount: "金額",
    confirmClearCart: "カートを空にしますか？",
    confirm: "確認",
    cancel: "キャンセル",
    discount: "割引",
    couponLimitOnce: "1アカウント1回まで",
    couponLimitedQuantity: "数量限定",
    couponAmountBenefit: "{amount}割引",
    couponPercentBenefit: "お会計は{percent}%",
    couponWallet: "クーポン",
    couponWalletTitle: "マイクーポン",
    recommendedCoupons: "おすすめクーポン",
    collectedCoupons: "追加済みクーポン",
    collectCoupon: "追加",
    couponCollected: "追加済み",
    useCoupon: "使用",
    couponSelected: "選択済み",
    selectCoupon: "追加済みクーポンを選択",
    useCouponTitle: "クーポンを使用",
    enterCouponCode: "クーポンコードを入力",
    availableCoupons: "利用可能なクーポン",
    unavailableCoupons: "この注文では利用できないクーポン",
    noAvailableCoupons: "条件を満たすクーポンはありません。",
    noUnavailableCoupons: "その他のクーポンはありません。",
    noRecommendedCoupons: "おすすめクーポンはありません。",
    noCollectedCoupons: "追加済みクーポンはありません。",
    promotionNoticeTitle: "期間限定キャンペーン",
    promotionNoticeDescription: "対象商品を選ぶとキャンペーン価格が適用されます。",
    clearing: "削除中...",
    clearCart: "カートを空にする",
    submitting: "会計中...",
    confirmSubmit: "注文を確定",
  },
  ko: {
    appTitle: "보샹 아침 메뉴",
    currentDone: "현재 완료",
    waitingCount: "대기 인원",
    readyForPickup: "픽업 가능",
    waitingPickup: "준비 중",
    cartDetails: "장바구니",
    orderHistory: "주문 내역",
    profile: "프로필",
    logout: "로그아웃",
    googleTitle: "Google로 로그인",
    googleDescription: "Google 계정으로 로그인하면 주문할 수 있습니다.",
    googleLoading: "Google로 이동 중...",
    googleLogin: "Google로 로그인",
    completedTitle: "주문이 준비되었습니다. 픽업하세요",
    pickupNumber: "픽업 번호",
    addToCart: "장바구니 담기",
    newItems: "신상품",
    newBadge: "신상품",
    adding: "담는 중...",
    loading: "불러오는 중...",
    noHistory: "아직 주문 내역이 없습니다.",
    order: "주문",
    pendingCart: "장바구니",
    making: "준비 중",
    completed: "완료",
    pickedUp: "수령 완료",
    defaultSugar: "기본 당도",
    defaultIce: "기본 얼음",
    close: "닫기",
    customerName: "주문자",
    phone: "전화",
    createdAt: "생성 시간",
    submittedAt: "주문 시간",
    completedAt: "완료 시간",
    cash: "현금",
    card: "카드",
    total: "합계",
    buyAgain: "다시 주문",
    profileTitle: "개인 정보",
    nicknamePlaceholder: "닉네임",
    phonePlaceholder: "전화",
    save: "저장",
    qty: "수량",
    portion: "사이즈",
    small: "소",
    large: "대",
    addEgg: "계란 추가",
    addCheese: "치즈 추가",
    sugar: "당도",
    ice: "얼음",
    note: "메모",
    edit: "수정",
    itemNotePlaceholder: "예: 소스 빼기, 따로 포장, 토스트 더 굽기",
    back: "뒤로",
    checkout: "결제",
    cartEmpty: "장바구니가 비어 있습니다.",
    staleCart: "장바구니 상품이 업데이트되었습니다",
    totalItems: "총 수량",
    totalAmount: "총 금액",
    checkoutNamePlaceholder: "닉네임, 예: 샹",
    checkoutPhonePlaceholder: "전화번호(필수), 예: 0912345678",
    phoneRequired: "픽업 확인을 위해 전화번호를 입력해 주세요.",
    phoneInvalid: "전화번호는 09로 시작하는 10자리여야 합니다.",
    pickupTimePlaceholder: "픽업 시간, 예: 08:30",
    orderNotePlaceholder: "주문 메모, 예: 따로 포장",
    couponPlaceholder: "쿠폰 코드, 예: BREAKFAST10",
    addCoupon: "추가",
    couponApplied: "쿠폰 적용됨",
    couponInvalid: "사용 가능한 쿠폰을 찾을 수 없습니다.",
    couponAlreadyUsed: "이미 사용한 쿠폰입니다.",
    couponUnavailable: "쿠폰 사용 조건을 충족하지 않았습니다",
    couponMinSpend: "최소 주문 금액",
    originalAmount: "금액",
    confirmClearCart: "장바구니를 비우시겠습니까?",
    confirm: "확인",
    cancel: "취소",
    discount: "할인",
    couponLimitOnce: "계정당 1회",
    couponLimitedQuantity: "수량 한정",
    couponAmountBenefit: "{amount} 할인",
    couponPercentBenefit: "결제 금액 {percent}%",
    couponWallet: "쿠폰",
    couponWalletTitle: "내 쿠폰",
    recommendedCoupons: "추천 쿠폰",
    collectedCoupons: "추가한 쿠폰",
    collectCoupon: "추가",
    couponCollected: "추가됨",
    useCoupon: "사용",
    couponSelected: "선택됨",
    selectCoupon: "추가한 쿠폰 선택",
    useCouponTitle: "쿠폰 사용",
    enterCouponCode: "쿠폰 코드 입력",
    availableCoupons: "사용 가능한 쿠폰",
    unavailableCoupons: "이 주문에 적용할 수 없는 쿠폰",
    noAvailableCoupons: "조건을 충족하는 쿠폰이 없습니다.",
    noUnavailableCoupons: "다른 쿠폰이 없습니다.",
    noRecommendedCoupons: "추천 쿠폰이 없습니다.",
    noCollectedCoupons: "아직 추가한 쿠폰이 없습니다.",
    promotionNoticeTitle: "기간 한정 할인",
    promotionNoticeDescription: "상품을 선택하면 할인 가격이 적용됩니다.",
    clearing: "비우는 중...",
    clearCart: "장바구니 비우기",
    submitting: "결제 중...",
    confirmSubmit: "주문 확정",
  },
};

type CouponFormState = {
  code: string;
  name: string;
  discountType: "amount" | "percent";
  discountValue: string;
  minSpend: string;
  maxDiscount: string;
  usageLimitPerUser: string;
  usageLimitTotal: string;
  startsDate: string;
  endsDate: string;
};

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const isAdminPage = currentPath.startsWith("/admin");
  const isAdminDashboardPage = currentPath === "/admin";
  const isAdminOrdersPage = currentPath === "/admin/orders";
  const isAdminMenuPage = currentPath === "/admin/menu";
  const isAdminCouponsPage = currentPath === "/admin/coupons";
  const isAdminReportsPage = currentPath === "/admin/reports";
  const isAdminAddProductPage = currentPath === "/admin/add-product";
  const isAdminEditProductPage = currentPath.startsWith("/admin/edit-product/");
  const adminEditProductLogicalId = isAdminEditProductPage
    ? decodeURIComponent(currentPath.replace(/^\/admin\/edit-product\//, ""))
    : "";
  const isAdminProductFormPage =
    isAdminAddProductPage || isAdminEditProductPage;
  const isCartPage = currentPath === "/cart";
  const isOrderHistoryPage = currentPath === "/orders";
  const isProfilePage = currentPath === "/profile";
  const isCouponWalletPage = currentPath === "/coupons";
  const isCheckoutCouponsPage = currentPath === "/checkout-coupons";
  const isItemPage = currentPath.startsWith("/item/");
  const itemPageId = isItemPage
    ? decodeURIComponent(currentPath.replace(/^\/item\//, ""))
    : "";
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authError, setAuthError] = useState("");
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({
    nickname: "",
    phone: "",
    language: "zh-TW",
  });
  const [cartQtyByItemId, setCartQtyByItemId] = useState<
    Record<string, number>
  >({});
  const [cartOrderItemById, setCartOrderItemById] = useState<
    Record<string, OrderItem>
  >({});
  const [cartTotal, setCartTotal] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [orderNote, setOrderNote] = useState("");
  const [lastSubmittedOrder, setLastSubmittedOrder] = useState<Order | null>(
    null,
  );
  const [completedNoticeOrder, setCompletedNoticeOrder] = useState<Order | null>(
    null,
  );
  const [orderProgress, setOrderProgress] = useState<OrderProgress>({
    latestSubmittedOrderId: null,
    latestCompletedOrderId: null,
    waitingCount: 0,
    readyPickupNumbers: [],
    waitingPickupNumbers: [],
  });
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [staleCartItems, setStaleCartItems] = useState<StaleCartItem[]>([]);
  const [versionHistoryByLogicalId, setVersionHistoryByLogicalId] = useState<
    Record<string, MenuItemVersionHistory[]>
  >({});
  const [adminPriceHistoryModal, setAdminPriceHistoryModal] = useState<{
    itemName: string;
    histories: MenuItemVersionHistory[];
  } | null>(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [isAdminMenuFormOpen, setIsAdminMenuFormOpen] = useState(false);
  const [adminLogin, setAdminLogin] = useState({
    username: "admin",
    password: "admin1234",
  });
  const [adminError, setAdminError] = useState("");
  const [activePromotions, setActivePromotions] = useState<ActivePromotion[]>(
    [],
  );
  const [newPromotion, setNewPromotion] = useState({
    name: "",
    menuItemLogicalIds: [] as string[],
    discountType: "amount" as "amount" | "percent",
    discountValue: "",
    startsDate: todayTaipeiDate(),
    endsDate: todayTaipeiDate(),
  });
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [addonSettings, setAddonSettings] = useState<AddonSettings>({
    eggPrice: 10,
    cheesePrice: 10,
    items: [],
  });
  const [addonSettingsDraft, setAddonSettingsDraft] = useState({
    eggPrice: "10",
    cheesePrice: "10",
    items: [] as AddonSettings["items"],
  });
  const [newAddonDraft, setNewAddonDraft] = useState({
    name: "",
    price: "",
  });
  const [editingCouponCode, setEditingCouponCode] = useState<string | null>(null);
  const [newCoupon, setNewCoupon] = useState<CouponFormState>({
    code: "",
    name: "",
    discountType: "amount" as "amount" | "percent",
    discountValue: "",
    minSpend: "",
    maxDiscount: "",
    usageLimitPerUser: "",
    usageLimitTotal: "",
    startsDate: todayTaipeiDate(),
    endsDate: todayTaipeiDate(),
  });
  const [newMenuItem, setNewMenuItem] = useState({
    price: 50,
    largePrice: "",
    allowEgg: false,
    eggPrice: "10",
    allowCheese: false,
    cheesePrice: "10",
    addonKeys: [] as string[],
    category: "主餐",
    imageUrl: "",
    translations: {
      "zh-TW": { name: "", description: "" },
      en: { name: "", description: "" },
      ja: { name: "", description: "" },
      ko: { name: "", description: "" },
    } as NonNullable<MenuItem["translations"]>,
  });
  const [editingAdminMenuLogicalId, setEditingAdminMenuLogicalId] = useState<
    string | null
  >(null);
  const [couponCode, setCouponCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [couponWalletNotice, setCouponWalletNotice] = useState("");
  const [collectedCouponCodes, setCollectedCouponCodes] = useState<string[]>([]);
  const [adminMenuNotice, setAdminMenuNotice] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [adminOrders, setAdminOrders] = useState<Order[]>([]);
  const [adminOrderActionId, setAdminOrderActionId] = useState<number | null>(
    null,
  );
  const [pendingAdminOrderAction, setPendingAdminOrderAction] = useState<{
    orderId: number;
    action: "complete" | "pick-up";
  } | null>(null);
  const [adminHistoryDate, setAdminHistoryDate] = useState(todayTaipeiDate());
  const [adminStatsDate, setAdminStatsDate] = useState(todayTaipeiDate());
  const [adminRevenueStartDate, setAdminRevenueStartDate] = useState(
    todayTaipeiDate(),
  );
  const [adminRevenueEndDate, setAdminRevenueEndDate] = useState(
    todayTaipeiDate(),
  );
  const [checkedPosItems, setCheckedPosItems] = useState<Record<string, boolean>>(
    {},
  );
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartView, setCartView] = useState<"items" | "checkout">("items");
  const [isClearingCart, setIsClearingCart] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [nowText, setNowText] = useState(
    new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
  );
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [cartDraft, setCartDraft] = useState({
    qty: 1,
    size: "small" as "small" | "large",
    eggQty: 0,
    cheeseQty: 0,
    addons: [] as NonNullable<OrderItem["addons"]>,
    sugarLevel: "",
    iceLevel: "",
    note: "",
  });
  const text = uiText[profile.language] ?? uiText["zh-TW"];
  const routeItem =
    itemPageId && items.length > 0
      ? items.find((item) => item.id === itemPageId || item.logicalId === itemPageId) ??
        null
      : null;
  const activeCustomizingItem = customizingItem ?? routeItem;

  function navigate(path: string): void {
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setCurrentPath(path);
  }

  function resetNewMenuItemForm(): void {
    setEditingAdminMenuLogicalId(null);
    setNewMenuItem({
      price: 50,
      largePrice: "",
      allowEgg: false,
      eggPrice: "10",
      allowCheese: false,
      cheesePrice: "10",
      addonKeys: [],
      category: "主餐",
      imageUrl: "",
      translations: {
        "zh-TW": { name: "", description: "" },
        en: { name: "", description: "" },
        ja: { name: "", description: "" },
        ko: { name: "", description: "" },
      },
    });
  }

  function openEditAdminMenuItem(item: MenuItem): void {
    setEditingAdminMenuLogicalId(item.logicalId);
    setNewMenuItem({
      price: item.price,
      largePrice: item.largePrice === undefined ? "" : String(item.largePrice),
      allowEgg: item.eggPrice !== undefined,
      eggPrice: item.eggPrice === undefined ? "10" : String(item.eggPrice),
      allowCheese: item.cheesePrice !== undefined,
      cheesePrice:
        item.cheesePrice === undefined ? "10" : String(item.cheesePrice),
      addonKeys: item.addonKeys ?? [],
      category: item.category,
      imageUrl: item.imageUrl,
      translations:
        item.translations ?? {
          "zh-TW": { name: item.name, description: item.description },
          en: { name: item.name, description: item.description },
          ja: { name: item.name, description: item.description },
          ko: { name: item.name, description: item.description },
        },
    });
    setAdminMenuNotice("");
    navigate(`/admin/edit-product/${encodeURIComponent(item.logicalId)}`);
  }

  const statusText = (status: Order["status"]) => {
    if (status === "picked_up") return text.pickedUp;
    if (status === "completed") return text.completed;
    if (status === "submitted") return text.making;
    return text.pendingCart;
  };
  const menuCopy = (item: MenuItem) =>
    builtInMenuTranslations[item.name]?.[profile.language] ??
    item.translations?.[profile.language] ??
    item.translations?.["zh-TW"] ?? {
      name: item.name,
      description: item.description,
    };
  const orderItemName = (detail: OrderItem) => {
    const currentItem =
      items.find((item) => item.id === detail.menuItemId) ??
      items.find(
        (item) =>
          item.name === detail.menuItemName ||
          item.translations?.["zh-TW"]?.name === detail.menuItemName,
      );
    if (currentItem) return menuCopy(currentItem).name;
    return (
      builtInMenuTranslations[detail.menuItemName]?.[profile.language]?.name ??
      detail.menuItemName
    );
  };
  const orderItemMenuItem = (detail: OrderItem) =>
    items.find((item) => item.id === detail.menuItemId) ??
    items.find(
      (item) =>
        item.logicalId === detail.menuItemId ||
        item.name === detail.menuItemName ||
        item.translations?.["zh-TW"]?.name === detail.menuItemName,
    );
  const orderItemIsDrink = (detail: OrderItem) => {
    const currentItem = orderItemMenuItem(detail);
    return currentItem ? isDrink(currentItem) : Boolean(detail.sugarLevel || detail.iceLevel);
  };
  const categoryLabel = (category: string) =>
    categoryLabels[profile.language]?.[category] ?? category;
  const sugarLabel = (option: string) =>
    sugarOptionLabels[profile.language]?.[option] ?? option;
  const iceLabel = (option: string) =>
    iceOptionLabels[profile.language]?.[option] ?? option;
  const orderItemSpecification = (detail: OrderItem) => {
    const item = orderItemMenuItem(detail);
    const parts: string[] = [];
    if (detail.size === "large") {
      parts.push(text.large);
    } else if (detail.size === "small" && item?.largePrice !== undefined) {
      parts.push(text.small);
    }
    if ((detail.eggQty ?? 0) > 0) {
      parts.push(`${text.addEgg} x ${detail.eggQty}`);
    }
    if ((detail.cheeseQty ?? 0) > 0) {
      parts.push(`${text.addCheese} x ${detail.cheeseQty}`);
    }
    for (const addon of detail.addons ?? []) {
      if (addon.qty > 0) parts.push(`${addon.name} x ${addon.qty}`);
    }
    return parts.join(" / ");
  };
  const couponCanApply = appliedCoupon ? isCouponUsable(appliedCoupon) : false;
  const couponDiscountTotal = useMemo(
    () => calculateCouponDiscount(couponCanApply ? appliedCoupon : null, cartTotal),
    [appliedCoupon, cartTotal, couponCanApply],
  );
  const checkoutTotal = Math.max(0, cartTotal - couponDiscountTotal);
  const collectedCoupons = collectedCouponCodes
    .map((code) => coupons.find((coupon) => coupon.code === code))
    .filter((coupon): coupon is Coupon => Boolean(coupon));
  const availableCollectedCoupons = collectedCoupons.filter((coupon) =>
    isCouponUsable(coupon),
  );
  const unavailableCollectedCoupons = collectedCoupons.filter(
    (coupon) => !isCouponUsable(coupon),
  );
  const recommendedCoupons = coupons.filter(
    (coupon) =>
      isCouponCollectable(coupon) &&
      !collectedCouponCodes.includes(coupon.code),
  );
  const customizingUnitPrice = activeCustomizingItem
    ? promotionalMenuItemPrice(
        activeCustomizingItem,
        cartDraft.size === "large" &&
          activeCustomizingItem.largePrice !== undefined
          ? activeCustomizingItem.largePrice
          : activeCustomizingItem.price,
      ) +
      (activeCustomizingItem.eggPrice ?? 0) * cartDraft.eggQty
      + (activeCustomizingItem.cheesePrice ?? 0) * cartDraft.cheeseQty
      + (cartDraft.addons ?? []).reduce(
        (sum, addon) => sum + addon.price * addon.qty,
        0,
      )
    : 0;

  function syncCartFromOrder(order: Order) {
    const nextQtyByItemId = order.items.reduce(
      (acc, orderItem) => {
        acc[orderItem.menuItemId] =
          (acc[orderItem.menuItemId] ?? 0) + orderItem.qty;
        return acc;
      },
      {} as Record<string, number>,
    );
    const nextOrderItemById = order.items.reduce(
      (acc, orderItem) => {
        acc[String(orderItem.id ?? `${orderItem.menuItemId}-${Object.keys(acc).length}`)] =
          orderItem;
        return acc;
      },
      {} as Record<string, OrderItem>,
    );

    setCartQtyByItemId(nextQtyByItemId);
    setCartOrderItemById(nextOrderItemById);
    setCartTotal(order.total);
  }

  function resetCartState() {
    setOrderId(null);
    setCartQtyByItemId({});
    setCartOrderItemById({});
    setCartTotal(0);
    setOrderNote("");
    setCouponCode("");
    setAppliedCoupon(null);
    setCustomerName("");
    setCustomerPhone("");
    setPickupTime("");
    setStaleCartItems([]);
    setCartView("items");
    setIsCartOpen(false);
  }

  async function loadMenu(): Promise<void> {
    const response = await fetch(buildApiUrl("/api/menu"));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ApiDataResponse<MenuItem[]>;
    setItems(Array.isArray(payload?.data) ? payload.data : []);
  }

  async function loadCoupons(): Promise<void> {
    const response = await fetch(buildApiUrl("/api/coupons"));
    if (!response.ok) return;

    const payload = (await response.json()) as ApiDataResponse<Coupon[]>;
    setCoupons(Array.isArray(payload?.data) ? payload.data : []);
  }

  async function loadAddonSettings(): Promise<void> {
    const response = await fetch(buildApiUrl("/api/addons"));
    if (!response.ok) return;

    const payload = (await response.json()) as ApiDataResponse<AddonSettings>;
    if (!payload?.data) return;
    const settings = normalizeAddonSettings(payload.data);
    setAddonSettings(settings);
    setAddonSettingsDraft({
      eggPrice: String(settings.eggPrice),
      cheesePrice: String(settings.cheesePrice),
      items: settings.items,
    });
  }

  async function loadCurrentOrder(): Promise<Order | null> {
    const response = await fetch(buildApiUrl("/api/orders/current"), {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Load current order failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ApiDataResponse<Order | null>;
    const currentOrder = payload?.data;

    if (!currentOrder) {
      resetCartState();
      return null;
    }

    setOrderId(currentOrder.id);
    syncCartFromOrder(currentOrder);
    return currentOrder;
  }

  async function loadOrderHistory(): Promise<void> {
    setHistoryLoading(true);

    try {
      const response = await fetch(buildApiUrl("/api/orders/history"), {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Load history failed: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as ApiDataResponse<Order[]>;
      setHistoryOrders(Array.isArray(payload?.data) ? payload.data : []);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadOrderProgress(): Promise<void> {
    const response = await fetch(buildApiUrl("/api/orders/progress"));
    if (!response.ok) return;

    const payload = (await response.json()) as ApiDataResponse<OrderProgress>;
    if (payload?.data) setOrderProgress(payload.data);
  }

  async function refreshUserOrders(): Promise<void> {
    await Promise.all([loadCurrentOrder(), loadOrderHistory()]);
  }

  useEffect(() => {
    let mounted = true;

    // V9: 從 Better Auth session cookie 恢復登入狀態（不再用 localStorage）
    async function restoreSession() {
      try {
        const res = await fetch(buildApiUrl("/api/auth/get-session"), {
          credentials: "include",
        });
        if (res.ok) {
          const data = (await res.json()) as { user?: SessionUser } | null;
          if (data?.user && mounted) {
            setUser(data.user);
          }
        }
      } catch {
        // session 無法取得，維持未登入狀態
      }
    }
    void restoreSession();

    async function loadInitialMenu() {
      try {
        if (mounted) {
          await Promise.all([loadMenu(), loadCoupons(), loadAddonSettings()]);
        }
      } catch (fetchError) {
        if (mounted) {
          setError("無法取得菜單資料，請稍後再試。");
          console.error(fetchError);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadInitialMenu();
    void loadOrderProgress();
    const progressTimer = window.setInterval(() => {
      void loadOrderProgress();
    }, 10000);
    const clockTimer = window.setInterval(() => {
      setNowText(
        new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
      );
    }, 1000);

    return () => {
      mounted = false;
      window.clearInterval(progressTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setHistoryOrders([]);
      setIsHistoryOpen(false);
      setIsProfileOpen(false);
      setIsCartOpen(false);
      setCollectedCouponCodes([]);
      if (["/cart", "/orders", "/profile", "/coupons", "/checkout-coupons"].includes(currentPath)) {
        navigate("/");
      }
      resetCartState();
      return;
    }

    const storageKey = `breakfast-profile:${user.id}`;
    const savedProfile = window.localStorage.getItem(storageKey);
    let nextProfile: UserProfile = {
      nickname: user.name,
      phone: "",
      language: "zh-TW",
    };
    if (savedProfile) {
      try {
        nextProfile = {
          ...nextProfile,
          ...(JSON.parse(savedProfile) as Partial<UserProfile>),
        };
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }
    setProfile(nextProfile);
    setCustomerName(nextProfile.nickname || user.name);
    setCustomerPhone(nextProfile.phone);
    const savedCouponCodes = window.localStorage.getItem(
      `breakfast-coupons:${user.id}`,
    );
    if (!savedCouponCodes) {
      setCollectedCouponCodes([]);
    } else {
      try {
        const parsedCouponCodes = JSON.parse(savedCouponCodes) as unknown;
        setCollectedCouponCodes(
          Array.isArray(parsedCouponCodes)
            ? parsedCouponCodes.filter(
                (code): code is string => typeof code === "string",
              )
            : [],
        );
      } catch {
        window.localStorage.removeItem(`breakfast-coupons:${user.id}`);
        setCollectedCouponCodes([]);
      }
    }

    void refreshUserOrders().catch((refreshError) => {
      setActionError("載入使用者訂單資料失敗，請稍後再試。");
      console.error(refreshError);
    });
  }, [currentPath, user]);

  function saveProfile(nextProfile: UserProfile) {
    if (!user) return;

    const normalizedPhone = nextProfile.phone.trim();
    if (normalizedPhone && !isTaiwanMobilePhone(normalizedPhone)) {
      setProfileNotice(text.phoneInvalid);
      return;
    }

    const normalizedProfile = {
      ...nextProfile,
      nickname: nextProfile.nickname.trim(),
      phone: normalizedPhone,
    };

    setProfile(normalizedProfile);
    setCustomerName(normalizedProfile.nickname || user.name);
    setCustomerPhone(normalizedProfile.phone);
    window.localStorage.setItem(
      `breakfast-profile:${user.id}`,
      JSON.stringify(normalizedProfile),
    );
    setIsProfileOpen(false);
    navigate("/");
  }

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!completedNoticeOrder) return;

    const timer = window.setTimeout(() => {
      setCompletedNoticeOrder(null);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [completedNoticeOrder]);

  useEffect(() => {
    if (!checkoutNotice) return;

    const timer = window.setTimeout(() => {
      setCheckoutNotice("");
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [checkoutNotice]);

  useEffect(() => {
    if (!profileNotice) return;

    const timer = window.setTimeout(() => {
      setProfileNotice("");
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [profileNotice]);

  useEffect(() => {
    if (!couponWalletNotice) return;

    const timer = window.setTimeout(() => {
      setCouponWalletNotice("");
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [couponWalletNotice]);

  useEffect(() => {
    if (!adminError) return;

    const timer = window.setTimeout(() => {
      setAdminError("");
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [adminError]);

  useEffect(() => {
    if (!adminMenuNotice) return;

    const timer = window.setTimeout(() => {
      setAdminMenuNotice("");
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [adminMenuNotice]);

  useEffect(() => {
    if (
      !isAdminEditProductPage ||
      !adminEditProductLogicalId ||
      editingAdminMenuLogicalId === adminEditProductLogicalId
    ) {
      return;
    }

    const item = items.find(
      (menuItem) => menuItem.logicalId === adminEditProductLogicalId,
    );
    if (item) {
      openEditAdminMenuItem(item);
    }
  }, [
    adminEditProductLogicalId,
    editingAdminMenuLogicalId,
    isAdminEditProductPage,
    items,
  ]);

  useEffect(() => {
    const shouldLockBody =
      Boolean(adminPriceHistoryModal) ||
      Boolean(confirmDialog) ||
      (isAdminPage
        ? isAdminMenuPage && isAdminMenuFormOpen
        : isCartPage ||
          isOrderHistoryPage ||
          isCartOpen ||
          isHistoryOpen ||
          isProfileOpen ||
          Boolean(customizingItem));
    if (!shouldLockBody) {
      document.body.style.overflow = "";
      document.body.style.position = "";
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    document.body.style.overflow = "hidden";
    document.body.style.position = "relative";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
    };
  }, [
    customizingItem,
    isAdminMenuPage,
    isAdminPage,
    isAdminMenuFormOpen,
    adminPriceHistoryModal,
    confirmDialog,
    isCartPage,
    isOrderHistoryPage,
    isCartOpen,
    isHistoryOpen,
    isProfileOpen,
  ]);

  useEffect(() => {
    if (!isItemPage) return;

    if (!user) {
      setCustomizingItem(null);
      setActionError("請先使用 Google 登入後再加入購物車。");
      navigate("/");
      return;
    }

    if (!routeItem) {
      if (!loading && items.length > 0) {
        setCustomizingItem(null);
        setActionError("找不到這個商品，請重新選擇。");
        navigate("/");
      }
      return;
    }

    setCustomizingItem(routeItem);
    setCartDraft({
      qty: 1,
      size: "small",
      eggQty: 0,
      cheeseQty: 0,
      addons: [],
      sugarLevel: "",
      iceLevel: "",
      note: "",
    });
  }, [isItemPage, items.length, loading, routeItem?.id, user]);

  useEffect(() => {
    if (!isAdminAddProductPage) return;

    resetNewMenuItemForm();
  }, [isAdminAddProductPage]);

  useEffect(() => {
    if (!user || !(isCartOpen || isCartPage) || cartView !== "checkout") return;

    setCustomerName((current) => current.trim() || profile.nickname || user.name);
    setCustomerPhone((current) => current.trim() || profile.phone);
  }, [cartView, isCartOpen, isCartPage, profile.nickname, profile.phone, user]);

  useEffect(() => {
    if (!user || !isOrderHistoryPage) return;
    void loadOrderHistory();
  }, [isOrderHistoryPage, user]);

  useEffect(() => {
    if (!lastSubmittedOrder || completedNoticeOrder) return;

    const submittedNumber =
      lastSubmittedOrder.dailySequence ?? lastSubmittedOrder.id;
    if (orderProgress.latestCompletedOrderId === submittedNumber) {
      setCompletedNoticeOrder(lastSubmittedOrder);
      setLastSubmittedOrder(null);
    }
  }, [completedNoticeOrder, lastSubmittedOrder, orderProgress.latestCompletedOrderId]);

  const grouped = useMemo(() => {
    const recentItems = items.filter((item) => item.isRecentlyUpdated);
    const groupedItems = items.reduce(
      (acc, item) => {
        if (item.isRecentlyUpdated) return acc;
        const category = item?.category || "未分類";
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(item);
        return acc;
      },
      {} as Record<string, MenuItem[]>,
    );

    const categories = Object.keys(groupedItems).sort((a, b) =>
      a.localeCompare(b, "zh-Hant"),
    );

    return { groupedItems, categories, recentItems };
  }, [items]);
  const promotionalItems = items.filter((item) => item.activePromotion);

  useEffect(() => {
    if (!isAdminPage || loading || items.length === 0) return;

    async function restoreAdmin() {
      const response = await fetch(buildApiUrl("/api/admin/session"), {
        credentials: "include",
      });
      if (response.ok) {
        setAdminAuthed(true);
        await loadAdminData();
      }
    }

    void restoreAdmin();
  }, [isAdminPage, loading, items]);

  const cartItemCount = useMemo(
    () => Object.values(cartQtyByItemId).reduce((sum, qty) => sum + qty, 0),
    [cartQtyByItemId],
  );

  const cartDetails = useMemo<CartDetail[]>(() => {
    const itemById = new Map(items.map((item) => [item.id, item]));

    return Object.values(cartOrderItemById)
      .map((orderItem) => {
        const item = itemById.get(orderItem.menuItemId);
        if (!item || orderItem.qty <= 0) {
          return null;
        }

        return {
          itemId: orderItem.menuItemId,
          orderItemId: orderItem.id,
          qty: orderItem.qty,
          item,
          orderItem,
          subtotal: orderItem.menuItemPrice * orderItem.qty,
        };
      })
      .filter((entry): entry is CartDetail => entry !== null);
  }, [cartOrderItemById, items]);

  const cartGroups = useMemo(() => {
    const groupByItemId = new Map<
      string,
      {
        itemId: string;
        item: MenuItem;
        lines: CartDetail[];
        qty: number;
        subtotal: number;
      }
    >();

    for (const detail of cartDetails) {
      const group =
        groupByItemId.get(detail.itemId) ??
        {
          itemId: detail.itemId,
          item: detail.item,
          lines: [],
          qty: 0,
          subtotal: 0,
        };

      group.lines.push(detail);
      group.qty += detail.qty;
      group.subtotal += detail.subtotal;
      groupByItemId.set(detail.itemId, group);
    }

    return Array.from(groupByItemId.values());
  }, [cartDetails]);

  const todayAdminStats = useMemo(() => {
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Taipei",
    });
    const todayStats = buildOrderStats(adminOrders, today);

    return {
      submittedToday: todayStats.submittedOrders,
      revenue: todayStats.revenue,
      pendingCount: adminOrders.filter((order) => order.status === "submitted")
        .length,
      completedCount: todayStats.submittedOrders.filter(
        (order) => order.status === "completed" || order.status === "picked_up",
      ).length,
      itemRanking: todayStats.itemRanking,
      hourlyRanking: todayStats.hourlyRanking,
    };
  }, [adminOrders]);

  const selectedAdminStats = useMemo(
    () => buildOrderStats(adminOrders, adminStatsDate),
    [adminOrders, adminStatsDate],
  );

  const adminRevenueRangeStats = useMemo(
    () =>
      buildOrderRangeStats(
        adminOrders,
        adminRevenueStartDate,
        adminRevenueEndDate,
      ),
    [adminOrders, adminRevenueEndDate, adminRevenueStartDate],
  );

  const adminHistoryOrders = useMemo(
    () =>
      adminOrders
        .filter(
          (order) =>
            order.status === "picked_up" &&
            submittedOrderDate(order) === adminHistoryDate,
        )
        .sort(
          (a, b) =>
            new Date(b.submittedAt ?? b.createdAt).getTime() -
            new Date(a.submittedAt ?? a.createdAt).getTime(),
        ),
    [adminHistoryDate, adminOrders],
  );

  function couponUsedCount(coupon: Coupon) {
    return adminOrders.filter(
      (order) =>
        order.status !== "pending" && order.couponCode === coupon.code,
    ).length;
  }

  function couponRemainingText(coupon: Coupon) {
    const limit = coupon.usageLimitTotal ?? 0;
    if (limit <= 0) return "不限量";
    return `剩餘 ${Math.max(0, limit - couponUsedCount(coupon))} / ${limit} 張`;
  }

  async function ensureOrder(): Promise<number> {
    if (!user) {
      throw new Error("Please login first");
    }

    if (orderId !== null) {
      return orderId;
    }

    const response = await fetch(buildApiUrl("/api/orders"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        setUser(null);
        setAuthError("登入狀態已失效，請重新登入。");
        setActionError("登入狀態已失效，請重新登入。");
        setHistoryOrders([]);
        resetCartState();
        throw new Error(`Auth expired: HTTP ${response.status}`);
      }

      throw new Error(`Create order failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ApiDataResponse<Order>;
    const createdOrderId = payload?.data?.id;

    if (!createdOrderId) {
      throw new Error("Create order failed: invalid payload");
    }

    setOrderId(createdOrderId);
    return createdOrderId;
  }

  async function handleGoogleSignIn(): Promise<void> {
    setAuthError("");
    setIsGoogleSigningIn(true);
    try {
      // Better Auth 的 social sign-in 入口是 POST。
      // 先向後端取得導向 Google 同意頁的 URL，再切換瀏覽器位置。
      const callbackURL = window.location.origin;
      const response = await fetch(buildApiUrl("/api/auth/sign-in/social"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: "google", callbackURL }),
      });

      if (!response.ok) {
        throw new Error(`Google sign-in failed: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { url?: string };
      if (!payload?.url) {
        throw new Error("Google sign-in failed: missing redirect URL");
      }

      window.location.href = payload.url;
    } catch {
      setAuthError("Google 登入啟動失敗，請稍後再試。");
      setIsGoogleSigningIn(false);
    }
  }

  async function handleLogout(): Promise<void> {
    // 使用 /api/sign-out（server-side proxy），避免 Better Auth CSRF 驗證
    // 因 BETTER_AUTH_URL 設定錯誤造成的假登出（403 被吃掉）。
    // 若登出失敗，顯示錯誤並中止，確保使用者知道 session 仍存在。
    try {
      const res = await fetch(buildApiUrl("/api/sign-out"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setActionError(
          `登出失敗（HTTP ${res.status}），請重試或手動清除瀏覽器 Cookie。`,
        );
        return;
      }
    } catch {
      setActionError("登出時發生網路錯誤，請重試。");
      return;
    }
    setUser(null);
    setAuthError("");
    setActionError("");
    resetCartState();
  }

  async function loadVersionHistory(
    logicalId: string,
  ): Promise<MenuItemVersionHistory[]> {
    const cached = versionHistoryByLogicalId[logicalId];
    if (cached) return cached;
    setLoadingHistoryId(logicalId);
    setActionError("");

    try {
      const response = await fetch(
        buildApiUrl(`/api/menu/${logicalId}/history`),
        { credentials: "include" },
      );

      if (!response.ok) {
        throw new Error(`Load menu history failed: HTTP ${response.status}`);
      }

      const payload =
        (await response.json()) as ApiDataResponse<MenuItemVersionHistory[]>;
      const histories = Array.isArray(payload?.data) ? payload.data : [];
      setVersionHistoryByLogicalId((current) => ({
        ...current,
        [logicalId]: histories,
      }));
      return histories;
    } catch (historyError) {
      setActionError("讀取版本歷史失敗，請稍後再試。");
      console.error(historyError);
      return [];
    } finally {
      setLoadingHistoryId(null);
    }
  }

  async function loadAdminData(
    options: { clearNotice?: boolean } = {},
  ): Promise<void> {
    setAdminLoading(true);
    if (options.clearNotice !== false) {
      setAdminError("");
    }

    try {
      const [promotionsResponse, ordersResponse, couponsResponse] =
        await Promise.all([
          fetch(buildApiUrl("/api/promotions"), {
            credentials: "include",
          }),
          fetch(buildApiUrl("/api/orders"), {
            credentials: "include",
          }),
          fetch(buildApiUrl("/api/coupons"), {
            credentials: "include",
          }),
        ]);

      if (
        !promotionsResponse.ok ||
        !ordersResponse.ok ||
        !couponsResponse.ok
      ) {
        if (ordersResponse.status === 401) {
          setAdminAuthed(false);
        }
        throw new Error("Admin API failed");
      }

      const promotionsPayload =
        (await promotionsResponse.json()) as ApiDataResponse<
          ActivePromotion[]
        >;
      const ordersPayload =
        (await ordersResponse.json()) as ApiDataResponse<Order[]>;
      const couponsPayload =
        (await couponsResponse.json()) as ApiDataResponse<Coupon[]>;

      setActivePromotions(
        Array.isArray(promotionsPayload?.data) ? promotionsPayload.data : [],
      );
      setAdminOrders(
        Array.isArray(ordersPayload?.data) ? ordersPayload.data : [],
      );
      setCoupons(Array.isArray(couponsPayload?.data) ? couponsPayload.data : []);
    } catch (adminDataError) {
      setAdminError("管理資料讀取失敗，請稍後再試。");
      console.error(adminDataError);
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleAdminLogin(): Promise<void> {
    setAdminError("");
    const response = await fetch(buildApiUrl("/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(adminLogin),
    });

    if (!response.ok) {
      setAdminError("後台登入失敗，請確認帳號密碼。");
      return;
    }

    setAdminAuthed(true);
    await loadAdminData();
  }

  async function handleAdminLogout(): Promise<void> {
    await fetch(buildApiUrl("/api/admin/logout"), {
      method: "POST",
      credentials: "include",
    });
    setAdminAuthed(false);
    setAdminError("");
    setAdminOrders([]);
    setCoupons([]);
    setActivePromotions([]);
    setVersionHistoryByLogicalId({});
    navigate("/admin");
  }

  async function createAdminPromotion(): Promise<void> {
    const name = newPromotion.name.trim();
    const menuItemLogicalIds = newPromotion.menuItemLogicalIds;
    const discountValue = parseWholeNumber(newPromotion.discountValue, 0);
    if (
      !name ||
      menuItemLogicalIds.length === 0 ||
      discountValue < 1 ||
      !newPromotion.startsDate ||
      !newPromotion.endsDate
    ) {
      setAdminError("請填寫完整的促銷活動資料。");
      return;
    }
    if (!window.confirm(`確定要新增促銷「${name}」嗎？`)) return;

    const responses = await Promise.all(
      menuItemLogicalIds.map((menuItemLogicalId) =>
        fetch(buildApiUrl("/api/promotions"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            menuItemLogicalId,
            discountType: newPromotion.discountType,
            discountValue,
            startsAt: `${newPromotion.startsDate}T00:00:00+08:00`,
            endsAt: `${newPromotion.endsDate}T23:59:59+08:00`,
          }),
        }),
      ),
    );
    if (responses.some((response) => !response.ok)) {
      setAdminError("新增促銷失敗，請確認商品代碼與欄位。");
      return;
    }
    setNewPromotion({
      name: "",
      menuItemLogicalIds: [],
      discountType: "amount",
      discountValue: "",
      startsDate: todayTaipeiDate(),
      endsDate: todayTaipeiDate(),
    });
    await Promise.all([loadMenu(), loadAdminData()]);
    setAdminError("促銷活動已新增。");
  }

  async function deleteAdminPromotion(id: number): Promise<void> {
    if (!window.confirm("確定要刪除這個促銷活動嗎？")) return;
    const response = await fetch(buildApiUrl(`/api/promotions/${id}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      setAdminError("刪除促銷失敗。");
      return;
    }
    await Promise.all([loadMenu(), loadAdminData()]);
    setAdminError("促銷活動已刪除。");
  }

  async function createAdminCoupon(): Promise<void> {
    const code = newCoupon.code.trim();
    const name = newCoupon.name.trim();
    const rawDiscountValue = parseWholeNumber(newCoupon.discountValue, 0);
    const discountValue =
      newCoupon.discountType === "percent"
        ? Math.min(100, Math.max(1, rawDiscountValue))
        : rawDiscountValue;
    const minSpend = parseWholeNumber(newCoupon.minSpend, 0);
    const maxDiscount = parseWholeNumber(newCoupon.maxDiscount, 0);
    const usageLimitPerUser = Math.max(
      1,
      parseWholeNumber(newCoupon.usageLimitPerUser, 1),
    );
    const usageLimitTotal = parseWholeNumber(newCoupon.usageLimitTotal, 0);
    if (!code || !name || rawDiscountValue <= 0) {
      setAdminError("請輸入完整的優惠券資料。");
      return;
    }
    if (!newCoupon.startsDate || !newCoupon.endsDate) {
      setAdminError("請選擇優惠券開始日期與結束日期。");
      return;
    }
    if (!editingCouponCode && coupons.some((coupon) => coupon.code === code)) {
      setAdminError("優惠碼已存在，請從右側已創優惠券按「編輯」。");
      return;
    }
    if (
      editingCouponCode &&
      editingCouponCode !== code
    ) {
      setAdminError("編輯優惠券時不能更改優惠碼，請重新新增一張。");
      return;
    }
    if (!window.confirm(`確定要${editingCouponCode ? "更新" : "新增"}優惠券「${code}」嗎？`)) {
      return;
    }

    const response = await fetch(buildApiUrl("/api/coupons"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        code,
        name,
        discountType: newCoupon.discountType,
        discountValue,
        minSpend,
        maxDiscount,
        usageLimitPerUser,
        usageLimitTotal,
        startsAt: taipeiDayBoundaryIso(newCoupon.startsDate, false),
        expiresAt: taipeiDayBoundaryIso(newCoupon.endsDate, true),
        isActive: true,
      }),
    });

    if (!response.ok) {
      setAdminError("新增優惠券失敗。");
      return;
    }

    await loadAdminData();
    await loadCoupons();
    setEditingCouponCode(null);
    setAdminError(`已${editingCouponCode ? "更新" : "新增"}優惠券：${code}`);
  }

  function startEditCoupon(coupon: Coupon): void {
    setEditingCouponCode(coupon.code);
    setNewCoupon({
      code: coupon.code,
      name: coupon.name,
      discountType: coupon.discountType,
      discountValue: String(coupon.discountValue),
      minSpend: coupon.minSpend ? String(coupon.minSpend) : "",
      maxDiscount: coupon.maxDiscount ? String(coupon.maxDiscount) : "",
      usageLimitPerUser: coupon.usageLimitPerUser
        ? String(coupon.usageLimitPerUser)
        : "",
      usageLimitTotal: coupon.usageLimitTotal
        ? String(coupon.usageLimitTotal)
        : "",
      startsDate: dateInputValue(coupon.startsAt),
      endsDate: dateInputValue(coupon.expiresAt),
    });
    setAdminError(`正在編輯優惠券：${coupon.code}`);
  }

  function resetCouponForm(): void {
    setEditingCouponCode(null);
    setNewCoupon({
      code: "",
      name: "",
      discountType: "amount",
      discountValue: "",
      minSpend: "",
      maxDiscount: "",
      usageLimitPerUser: "",
      usageLimitTotal: "",
      startsDate: todayTaipeiDate(),
      endsDate: todayTaipeiDate(),
    });
  }

  function loadMenuImageFile(file: File | null): void {
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const imageUrl = typeof reader.result === "string" ? reader.result : "";
      if (!imageUrl) return;
      setNewMenuItem((current) => ({
        ...current,
        imageUrl,
      }));
    });
    reader.readAsDataURL(file);
  }

  async function deleteAdminCoupon(code: string): Promise<void> {
    if (!window.confirm(`確定要刪除優惠券「${code}」嗎？`)) {
      return;
    }

    const response = await fetch(buildApiUrl(`/api/coupons/${code}`), {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) {
      setAdminError("刪除優惠券失敗。");
      return;
    }

    await loadAdminData();
    await loadCoupons();
    setAdminError(`已刪除優惠券：${code}`);
  }

  async function saveAddonSettings(): Promise<void> {
    if (
      !addonSettingsDraft.eggPrice.trim() ||
      !addonSettingsDraft.cheesePrice.trim()
    ) {
      setAdminError("請輸入完整的共用加料價格。");
      return;
    }
    const eggPrice = parseWholeNumber(addonSettingsDraft.eggPrice);
    const cheesePrice = parseWholeNumber(addonSettingsDraft.cheesePrice);
    if (!window.confirm("確定要更新共用加料價格嗎？新加入購物車的品項會套用新價格。")) {
      return;
    }

    const response = await fetch(buildApiUrl("/api/addons"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        eggPrice,
        cheesePrice,
        items: addonSettingsDraft.items ?? [],
      }),
    });

    if (!response.ok) {
      setAdminError("更新共用加料價格失敗。");
      return;
    }

    const payload = (await response.json()) as ApiDataResponse<AddonSettings>;
    const settings = normalizeAddonSettings(payload.data);
    setAddonSettings(settings);
    setAddonSettingsDraft({
      eggPrice: String(settings.eggPrice),
      cheesePrice: String(settings.cheesePrice),
      items: settings.items,
    });
    await loadMenu();
    setAdminError("共用加料價格已更新。");
  }

  function addAddonDraft(): void {
    const name = newAddonDraft.name.trim();
    const priceText = newAddonDraft.price.trim();
    if (!name || !priceText) {
      setAdminError("請輸入加料名稱與價格。");
      return;
    }
    const key = `addon-${Date.now()}`;
    setAddonSettingsDraft((current) => ({
      ...current,
      items: [
        ...(current.items ?? []),
        { key, name, price: parseWholeNumber(priceText), isActive: true },
      ],
    }));
    setNewAddonDraft({ name: "", price: "" });
    setAdminError("已加入加料草稿，請按更新加料價格儲存。");
  }

  async function saveAdminMenuItem(): Promise<void> {
    const missingTranslation = menuLanguageOptions.some((option) => {
      const translation = newMenuItem.translations[option.value];
      return !translation.name.trim() || !translation.description.trim();
    });
    if (missingTranslation) {
      setAdminMenuNotice("儲存商品失敗：四種語言的名稱與介紹都要填。");
      return;
    }
    if (!newMenuItem.imageUrl.trim() || newMenuItem.price < 0) {
      setAdminMenuNotice("請輸入完整的商品價格與圖片。");
      return;
    }
    if (
      !window.confirm(
        editingAdminMenuLogicalId
          ? "確定要更新這個商品嗎？"
          : "確定要新增這個商品嗎？",
      )
    ) {
      return;
    }

    const isEditing = Boolean(editingAdminMenuLogicalId);
    const targetLogicalId = editingAdminMenuLogicalId;
    const requestBody = isEditing
      ? {
          changes: {
            price: newMenuItem.price,
            largePrice:
              newMenuItem.largePrice === ""
                ? null
                : Number(newMenuItem.largePrice),
            eggPrice:
              !newMenuItem.allowEgg ? null : addonSettings.eggPrice,
            cheesePrice:
              !newMenuItem.allowCheese ? null : addonSettings.cheesePrice,
            addonKeys: newMenuItem.addonKeys,
            category: newMenuItem.category,
            imageUrl: newMenuItem.imageUrl,
            translations: newMenuItem.translations,
          },
          reason: "POS 後台更新商品資料",
          versionLevel: "minor" as const,
        }
      : {
          price: newMenuItem.price,
          largePrice:
            newMenuItem.largePrice === ""
              ? undefined
              : Number(newMenuItem.largePrice),
          eggPrice:
            !newMenuItem.allowEgg ? undefined : addonSettings.eggPrice,
          cheesePrice:
            !newMenuItem.allowCheese ? undefined : addonSettings.cheesePrice,
          addonKeys: newMenuItem.addonKeys,
          category: newMenuItem.category,
          imageUrl: newMenuItem.imageUrl,
          translations: newMenuItem.translations,
        };

    resetNewMenuItemForm();
    setIsAdminMenuFormOpen(false);
    navigate("/admin/menu");
    setAdminError(isEditing ? "商品更新中..." : "商品新增中...");

    let response: Response;
    try {
      response = await fetch(
        buildApiUrl(
          targetLogicalId
            ? `/api/menu/${targetLogicalId}`
            : "/api/menu",
        ),
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(requestBody),
        },
      );
    } catch {
      setAdminError("儲存商品失敗，請檢查網路後重新開啟商品編輯。");
      return;
    }

    if (!response.ok) {
      setAdminError("儲存商品失敗，請重新開啟商品編輯並確認資料。");
      return;
    }

    const notice = isEditing ? "商品已更新。" : "商品已新增。";
    await Promise.all([loadMenu(), loadAdminData()]);
    setAdminError(notice);
  }

  async function updateAdminMenuPrice(item: MenuItem): Promise<void> {
    const raw = window.prompt(`調整「${item.name}」價格`, String(item.price));
    if (!raw) return;
    const price = Number(raw);
    if (!Number.isFinite(price) || price < 0) return;
    if (!window.confirm(`確定要把「${item.name}」改成 ${formatMoney(price)} 嗎？`)) {
      return;
    }

    const response = await fetch(buildApiUrl(`/api/menu/${item.logicalId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        changes: { price },
        reason: "POS 後台調整價格",
        versionLevel: "minor",
      }),
    });

    if (!response.ok) {
      setAdminError("調整價格失敗。");
      return;
    }

    await loadMenu();
    await loadAdminData();
    setAdminError(`已調整「${item.name}」價格。`);
  }

  async function deleteAdminMenuItem(item: MenuItem): Promise<void> {
    if (!window.confirm(`確定要刪除商品「${item.name}」嗎？`)) {
      return;
    }

    const response = await fetch(buildApiUrl(`/api/menu/${item.logicalId}`), {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) {
      setAdminError("刪除商品失敗。");
      return;
    }

    await Promise.all([loadMenu(), loadAdminData()]);
    setAdminError(`已刪除商品：${item.name}`);
  }

  async function completeAdminOrder(orderId: number): Promise<void> {
    setAdminOrderActionId(orderId);
    setPendingAdminOrderAction(null);
    setAdminError("正在更新訂單狀態...");
    try {
      const response = await fetch(buildApiUrl(`/api/orders/${orderId}/complete`), {
        method: "PATCH",
        credentials: "include",
      });

      if (!response.ok) {
        setAdminError("完成訂單失敗，請重新整理後再試。");
        return;
      }

      const payload = (await response.json()) as ApiDataResponse<Order>;
      const completedOrder = payload.data;
      setAdminOrders((current) =>
        current.map((order) => (order.id === orderId ? completedOrder : order)),
      );
      const dailySequence = completedOrder.dailySequence ?? orderId;
      setAdminError(`今日單號 #${dailySequence} 已完成，等待顧客取貨。`);
      void Promise.all([
        loadAdminData({ clearNotice: false }),
        loadOrderProgress(),
      ]).catch((error) => console.error(error));
    } catch (error) {
      console.error(error);
      setAdminError("完成訂單失敗，請檢查網路後再試。");
    } finally {
      setAdminOrderActionId(null);
    }
  }

  async function pickUpAdminOrder(orderId: number): Promise<void> {
    setAdminOrderActionId(orderId);
    setPendingAdminOrderAction(null);
    setAdminError("正在更新取貨狀態...");
    try {
      const response = await fetch(buildApiUrl(`/api/orders/${orderId}/pick-up`), {
        method: "PATCH",
        credentials: "include",
      });

      if (!response.ok) {
        setAdminError("更新取貨狀態失敗，請重新整理後再試。");
        return;
      }

      const payload = (await response.json()) as ApiDataResponse<Order>;
      const pickedUpOrder = payload.data;
      setAdminOrders((current) =>
        current.map((order) => (order.id === orderId ? pickedUpOrder : order)),
      );
      const dailySequence = pickedUpOrder.dailySequence ?? orderId;
      setAdminError(`今日單號 #${dailySequence} 已取貨並移至歷史訂單。`);
      void Promise.all([
        loadAdminData({ clearNotice: false }),
        loadOrderProgress(),
      ]).catch((error) => console.error(error));
    } catch (error) {
      console.error(error);
      setAdminError("更新取貨狀態失敗，請檢查網路後再試。");
    } finally {
      setAdminOrderActionId(null);
    }
  }

  function requestAdminOrderConfirmation(
    order: Order,
    action: "complete" | "pick-up",
  ): void {
    setPendingAdminOrderAction({
      orderId: order.id,
      action,
    });
  }

  function openAddToCart(item: MenuItem) {
    if (!user) {
      setActionError("請先使用 Google 登入後再加入購物車。");
      return;
    }

    setCartDraft({
      qty: 1,
      size: "small",
      eggQty: 0,
      cheeseQty: 0,
      addons: [],
      sugarLevel: "",
      iceLevel: "",
      note: "",
    });
    setCustomizingItem(item);
    navigate(`/item/${encodeURIComponent(item.id)}`);
  }

  async function addToCart(
    item: MenuItem,
    options: {
      qty: number;
      size?: "small" | "large";
      eggQty?: number;
      cheeseQty?: number;
      addons?: NonNullable<OrderItem["addons"]>;
      sugarLevel?: string;
      iceLevel?: string;
      note?: string;
    },
  ): Promise<void> {
    setActionError("");
    setStaleCartItems([]);
    setActiveItemId(item.id);

    try {
      if (!user) {
        throw new Error("Please login first");
      }

      const patchOrderItem = async (
        targetOrderId: number,
        qty: number,
      ): Promise<Order> => {
        const response = await fetch(
          buildApiUrl(`/api/orders/${targetOrderId}`),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              itemId: item.id,
              qty,
              size: options.size,
              eggQty: options.eggQty,
              cheeseQty: options.cheeseQty,
              addons: options.addons,
              sugarLevel: options.sugarLevel || undefined,
              iceLevel: options.iceLevel || undefined,
              note: options.note?.trim() || undefined,
              forceNew: true,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Update order failed: HTTP ${response.status}`);
        }

        const payload = (await response.json()) as ApiDataResponse<Order>;
        const updatedOrder = payload?.data;

        if (!updatedOrder) {
          throw new Error("Update order failed: invalid payload");
        }

        return updatedOrder;
      };

      const targetOrderId = await ensureOrder();
      const nextQty = Math.max(1, options.qty);

      try {
        const updatedOrder = await patchOrderItem(targetOrderId, nextQty);
        syncCartFromOrder(updatedOrder);
      } catch (firstTryError) {
        const firstTryMessage =
          firstTryError instanceof Error ? firstTryError.message : "";

        // 換帳號或舊訂單失效時，重新同步目前使用者訂單後再重試一次。
        if (
          firstTryMessage.includes("HTTP 403") ||
          firstTryMessage.includes("HTTP 404")
        ) {
          setOrderId(null);

          const recoveredOrder = await loadCurrentOrder();
          const retryOrderId = recoveredOrder?.id ?? (await ensureOrder());
          const retriedOrder = await patchOrderItem(retryOrderId, nextQty);
          syncCartFromOrder(retriedOrder);
          return;
        }

        throw firstTryError;
      }
    } catch (cartError) {
      if (
        cartError instanceof Error &&
        cartError.message.startsWith("Auth expired:")
      ) {
        return;
      }

      if (user) {
        try {
          const recoveredOrder = await loadCurrentOrder();
          const recoveredQty = recoveredOrder?.items.find(
            (orderItem) => orderItem.menuItemId === item.id,
          )?.qty;

          if (typeof recoveredQty === "number" && recoveredQty > 0) {
            return;
          }
        } catch (recoveryError) {
          console.error(recoveryError);
        }
      }

      setActionError("加入購物車失敗，請稍後再試。");
      console.error(cartError);
    } finally {
      setActiveItemId(null);
      setCustomizingItem(null);
      if (currentPath.startsWith("/item/")) {
        navigate("/");
      }
    }
  }

  async function buyAgain(order: Order): Promise<void> {
    if (!user || order.items.length === 0) return;

    setActionError("");
    setActiveItemId(`order-${order.id}`);

    try {
      const targetOrderId = await ensureOrder();
      let latestOrder: Order | null = null;

      for (const orderItem of order.items) {
        const response = await fetch(buildApiUrl(`/api/orders/${targetOrderId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            itemId: orderItem.menuItemId,
            qty: orderItem.qty,
            sugarLevel: orderItem.sugarLevel,
            iceLevel: orderItem.iceLevel,
            note: orderItem.note,
            size: orderItem.size,
            eggQty: orderItem.eggQty,
            cheeseQty: orderItem.cheeseQty,
            addons: orderItem.addons,
            forceNew: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`Buy again failed: HTTP ${response.status}`);
        }

        const payload = (await response.json()) as ApiDataResponse<Order>;
        latestOrder = payload.data;
      }

      if (latestOrder) syncCartFromOrder(latestOrder);
      setCartView("items");
      setIsHistoryOpen(false);
      navigate("/cart");
    } catch (buyAgainError) {
      setActionError("重新加入購物車失敗，可能有品項已下架或版本已更新。");
      console.error(buyAgainError);
    } finally {
      setActiveItemId(null);
    }
  }

  async function updateCartItemOptions(
    orderItemId: number | undefined,
    itemId: string,
    next: {
      sugarLevel?: string;
      iceLevel?: string;
      note?: string;
      size?: "small" | "large";
      eggQty?: number;
      cheeseQty?: number;
      addons?: NonNullable<OrderItem["addons"]>;
    },
  ): Promise<void> {
    if (!user || orderId === null) return;

    const current = Object.values(cartOrderItemById).find(
      (item) => item.id === orderItemId,
    );
    const qty = current?.qty ?? cartQtyByItemId[itemId] ?? 0;
    if (qty <= 0) return;
    const response = await fetch(buildApiUrl(`/api/orders/${orderId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        itemId,
        orderItemId,
        qty,
        sugarLevel: next.sugarLevel ?? current?.sugarLevel,
        iceLevel: next.iceLevel ?? current?.iceLevel,
        note: next.note ?? current?.note,
        size: next.size ?? current?.size,
        eggQty: next.eggQty ?? current?.eggQty,
        cheeseQty: next.cheeseQty ?? current?.cheeseQty,
        addons: next.addons ?? current?.addons,
      }),
    });

    if (!response.ok) {
      setActionError("更新品項選項失敗，請稍後再試。");
      return;
    }

    const payload = (await response.json()) as ApiDataResponse<Order>;
    if (payload?.data) syncCartFromOrder(payload.data);
  }

  async function updateCartLineQty(
    detail: {
      itemId: string;
      orderItemId?: number;
      qty: number;
      orderItem?: OrderItem;
    },
    qty: number,
  ): Promise<void> {
    if (!user || orderId === null) return;

    const response = await fetch(buildApiUrl(`/api/orders/${orderId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        itemId: detail.itemId,
        orderItemId: detail.orderItemId,
        qty,
        sugarLevel: detail.orderItem?.sugarLevel,
        iceLevel: detail.orderItem?.iceLevel,
        note: detail.orderItem?.note,
        size: detail.orderItem?.size,
        eggQty: detail.orderItem?.eggQty,
        cheeseQty: detail.orderItem?.cheeseQty,
        addons: detail.orderItem?.addons,
      }),
    });

    if (!response.ok) {
      setActionError("更新數量失敗，請稍後再試。");
      return;
    }

    const payload = (await response.json()) as ApiDataResponse<Order>;
    if (payload?.data) syncCartFromOrder(payload.data);
  }

  async function clearCartConfirmed(): Promise<void> {
    if (!user || orderId === null || cartDetails.length === 0) {
      return;
    }

    setActionError("");
    setStaleCartItems([]);
    setIsClearingCart(true);

    try {
      const response = await fetch(buildApiUrl(`/api/orders/${orderId}/items`), {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Clear cart failed: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as ApiDataResponse<Order>;
      if (payload?.data) {
        syncCartFromOrder(payload.data);
      } else {
        resetCartState();
      }
    } catch (clearError) {
      setActionError("清空購物車失敗，請稍後再試。");
      console.error(clearError);
    } finally {
      setIsClearingCart(false);
    }
  }

  function clearCart(): void {
    if (!user || orderId === null || cartDetails.length === 0) return;
    setConfirmDialog({
      message: text.confirmClearCart,
      onConfirm: () => {
        void clearCartConfirmed();
      },
    });
  }

  function applyCouponCode(): boolean {
    const code = couponCode.trim();
    if (!code) {
      setCheckoutNotice(text.couponInvalid);
      return false;
    }

    const coupon =
      coupons.find(
        (item) => item.code === code && item.isActive !== false,
      ) ?? null;

    if (!coupon) {
      setAppliedCoupon(null);
      setCheckoutNotice(text.couponInvalid);
      return false;
    }

    if (hasUsedCoupon(coupon)) {
      setAppliedCoupon(null);
      setCheckoutNotice(text.couponAlreadyUsed);
      return false;
    }

    selectCoupon(coupon);
    return isCouponUsable(coupon);
  }

  function updateCouponCode(nextCode: string): void {
    setCouponCode(nextCode);
    setAppliedCoupon(null);
  }

  function saveCollectedCouponCodes(nextCodes: string[]): void {
    if (!user) return;
    const normalizedCodes = [...new Set(nextCodes)];
    setCollectedCouponCodes(normalizedCodes);
    window.localStorage.setItem(
      `breakfast-coupons:${user.id}`,
      JSON.stringify(normalizedCodes),
    );
  }

  function collectCoupon(coupon: Coupon): void {
    if (!user || collectedCouponCodes.includes(coupon.code)) return;
    saveCollectedCouponCodes([...collectedCouponCodes, coupon.code]);
    setCouponWalletNotice(`${text.couponCollected}：${coupon.name}`);
  }

  function collectCouponCode(): void {
    const code = couponCode.trim();
    if (!code) {
      setCouponWalletNotice(text.couponInvalid);
      return;
    }

    const coupon =
      coupons.find(
        (item) => item.code === code && item.isActive !== false,
      ) ?? null;

    if (!coupon || !isCouponCollectable(coupon)) {
      setCouponWalletNotice(
        coupon && hasUsedCoupon(coupon)
          ? text.couponAlreadyUsed
          : text.couponInvalid,
      );
      return;
    }

    if (collectedCouponCodes.includes(coupon.code)) {
      setCouponWalletNotice(`${text.couponCollected}：${coupon.name}`);
      return;
    }

    collectCoupon(coupon);
    setCouponCode("");
  }

  function selectCoupon(coupon: Coupon): void {
    setCouponCode(coupon.code);
    setAppliedCoupon(coupon);
    setCheckoutNotice(
      isCouponUsable(coupon)
        ? `${text.couponApplied}：${coupon.code}`
        : `${text.couponUnavailable}：${text.couponMinSpend} ${formatMoney(coupon.minSpend ?? 0)}`,
    );
  }

  function isCouponCollectable(coupon: Coupon): boolean {
    if (coupon.isActive === false || hasUsedCoupon(coupon)) return false;
    if (coupon.startsAt && new Date(coupon.startsAt).getTime() > Date.now()) {
      return false;
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
      return false;
    }
    return true;
  }

  function couponRuleText(coupon: Coupon): string {
    return [
      couponBenefitText(coupon),
      `${text.couponMinSpend} ${formatMoney(coupon.minSpend ?? 0)}`,
      text.couponLimitOnce,
      coupon.usageLimitTotal ? text.couponLimitedQuantity : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function couponBenefitText(coupon: Coupon): string {
    if (coupon.discountType === "amount") {
      return text.couponAmountBenefit.replace(
        "{amount}",
        formatMoney(coupon.discountValue),
      );
    }

    const ratio = Number.isInteger(coupon.discountValue / 10)
      ? String(coupon.discountValue / 10)
      : (coupon.discountValue / 10).toFixed(1);
    return text.couponPercentBenefit
      .replace("{ratio}", ratio)
      .replace("{percent}", String(coupon.discountValue));
  }

  function pickupNumberList(numbers: number[] | undefined): string {
    if (!numbers || numbers.length === 0) return "-";
    return numbers.map((number) => `#${number}`).join("、");
  }

  function isCouponUsable(coupon: Coupon): boolean {
    if (coupon.isActive === false) return false;
    if ((coupon.minSpend ?? 0) > cartTotal) return false;
    if (coupon.startsAt && new Date(coupon.startsAt).getTime() > Date.now()) {
      return false;
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
      return false;
    }

    const totalUsedCount = historyOrders.filter(
      (order) =>
        order.status !== "pending" &&
        order.couponCode === coupon.code,
    ).length;
    if ((coupon.usageLimitTotal ?? 0) > 0 && totalUsedCount >= coupon.usageLimitTotal) {
      return false;
    }

    return !hasUsedCoupon(coupon);
  }

  function hasUsedCoupon(coupon: Coupon): boolean {
    const usedCount = historyOrders.filter(
      (order) =>
        order.status !== "pending" &&
        order.couponCode === coupon.code,
    ).length;
    return usedCount >= (coupon.usageLimitPerUser ?? 1);
  }

  async function submitOrder(): Promise<void> {
    if (!user || orderId === null || cartDetails.length === 0) {
      return;
    }

    setActionError("");
    setStaleCartItems([]);
    const normalizedPhone = customerPhone.trim();
    if (!normalizedPhone) {
      setCheckoutNotice(text.phoneRequired);
      return;
    }
    if (!isTaiwanMobilePhone(normalizedPhone)) {
      setCheckoutNotice(text.phoneInvalid);
      return;
    }
    if (!window.confirm("確定要送出訂單嗎？送出後店家會開始製作。")) {
      return;
    }
    setIsSubmittingOrder(true);

    try {
      const response = await fetch(
        buildApiUrl(`/api/orders/${orderId}/submit`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            paymentMethod,
            note: orderNote.trim() || undefined,
            couponCode: couponCanApply ? appliedCoupon?.code : undefined,
            customerName: customerName.trim() || user.name,
            customerPhone: normalizedPhone,
            pickupTime: pickupTime.trim() || undefined,
          }),
        },
      );

      if (!response.ok) {
        const errorPayload = (await response
          .clone()
          .json()
          .catch(() => null)) as {
          message?: string;
          staleItems?: StaleCartItem[];
        } | null;

        if (response.status === 409 && errorPayload?.staleItems?.length) {
          setStaleCartItems(errorPayload.staleItems);
          setActionError(
            errorPayload.message ??
              "購物車中有品項已更新，請重新確認菜單後再送出。",
          );
          setIsCartOpen(true);
          setCartView("items");
          await loadMenu();
          return;
        }

        if (response.status === 400 && errorPayload?.message) {
          setCheckoutNotice(errorPayload.message);
          return;
        }

        throw new Error(`Submit order failed: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as ApiDataResponse<Order>;
      setLastSubmittedOrder(payload.data);
      resetCartState();
      setIsCartOpen(false);
      navigate("/");
      await loadOrderProgress();
      await loadOrderHistory();
    } catch (submitError) {
      setActionError("送出訂單失敗，請稍後再試。");
      console.error(submitError);
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error m-4">
        <span>{error}</span>
      </div>
    );
  }

  if (isAdminProductFormPage && adminAuthed) {
    const previewCopy = newMenuItem.translations["zh-TW"];
    const previewName = previewCopy.name.trim() || "商品名稱";
    const previewDescription =
      previewCopy.description.trim() || "商品介紹會顯示在這裡";

    return (
      <div className="min-h-screen bg-base-100">
        {adminMenuNotice ? (
          <div className="fixed left-1/2 top-6 z-[2147483647] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 pointer-events-none">
            <div className="alert alert-warning shadow-lg justify-center">
              <span>{adminMenuNotice}</span>
            </div>
          </div>
        ) : null}

        <header className="sticky top-0 z-30 border-b border-base-300 bg-base-100">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4">
            <h1 className="text-2xl font-bold">
              {editingAdminMenuLogicalId ? "編輯商品" : "新增商品"}
            </h1>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setAdminMenuNotice("");
                navigate("/admin/menu");
              }}
            >
              關閉
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-5 pb-28">
          <section className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-8 py-6">
              <div className="space-y-3">
                <label className="label p-0">
                  <span className="label-text">照片</span>
                </label>
                <input
                  className="file-input file-input-bordered w-full"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    loadMenuImageFile(event.currentTarget.files?.[0] ?? null);
                  }}
                />
                <input
                  className="input input-bordered w-full"
                  value={newMenuItem.imageUrl}
                  onChange={(event) => {
                    const imageUrl = event.currentTarget.value;
                    setNewMenuItem((current) => ({
                      ...current,
                      imageUrl,
                    }));
                  }}
                  placeholder="或貼圖片網址"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text mb-1">價格（NT）</span>
                  <input
                    className="input input-bordered"
                    inputMode="numeric"
                    value={newMenuItem.price}
                    onChange={(event) => {
                      const price = parseWholeNumber(event.currentTarget.value);
                      setNewMenuItem((current) => ({
                        ...current,
                        price,
                      }));
                    }}
                    placeholder="例如 50"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text mb-1">大份價格（選填）</span>
                  <input
                    className="input input-bordered"
                    inputMode="numeric"
                    value={newMenuItem.largePrice}
                    onChange={(event) => {
                      const largePrice = event.currentTarget.value.replace(/\D/g, "");
                      setNewMenuItem((current) => ({ ...current, largePrice }));
                    }}
                    placeholder="例如 70"
                  />
                </label>
              </div>
              <div>
                <span className="label-text mb-1 block">可選加料</span>
                <details className="dropdown w-full">
                  <summary className="btn btn-outline w-full justify-between">
                    {[newMenuItem.allowEgg ? "加蛋" : "", newMenuItem.allowCheese ? "加起司" : "", ...(addonSettings.items ?? [])
                      .filter((addon) => newMenuItem.addonKeys.includes(addon.key))
                      .map((addon) => addon.name)]
                      .filter(Boolean)
                      .join("、") || "請選擇加料"}
                    <span>⌄</span>
                  </summary>
                  <div className="dropdown-content z-40 mt-2 w-full space-y-3 rounded-lg border border-base-300 bg-base-100 p-4 shadow">
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="flex items-center gap-3">
                    <input
                      className="checkbox checkbox-primary"
                      type="checkbox"
                      checked={newMenuItem.allowEgg}
                      onChange={(event) => {
                        const allowEgg = event.currentTarget.checked;
                        setNewMenuItem((current) => ({ ...current, allowEgg }));
                      }}
                    />
                    <span className="font-semibold">允許加蛋</span>
                    </span>
                    <span className="text-sm opacity-70">
                      {formatMoney(addonSettings.eggPrice)}
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="flex items-center gap-3">
                    <input
                      className="checkbox checkbox-primary"
                      type="checkbox"
                      checked={newMenuItem.allowCheese}
                      onChange={(event) => {
                        const allowCheese = event.currentTarget.checked;
                        setNewMenuItem((current) => ({ ...current, allowCheese }));
                      }}
                    />
                    <span className="font-semibold">允許加起司</span>
                    </span>
                    <span className="text-sm opacity-70">
                      {formatMoney(addonSettings.cheesePrice)}
                    </span>
                  </label>
                  {(addonSettings.items ?? [])
                    .filter((addon) => addon.key !== "egg" && addon.key !== "cheese" && addon.isActive)
                    .map((addon) => (
                      <label
                        key={addon.key}
                        className="flex cursor-pointer items-center justify-between gap-3"
                      >
                        <span className="flex items-center gap-3">
                          <input
                            className="checkbox checkbox-primary"
                            type="checkbox"
                            checked={newMenuItem.addonKeys.includes(addon.key)}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setNewMenuItem((current) => ({
                                ...current,
                                addonKeys: checked
                                  ? [...current.addonKeys, addon.key]
                                  : current.addonKeys.filter((key) => key !== addon.key),
                              }));
                            }}
                          />
                          <span className="font-semibold">{addon.name}</span>
                        </span>
                        <span className="text-sm opacity-70">
                          {formatMoney(addon.price)}
                        </span>
                      </label>
                    ))}
                  </div>
                </details>
              </div>
              <div>
                <span className="label-text mb-1 block">分類</span>
                <details className="dropdown w-full">
                  <summary className="btn btn-outline w-full justify-between">
                    {newMenuItem.category}
                    <span>⌄</span>
                  </summary>
                  <ul className="menu dropdown-content z-40 mt-2 w-full rounded-lg bg-base-100 p-2 shadow border border-base-300">
                    {breakfastCategoryOptions.map((category) => (
                      <li key={category}>
                        <button
                          onClick={() =>
                            setNewMenuItem((current) => ({
                              ...current,
                              category,
                            }))
                          }
                        >
                          {category}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>

              <div className="divide-y divide-base-300 border-y border-base-300">
                {menuLanguageOptions.map((option) => (
                  <section key={option.value} className="py-6">
                    <h2 className="mb-3 text-xl font-bold">{option.label}</h2>
                    <div className="space-y-3">
                      <input
                        className="input input-bordered w-full"
                        value={newMenuItem.translations[option.value].name}
                        onChange={(event) => {
                          const name = event.currentTarget.value;
                          setNewMenuItem((current) => ({
                            ...current,
                            translations: {
                              ...current.translations,
                              [option.value]: {
                                ...current.translations[option.value],
                                name,
                              },
                            },
                          }));
                        }}
                        placeholder={`${option.label} 商品名稱`}
                      />
                      <textarea
                        className="textarea textarea-bordered w-full min-h-28"
                        value={newMenuItem.translations[option.value].description}
                        onChange={(event) => {
                          const description = event.currentTarget.value;
                          setNewMenuItem((current) => ({
                            ...current,
                            translations: {
                              ...current.translations,
                              [option.value]: {
                                ...current.translations[option.value],
                                description,
                              },
                            },
                          }));
                        }}
                        placeholder={`${option.label} 商品介紹`}
                      />
                    </div>
                  </section>
                ))}
              </div>
            </div>

            <aside className="lg:sticky lg:top-24 lg:h-fit py-6">
              <article className="overflow-hidden rounded-lg bg-base-200 shadow-xl">
                {newMenuItem.imageUrl ? (
                  <img
                    src={newMenuItem.imageUrl}
                    alt={previewName}
                    className="h-80 w-full object-cover bg-white"
                    onError={() => {
                      setAdminMenuNotice("圖片載入失敗，請重新選擇圖片或貼正確網址。");
                    }}
                  />
                ) : (
                  <div className="h-80 bg-base-300 flex items-center justify-center text-sm opacity-60">
                    選擇圖片後會顯示在這裡
                  </div>
                )}
                <div className="p-5 space-y-3">
                  <h2 className="text-2xl font-bold">{previewName}</h2>
                  <p className="text-sm opacity-70">{previewDescription}</p>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-2xl font-black text-success">
                      {formatMoney(newMenuItem.price)}
                    </span>
                    <button className="btn btn-primary btn-sm">加入購物車</button>
                  </div>
                </div>
              </article>
            </aside>
          </section>
        </main>

        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-base-300 bg-base-100 p-4">
          <div className="mx-auto max-w-6xl">
            <button
              className="btn btn-primary w-full"
              onClick={() => {
                void saveAdminMenuItem();
              }}
            >
              {editingAdminMenuLogicalId ? "更新商品" : "新增商品"}
            </button>
          </div>
        </footer>
      </div>
    );
  }

  if (isAdminPage) {
    return (
      <div className="min-h-screen bg-base-200">
        <div className="navbar bg-base-100 shadow-lg">
          <div className="flex-1">
            <a className="normal-case text-2xl font-bold px-2" href="/admin">
              博翔早餐店管理後台
            </a>
          </div>
          <div className="flex-none flex flex-wrap gap-2">
            <span className="badge badge-outline">台北時間 {nowText}</span>
            <a className="btn btn-sm btn-outline" href="/">
              前台
            </a>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                void loadAdminData();
              }}
              disabled={adminLoading}
            >
              {adminLoading ? "更新中..." : "重新整理"}
            </button>
            {adminAuthed ? (
              <button
                className="btn btn-sm btn-outline"
                onClick={() => {
                  void handleAdminLogout();
                }}
              >
                登出
              </button>
            ) : null}
          </div>
        </div>
        {adminError ? (
          <div className="fixed left-1/2 top-24 z-[2147483647] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 pointer-events-none">
            <div className="alert alert-warning shadow-lg justify-center">
              <span>{adminError}</span>
            </div>
          </div>
        ) : null}
        {adminPriceHistoryModal ? (
          <div
            className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-black/60 p-4"
            onClick={() => {
              setAdminPriceHistoryModal(null);
            }}
          >
            <section
              className="w-full max-w-md rounded-lg border border-base-300 bg-base-100 p-5 shadow-2xl"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold">價格異動紀錄</h2>
                  <p className="text-sm opacity-60">
                    {adminPriceHistoryModal.itemName}
                  </p>
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setAdminPriceHistoryModal(null);
                  }}
                >
                  關閉
                </button>
              </div>
              <div className="max-h-[60vh] space-y-3 overflow-y-auto">
                {adminPriceHistoryModal.histories.map((history) => (
                  <div
                    key={history.id}
                    className="flex items-center justify-between gap-4 border-b border-base-300 pb-3 last:border-0 last:pb-0"
                  >
                    <span className="text-sm">
                      {formatTaipeiDateTime(history.createdAt)}
                    </span>
                    <span className="font-semibold">
                      {formatMoney(history.price)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
          {!adminAuthed ? (
            <section className="max-w-md mx-auto card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title">後台登入</h2>
                <input
                  className="input input-bordered"
                  value={adminLogin.username}
                  onChange={(event) => {
                    const username = event.currentTarget.value;
                    setAdminLogin((current) => ({
                      ...current,
                      username,
                    }));
                  }}
                  placeholder="帳號"
                />
                <input
                  className="input input-bordered"
                  type="password"
                  value={adminLogin.password}
                  onChange={(event) => {
                    const password = event.currentTarget.value;
                    setAdminLogin((current) => ({
                      ...current,
                      password,
                    }));
                  }}
                  placeholder="密碼"
                />
                <p className="text-xs opacity-60">
                  預設帳號 admin，預設密碼 admin1234。
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    void handleAdminLogin();
                  }}
                >
                  登入後台
                </button>
              </div>
            </section>
          ) : null}

          {adminAuthed ? (
            <>
          {!isAdminDashboardPage ? (
            <section className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 pb-4">
              <h1 className="text-3xl font-bold">
                {isAdminOrdersPage
                  ? "訂單與營收"
                  : isAdminMenuPage
                    ? "菜單與加料"
                    : isAdminCouponsPage
                      ? "促銷與優惠券"
                      : "銷售統計"}
              </h1>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => navigate("/admin")}
              >
                返回後台
              </button>
            </section>
          ) : null}
          <section className={`${isAdminDashboardPage ? "" : "hidden "}grid grid-cols-1 md:grid-cols-4 gap-3`}>
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">今日單量</div>
                <div className="stat-value text-primary text-3xl md:text-4xl">
                  {todayAdminStats.submittedToday.length}
                </div>
              </div>
            </div>
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">今日營業額</div>
                <div className="stat-value text-secondary text-3xl md:text-4xl">
                  {formatMoney(todayAdminStats.revenue)}
                </div>
              </div>
            </div>
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">待完成</div>
                <div className="stat-value text-accent text-3xl md:text-4xl">
                  {todayAdminStats.pendingCount}
                </div>
              </div>
            </div>
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">已完成</div>
                <div className="stat-value text-success text-3xl md:text-4xl">
                  {todayAdminStats.completedCount}
                </div>
              </div>
            </div>
          </section>

          <section className={`${isAdminDashboardPage ? "" : "hidden "}grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4`}>
            {[
              {
                path: "/admin/orders",
                title: "訂單與營收",
                description: "歷史訂單、日期區間營收",
              },
              {
                path: "/admin/menu",
                title: "菜單與加料",
                description: "商品、圖片、售價與共用加料",
              },
              {
                path: "/admin/coupons",
                title: "促銷與優惠券",
                description: "優惠條件、數量與期限",
              },
              {
                path: "/admin/reports",
                title: "銷售統計",
                description: "熱門品項與下單時段",
              },
            ].map((module) => (
              <button
                key={module.path}
                className="rounded-lg border border-base-300 bg-base-100 p-4 text-left shadow transition hover:border-primary"
                onClick={() => navigate(module.path)}
              >
                <div className="font-bold">{module.title}</div>
                <div className="mt-1 text-sm opacity-60">{module.description}</div>
              </button>
            ))}
          </section>

          <section className={`${isAdminOrdersPage ? "" : "hidden "}rounded-lg bg-base-100 p-5 shadow`}>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">營收查詢</h2>
                <p className="text-sm opacity-60">
                  選擇日期區間查看單量、營業額與客單價。
                </p>
              </div>
              <div className="grid w-full grid-cols-1 gap-3 sm:w-auto sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text mb-1">開始日期</span>
                  <input
                    className="input input-bordered"
                    type="date"
                    value={adminRevenueStartDate}
                    onChange={(event) => {
                      setAdminRevenueStartDate(event.currentTarget.value);
                    }}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text mb-1">結束日期</span>
                  <input
                    className="input input-bordered"
                    type="date"
                    value={adminRevenueEndDate}
                    onChange={(event) => {
                      setAdminRevenueEndDate(event.currentTarget.value);
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-lg bg-base-200 p-4">
                <div className="text-sm opacity-60">區間單量</div>
                <div className="text-3xl font-bold text-primary">
                  {adminRevenueRangeStats.submittedOrders.length}
                </div>
              </div>
              <div className="rounded-lg bg-base-200 p-4">
                <div className="text-sm opacity-60">區間營業額</div>
                <div className="text-3xl font-bold text-secondary">
                  {formatMoney(adminRevenueRangeStats.revenue)}
                </div>
              </div>
              <div className="rounded-lg bg-base-200 p-4">
                <div className="text-sm opacity-60">售出品項數</div>
                <div className="text-3xl font-bold text-accent">
                  {adminRevenueRangeStats.itemQty}
                </div>
              </div>
              <div className="rounded-lg bg-base-200 p-4">
                <div className="text-sm opacity-60">平均客單價</div>
                <div className="text-3xl font-bold text-success">
                  {formatMoney(adminRevenueRangeStats.averageTicket)}
                </div>
              </div>
            </div>
          </section>
            </>
          ) : null}

          {adminAuthed ? (
            <>
          <section className={`${isAdminMenuPage ? "" : "hidden "}rounded-lg bg-base-100 p-5 shadow`}>
            <div className="mb-4">
              <h2 className="text-2xl font-bold">共用加料價格</h2>
              <p className="mt-1 text-sm opacity-60">
                修改一次後，所有允許該加料的商品會套用新價格；既有訂單保留原成交價。
              </p>
            </div>
            <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
              <label className="form-control">
                <span className="label-text mb-1">加蛋單價（NT）</span>
                <input
                  className="input input-bordered"
                  inputMode="numeric"
                  value={addonSettingsDraft.eggPrice}
                  onChange={(event) => {
                    const eggPrice = event.currentTarget.value.replace(/\D/g, "");
                    setAddonSettingsDraft((current) => ({ ...current, eggPrice }));
                  }}
                />
              </label>
              <label className="form-control">
                <span className="label-text mb-1">加起司單價（NT）</span>
                <input
                  className="input input-bordered"
                  inputMode="numeric"
                  value={addonSettingsDraft.cheesePrice}
                  onChange={(event) => {
                    const cheesePrice = event.currentTarget.value.replace(/\D/g, "");
                    setAddonSettingsDraft((current) => ({ ...current, cheesePrice }));
                  }}
                />
              </label>
              <button
                className="btn btn-primary"
                onClick={() => {
                  void saveAddonSettings();
                }}
              >
                更新加料價格
              </button>
            </div>
            <div className="mt-5 border-t border-base-300 pt-5">
              <h3 className="font-bold">其他加料</h3>
              <p className="mt-1 text-sm opacity-60">
                可以新增早餐店需要的其他加料，儲存後會保留獨立價格。
              </p>
              <div className="mt-3 space-y-2">
                {(addonSettingsDraft.items ?? [])
                  .filter((item) => item.key !== "egg" && item.key !== "cheese")
                  .map((item) => (
                    <div
                      key={item.key}
                      className="grid grid-cols-1 items-center gap-2 rounded-lg border border-base-300 p-3 sm:grid-cols-[1fr_160px_auto]"
                    >
                      <input
                        className="input input-bordered"
                        value={item.name}
                        onChange={(event) => {
                          const name = event.currentTarget.value;
                          setAddonSettingsDraft((current) => ({
                            ...current,
                            items: (current.items ?? []).map((candidate) =>
                              candidate.key === item.key
                                ? { ...candidate, name }
                                : candidate,
                            ),
                          }));
                        }}
                      />
                      <input
                        className="input input-bordered"
                        inputMode="numeric"
                        value={item.price}
                        onChange={(event) => {
                          const price = parseWholeNumber(event.currentTarget.value);
                          setAddonSettingsDraft((current) => ({
                            ...current,
                            items: (current.items ?? []).map((candidate) =>
                              candidate.key === item.key
                                ? { ...candidate, price }
                                : candidate,
                            ),
                          }));
                        }}
                      />
                      <button
                        className="btn btn-error btn-outline"
                        onClick={() => {
                          setAddonSettingsDraft((current) => ({
                            ...current,
                            items: (current.items ?? []).filter(
                              (candidate) => candidate.key !== item.key,
                            ),
                          }));
                        }}
                      >
                        刪除
                      </button>
                    </div>
                  ))}
              </div>
              <div className="mt-3 grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_160px_auto]">
                <label className="form-control">
                  <span className="label-text mb-1">新增加料名稱</span>
                  <input
                    className="input input-bordered"
                    value={newAddonDraft.name}
                    onChange={(event) => {
                      const name = event.currentTarget.value;
                      setNewAddonDraft((current) => ({
                        ...current,
                        name,
                      }));
                    }}
                    placeholder="例如 培根"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text mb-1">單價（NT）</span>
                  <input
                    className="input input-bordered"
                    inputMode="numeric"
                    value={newAddonDraft.price}
                    onChange={(event) => {
                      const price = event.currentTarget.value.replace(/\D/g, "");
                      setNewAddonDraft((current) => ({
                        ...current,
                        price,
                      }));
                    }}
                    placeholder="例如 15"
                  />
                </label>
                <button className="btn btn-outline" onClick={addAddonDraft}>
                  新增加料
                </button>
              </div>
            </div>
          </section>

          <section className={isAdminMenuPage ? "" : "hidden"}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold">菜單商品</h2>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setAdminMenuNotice("");
                  resetNewMenuItemForm();
                  navigate("/admin/add-product");
                }}
              >
                新增商品
              </button>
            </div>
          </section>

          {isAdminMenuFormOpen ? (
            <>
              <section className="fixed inset-0 z-[9999] h-[100dvh] w-screen overflow-hidden bg-base-100 flex flex-col isolate">
                <div className="px-6 py-4 border-b border-base-300 flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">新增商品</h2>
                    <p className="text-sm opacity-60">
                      填寫商品資料後，右側會即時顯示前台效果。
                    </p>
                  </div>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setAdminMenuNotice("");
                      setIsAdminMenuFormOpen(false);
                      navigate("/admin/menu");
                    }}
                  >
                    關閉
                  </button>
                </div>
                {adminMenuNotice ? (
                  <div className="fixed left-1/2 top-20 z-[120] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 pointer-events-none">
                    <div className="alert alert-warning shadow-lg justify-center">
                      <span>{adminMenuNotice}</span>
                    </div>
                  </div>
                ) : null}
                <div className="p-6 flex-1 overflow-auto">
                  <div className="space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-3">
                    <label className="form-control">
                      <span className="label-text mb-1">價格（NT）</span>
                      <input
                        className="input input-bordered"
                        inputMode="numeric"
                        value={newMenuItem.price}
                        onChange={(event) => {
                          const price = parseWholeNumber(event.currentTarget.value);
                          setNewMenuItem((current) => ({
                            ...current,
                            price,
                          }));
                        }}
                        placeholder="例如 50"
                      />
                    </label>
                    <div>
                      <span className="label-text mb-1 block">分類</span>
                      <details className="dropdown w-full">
                        <summary className="btn btn-outline w-full justify-between">
                          {newMenuItem.category}
                          <span>⌄</span>
                        </summary>
                        <ul className="menu dropdown-content z-[60] mt-2 w-full rounded-lg bg-base-100 p-2 shadow border border-base-300">
                          {breakfastCategoryOptions.map((category) => (
                            <li key={category}>
                              <button
                                onClick={() =>
                                  setNewMenuItem((current) => ({
                                    ...current,
                                    category,
                                  }))
                                }
                              >
                                {category}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                    <div className="space-y-2 lg:col-span-2">
                      <span className="label-text block">照片</span>
                      <input
                        className="file-input file-input-bordered w-full"
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          loadMenuImageFile(event.currentTarget.files?.[0] ?? null);
                        }}
                      />
                      <input
                        className="input input-bordered w-full"
                        value={newMenuItem.imageUrl}
                        onChange={(event) => {
                          const imageUrl = event.currentTarget.value;
                          setNewMenuItem((current) => ({
                            ...current,
                            imageUrl,
                          }));
                        }}
                        placeholder="或貼圖片網址"
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border border-base-300 bg-base-200 p-4">
                    <div className="mb-3 font-semibold">前台預覽</div>
                    <article className="max-w-xl overflow-hidden rounded-lg bg-base-100 shadow">
                      {newMenuItem.imageUrl ? (
                        <img
                          src={newMenuItem.imageUrl}
                          alt="前台商品預覽"
                          className="h-80 w-full object-cover bg-white"
                        />
                      ) : (
                        <div className="h-80 bg-base-300 flex items-center justify-center text-sm opacity-60">
                          選擇圖片後會顯示在這裡
                        </div>
                      )}
                      <div className="p-4 space-y-2">
                        <h3 className="text-xl font-bold">
                          {newMenuItem.translations["zh-TW"].name || "商品名稱"}
                        </h3>
                        <p className="text-sm opacity-70 line-clamp-2">
                          {newMenuItem.translations["zh-TW"].description ||
                            "商品介紹會顯示在這裡"}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-2xl font-bold text-success">
                            {formatMoney(newMenuItem.price)}
                          </span>
                          <button className="btn btn-primary btn-sm">
                            加入購物車
                          </button>
                        </div>
                      </div>
                    </article>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {menuLanguageOptions.map((option) => (
                      <div
                        key={option.value}
                        className="rounded-lg border border-base-300 p-3 space-y-2"
                      >
                        <div className="font-semibold">{option.label}</div>
                        <input
                          className="input input-bordered w-full"
                          value={newMenuItem.translations[option.value].name}
                          onChange={(event) => {
                            const name = event.currentTarget.value;
                            setNewMenuItem((current) => ({
                              ...current,
                              translations: {
                                ...current.translations,
                                [option.value]: {
                                  ...current.translations[option.value],
                                  name,
                                },
                              },
                            }));
                          }}
                          placeholder={`${option.label} 商品名稱`}
                        />
                        <textarea
                          className="textarea textarea-bordered w-full min-h-28"
                          value={
                            newMenuItem.translations[option.value].description
                          }
                          onChange={(event) => {
                            const description = event.currentTarget.value;
                            setNewMenuItem((current) => ({
                              ...current,
                              translations: {
                                ...current.translations,
                                [option.value]: {
                                  ...current.translations[option.value],
                                  description,
                                },
                              },
                            }));
                          }}
                          placeholder={`${option.label} 商品介紹`}
                        />
                      </div>
                    ))}
                  </div>
                  </div>
                </div>
                <div className="p-4 border-t border-base-300 bg-base-100">
                  <button
                    className="btn btn-primary w-full"
                    onClick={() => {
                      void saveAdminMenuItem();
                    }}
                  >
                    新增商品
                  </button>
                </div>
              </section>
            </>
          ) : null}

          <section className={isAdminDashboardPage ? "" : "hidden"}>
            <h2 className="text-2xl font-bold mb-3">POS 訂單看板</h2>
            <div className="overflow-x-auto bg-base-100 rounded-lg shadow">
              <table className="table table-zebra min-w-[1120px]">
                <thead>
                  <tr>
                    <th>單號</th>
                    <th>狀態</th>
                    <th>付款</th>
                    <th>品項</th>
                    <th>備註</th>
                    <th>金額</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {adminOrders
                    .filter(
                      (order) =>
                        order.status === "submitted" ||
                        order.status === "completed",
                    )
                    .slice(0, 20)
                    .map((order) => {
                      const waitMinutes = orderWaitMinutes(order);
                      return (
                      <tr
                        key={order.id}
                        className={orderWaitClass(waitMinutes)}
                      >
                        <td className="font-bold">
                          #{order.dailySequence ?? order.id}
                        </td>
                        <td className="w-28">
                          <span
                            className={`badge min-w-[4rem] whitespace-nowrap justify-center ${orderStatusBadgeClass(order.status)}`}
                          >
                            {orderStatusLabel(order.status)}
                          </span>
                          <div className="mt-1 text-xs opacity-70">
                            {order.status === "completed"
                              ? "待顧客取貨"
                              : `等待 ${waitMinutes} 分鐘`}
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          {order.paymentMethod === "card" ? "刷卡" : "現金"}
                        </td>
                        <td>
                          <ul className="space-y-1 text-sm">
                            {order.items.map((item, index) => {
                              const checkboxId = `${order.id}-${item.id ?? item.menuItemId}-${index}`;
                              return (
                                <li
                                  key={checkboxId}
                                  className="flex items-start gap-2"
                                >
                                  <input
                                    className="checkbox checkbox-xs mt-1"
                                    type="checkbox"
                                    checked={Boolean(checkedPosItems[checkboxId])}
                                    onChange={(event) => {
                                      const checked = event.currentTarget.checked;
                                      setCheckedPosItems((current) => ({
                                        ...current,
                                        [checkboxId]: checked,
                                      }));
                                    }}
                                  />
                                  <span
                                    className={
                                      checkedPosItems[checkboxId]
                                        ? "line-through opacity-50"
                                        : ""
                                    }
                                  >
                                    {item.menuItemName} x {item.qty}
                                    {orderItemIsDrink(item) ? (
                                      <span className="opacity-60">
                                        {" "}
                                        ({item.sugarLevel ? sugarLabel(item.sugarLevel) : "正常糖"} /{" "}
                                        {item.iceLevel ? iceLabel(item.iceLevel) : "正常冰"})
                                      </span>
                                    ) : null}
                                    {orderItemSpecification(item) ? (
                                      <span className="opacity-60">
                                        {" "}
                                        ({orderItemSpecification(item)})
                                      </span>
                                    ) : null}
                                    {item.note ? (
                                      <span className="opacity-60">
                                        {" "}
                                        - {item.note}
                                      </span>
                                    ) : null}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                        <td className="text-sm">
                          <div>{order.note || "-"}</div>
                          <div className="opacity-70">
                            訂購人：{order.customerName || "-"}
                          </div>
                          <div className="opacity-70">
                            電話：{order.customerPhone || "-"}
                          </div>
                          <div className="opacity-70">
                            取餐：{order.pickupTime || "-"}
                          </div>
                          <div className="opacity-60">
                            下單：{formatTaipeiDateTime(order.submittedAt)}
                          </div>
                          {order.completedAt ? (
                            <div className="opacity-60">
                              完成：{formatTaipeiDateTime(order.completedAt)}
                            </div>
                          ) : null}
                        </td>
                        <td className="font-semibold">
                          {formatMoney(order.total)}
                        </td>
                        <td>
                          {order.status === "submitted" ? (
                            pendingAdminOrderAction?.orderId === order.id &&
                            pendingAdminOrderAction.action === "complete" ? (
                              <div className="flex flex-wrap gap-1">
                                <button
                                  className="btn btn-xs btn-success whitespace-nowrap"
                                  disabled={adminOrderActionId !== null}
                                  onClick={() => {
                                    void completeAdminOrder(order.id);
                                  }}
                                >
                                  確定完成
                                </button>
                                <button
                                  className="btn btn-xs btn-ghost whitespace-nowrap"
                                  disabled={adminOrderActionId !== null}
                                  onClick={() => setPendingAdminOrderAction(null)}
                                >
                                  取消
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn btn-xs btn-success min-w-12 whitespace-nowrap"
                                disabled={adminOrderActionId !== null}
                                onClick={() => {
                                  requestAdminOrderConfirmation(order, "complete");
                                }}
                              >
                                {adminOrderActionId === order.id
                                  ? "處理中..."
                                  : "完成"}
                              </button>
                            )
                          ) : order.status === "completed" ? (
                            pendingAdminOrderAction?.orderId === order.id &&
                            pendingAdminOrderAction.action === "pick-up" ? (
                              <div className="flex flex-wrap gap-1">
                                <button
                                  className="btn btn-xs btn-primary whitespace-nowrap"
                                  disabled={adminOrderActionId !== null}
                                  onClick={() => {
                                    void pickUpAdminOrder(order.id);
                                  }}
                                >
                                  確定取貨
                                </button>
                                <button
                                  className="btn btn-xs btn-ghost whitespace-nowrap"
                                  disabled={adminOrderActionId !== null}
                                  onClick={() => setPendingAdminOrderAction(null)}
                                >
                                  取消
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn btn-xs btn-primary min-w-16 whitespace-nowrap"
                                disabled={adminOrderActionId !== null}
                                onClick={() => {
                                  requestAdminOrderConfirmation(order, "pick-up");
                                }}
                              >
                                {adminOrderActionId === order.id
                                  ? "處理中..."
                                  : "已取貨"}
                              </button>
                            )
                          ) : (
                            <span className="text-xs opacity-50">已歸檔</span>
                          )}
                        </td>
                      </tr>
                    );
                    })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={isAdminOrdersPage ? "" : "hidden"}>
            <details className="collapse collapse-arrow bg-base-100 shadow h-fit">
              <summary className="collapse-title text-2xl font-bold">
                單日歷史訂單
              </summary>
              <div className="collapse-content space-y-4">
                <label className="form-control w-full max-w-xs">
                  <span className="label-text mb-1">查詢日期</span>
                  <input
                    className="input input-bordered"
                    type="date"
                    value={adminHistoryDate}
                    onChange={(event) => {
                      setAdminHistoryDate(event.currentTarget.value);
                    }}
                  />
                </label>
                <div className="overflow-x-auto rounded-lg border border-base-300">
              <table className="table table-zebra min-w-[1080px]">
                <thead>
                  <tr>
                    <th>單號</th>
                    <th>狀態</th>
                    <th>訂購人</th>
                    <th>品項</th>
                    <th>優惠券</th>
                    <th>付款</th>
                    <th>時間</th>
                    <th>金額</th>
                  </tr>
                </thead>
                <tbody>
                  {adminHistoryOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="opacity-60">
                        這天目前沒有歷史訂單。
                      </td>
                    </tr>
                  ) : (
                    adminHistoryOrders.map((order) => (
                      <tr key={`history-${order.id}`}>
                        <td className="font-bold">
                          #{order.dailySequence ?? order.id}
                        </td>
                        <td>
                          <span
                            className={`badge min-w-[4rem] whitespace-nowrap justify-center ${orderStatusBadgeClass(order.status)}`}
                          >
                            {orderStatusLabel(order.status)}
                          </span>
                        </td>
                        <td className="text-sm">
                          <div>{order.customerName || "-"}</div>
                          <div className="opacity-70">{order.customerPhone || "-"}</div>
                        </td>
                        <td>
                          <ul className="space-y-1 text-sm">
                            {order.items.map((item) => (
                              <li key={`history-${order.id}-${item.id ?? item.menuItemId}`}>
                                {item.menuItemName} x {item.qty}
                                {orderItemIsDrink(item) ? (
                                  <span className="opacity-60">
                                    {" "}
                                    ({item.sugarLevel ? sugarLabel(item.sugarLevel) : "正常糖"} /{" "}
                                    {item.iceLevel ? iceLabel(item.iceLevel) : "正常冰"})
                                  </span>
                                ) : null}
                                {orderItemSpecification(item) ? (
                                  <span className="opacity-60">
                                    {" "}
                                    ({orderItemSpecification(item)})
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td>
                          {order.couponCode ? (
                            <div className="text-sm">
                              <span className="badge badge-accent badge-sm">
                                {order.couponCode}
                              </span>
                              <div className="opacity-70">
                                折抵 {formatMoney(order.discountTotal ?? 0)}
                              </div>
                            </div>
                          ) : (
                            <span className="opacity-50">無</span>
                          )}
                        </td>
                        <td>{order.paymentMethod === "card" ? "刷卡" : "現金"}</td>
                        <td className="text-sm">
                          <div>下單：{formatTaipeiDateTime(order.submittedAt)}</div>
                          {order.completedAt ? (
                            <div className="opacity-70">
                              完成：{formatTaipeiDateTime(order.completedAt)}
                            </div>
                          ) : null}
                          {order.pickedUpAt ? (
                            <div className="opacity-70">
                              取貨：{formatTaipeiDateTime(order.pickedUpAt)}
                            </div>
                          ) : null}
                        </td>
                        <td className="font-semibold">{formatMoney(order.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
                </div>
              </div>
            </details>
          </section>

          <section className={isAdminReportsPage ? "" : "hidden"}>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-2xl font-bold">銷售統計</h2>
              <label className="form-control w-full max-w-xs">
                <span className="label-text mb-1">查詢日期</span>
                <input
                  className="input input-bordered"
                  type="date"
                  value={adminStatsDate}
                  onChange={(event) => {
                    setAdminStatsDate(event.currentTarget.value);
                  }}
                />
              </label>
            </div>
            <h3 className="mb-3 text-2xl font-bold">每日品項銷售排行</h3>
            <div className="bg-base-100 rounded-lg shadow p-4">
              {selectedAdminStats.itemRanking.length === 0 ? (
                <p className="opacity-60">這天目前沒有銷售資料。</p>
              ) : (
                <ol className="space-y-2">
                  {selectedAdminStats.itemRanking.slice(0, 4).map((item, index) => (
                    <li
                      key={item.name}
                      className="flex items-center justify-between border-b border-base-300 pb-2"
                    >
                      <span>
                        {index + 1}. {item.name}
                      </span>
                      <span className="badge badge-primary">{item.qty} 份</span>
                    </li>
                  ))}
                </ol>
              )}
              {selectedAdminStats.itemRanking.length > 4 ? (
                <details className="collapse collapse-arrow mt-3 bg-base-200">
                  <summary className="collapse-title font-bold">
                    查看全部品項
                  </summary>
                  <ol className="collapse-content space-y-2">
                    {selectedAdminStats.itemRanking.slice(4).map((item, index) => (
                      <li
                        key={`extra-${item.name}`}
                        className="flex items-center justify-between border-b border-base-300 pb-2"
                      >
                        <span>
                          {index + 5}. {item.name}
                        </span>
                        <span className="badge badge-primary">{item.qty} 份</span>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </div>
          </section>

          <section className={isAdminReportsPage ? "" : "hidden"}>
            <h2 className="mb-3 text-2xl font-bold">下單時段統計</h2>
            <div className="bg-base-100 rounded-lg shadow p-4">
                {selectedAdminStats.hourlyRanking.length === 0 ? (
                  <p className="opacity-60">這天目前沒有時段資料。</p>
                ) : (
                  <div className="space-y-2">
                    {selectedAdminStats.hourlyRanking.map((row) => (
                      <div
                        key={row.hour}
                        className="flex items-center justify-between"
                      >
                        <span>{String(row.hour).padStart(2, "0")}:00</span>
                        <progress
                          className="progress progress-primary mx-3 flex-1"
                          value={row.count}
                          max={Math.max(
                            ...selectedAdminStats.hourlyRanking.map(
                              (item) => item.count,
                            ),
                          )}
                        />
                        <span className="w-12 text-right">{row.count} 單</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </section>

          <section className={isAdminMenuPage ? "" : "hidden"}>
            <details className="collapse collapse-arrow bg-base-100 shadow h-fit">
              <summary className="collapse-title text-2xl font-bold">
                菜單商品管理
              </summary>
              <div className="collapse-content">
                <div className="overflow-x-auto rounded-lg border border-base-300">
                  <table className="table min-w-[1080px]">
                    <thead>
                      <tr className="bg-base-200/80">
                        <th className="px-5">品項</th>
                        <th className="px-5">分類</th>
                        <th className="px-5">上架／更新</th>
                        <th className="px-5">目前價格</th>
                        <th className="text-center">改價紀錄</th>
                        <th className="px-5 text-right">操作</th>
                      </tr>
                    </thead>
                    {Array.from(
                      new Set(items.map((item) => item.category)),
                    ).map((category) => (
                    <tbody key={category}>
                      <tr className="bg-base-300">
                        <td colSpan={6} className="px-5 py-3 text-base font-bold">
                          {category}
                        </td>
                      </tr>
                      {items.filter((item) => item.category === category).map((item) => {
                        const histories =
                          versionHistoryByLogicalId[item.logicalId] ?? [];
                        return (
                          <tr
                            key={item.id}
                            className="border-b border-base-300/70 bg-base-100/40 hover:bg-base-200/60"
                          >
                            <td className="px-5 py-4">
                              <div className="font-semibold">{item.name}</div>
                              <div className="text-xs opacity-60">
                                商品代碼：{item.logicalId}
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <span className="badge badge-outline">
                                {item.category}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-sm">
                              <div>
                                {histories[0]?.createdAt
                                  ? formatTaipeiDateTime(histories[0].createdAt)
                                  : "按查看紀錄載入"}
                              </div>
                              {item.isRecentlyUpdated ? (
                                <span className="badge badge-accent badge-sm">
                                  新品展示中
                                </span>
                              ) : null}
                            </td>
                            <td className="px-5 py-4">
                              <span className="font-semibold">
                                {formatMoney(item.price)}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-center">
                              <button
                                className="btn btn-xs btn-outline"
                                disabled={loadingHistoryId === item.logicalId}
                                onClick={() => {
                                  void loadVersionHistory(item.logicalId).then(
                                    (loadedHistories) => {
                                      const priceHistories =
                                        loadedHistories.filter(
                                          (history, index) =>
                                            index === loadedHistories.length - 1 ||
                                            history.price !==
                                              loadedHistories[index + 1]?.price,
                                        );
                                  setAdminPriceHistoryModal({
                                    itemName: item.name,
                                    histories: priceHistories,
                                  });
                                    },
                                  );
                                }}
                              >
                                {loadingHistoryId === item.logicalId
                                  ? "載入中..."
                                  : "查看紀錄"}
                              </button>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex justify-end gap-2">
                                <button
                                  className="btn btn-xs btn-outline"
                                  onClick={() => {
                                    openEditAdminMenuItem(item);
                                  }}
                                >
                                  編輯
                                </button>
                                <button
                                  className="btn btn-xs btn-outline"
                                  onClick={() => {
                                    void updateAdminMenuPrice(item);
                                  }}
                                >
                                  調價
                                </button>
                                <button
                                  className="btn btn-xs btn-error btn-outline"
                                  onClick={() => {
                                    void deleteAdminMenuItem(item);
                                  }}
                                >
                                  刪除
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    ))}
                  </table>
                </div>
              </div>
            </details>
          </section>

          <section className={isAdminCouponsPage ? "" : "hidden"}>
            <h2 className="text-2xl font-bold mb-3">目前促銷</h2>
            <div className="mb-4 rounded-lg bg-base-100 p-4 shadow">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <label className="form-control">
                  <span className="label-text mb-1">活動名稱</span>
                  <input
                    className="input input-bordered"
                    value={newPromotion.name}
                    onChange={(event) => {
                      const name = event.currentTarget.value;
                      setNewPromotion((current) => ({
                        ...current,
                        name,
                      }));
                    }}
                    placeholder="例如 飯糰新品折 10 元"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text mb-1">適用商品</span>
                  <details className="dropdown w-full">
                    <summary className="btn btn-outline w-full justify-between">
                      {newPromotion.menuItemLogicalIds.length === 0
                        ? "請選擇商品"
                        : newPromotion.menuItemLogicalIds.length === 1
                          ? items.find(
                              (item) =>
                                item.logicalId ===
                                newPromotion.menuItemLogicalIds[0],
                            )?.name
                          : `已選擇 ${newPromotion.menuItemLogicalIds.length} 個商品`}
                      <span>⌄</span>
                    </summary>
                    <ul className="menu dropdown-content z-40 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-2 shadow">
                      {items.map((item) => (
                        <li key={item.logicalId}>
                          <button
                            onClick={() => {
                              setNewPromotion((current) => ({
                                ...current,
                                menuItemLogicalIds:
                                  current.menuItemLogicalIds.includes(
                                    item.logicalId,
                                  )
                                    ? current.menuItemLogicalIds.filter(
                                        (logicalId) =>
                                          logicalId !== item.logicalId,
                                      )
                                    : [
                                        ...current.menuItemLogicalIds,
                                        item.logicalId,
                                      ],
                              }));
                            }}
                          >
                            <input
                              className="checkbox checkbox-sm"
                              type="checkbox"
                              checked={newPromotion.menuItemLogicalIds.includes(
                                item.logicalId,
                              )}
                              readOnly
                            />
                            {item.name}（{item.logicalId}）
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                </label>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_1fr_1fr]">
                <div className="join">
                  <button
                    className={`btn join-item flex-1 ${newPromotion.discountType === "amount" ? "btn-primary" : "btn-outline"}`}
                    onClick={() =>
                      setNewPromotion((current) => ({
                        ...current,
                        discountType: "amount",
                      }))
                    }
                  >
                    金額 NT
                  </button>
                  <button
                    className={`btn join-item flex-1 ${newPromotion.discountType === "percent" ? "btn-primary" : "btn-outline"}`}
                    onClick={() =>
                      setNewPromotion((current) => ({
                        ...current,
                        discountType: "percent",
                      }))
                    }
                  >
                    百分比 %
                  </button>
                </div>
                <input
                  className="input input-bordered"
                  inputMode="numeric"
                  value={newPromotion.discountValue}
                  onChange={(event) => {
                    const discountValue = onlyDigits(event.currentTarget.value);
                    setNewPromotion((current) => ({
                      ...current,
                      discountValue,
                    }));
                  }}
                  placeholder={newPromotion.discountType === "amount" ? "折抵金額" : "實付比例"}
                />
                <input
                  className="input input-bordered"
                  type="date"
                  value={newPromotion.startsDate}
                  onChange={(event) => {
                    const startsDate = event.currentTarget.value;
                    setNewPromotion((current) => ({
                      ...current,
                      startsDate,
                    }));
                  }}
                />
                <input
                  className="input input-bordered"
                  type="date"
                  value={newPromotion.endsDate}
                  onChange={(event) => {
                    const endsDate = event.currentTarget.value;
                    setNewPromotion((current) => ({
                      ...current,
                      endsDate,
                    }));
                  }}
                />
              </div>
              <button
                className="btn btn-primary mt-3 w-full"
                onClick={() => void createAdminPromotion()}
              >
                新增促銷
              </button>
            </div>
            <div className="space-y-3">
              {activePromotions.length === 0 ? (
                <div className="alert bg-base-100">
                  <span>目前沒有啟用中的促銷。</span>
                </div>
              ) : (
                activePromotions.map((promotion) => (
                  <article
                    key={promotion.id}
                    className="card bg-base-100 shadow"
                  >
                    <div className="card-body p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-bold">{promotion.name}</h3>
                        <span className="badge badge-accent">
                          {promotion.discountType === "percent"
                            ? `${promotion.discountValue}%`
                            : formatMoney(promotion.discountValue)}
                        </span>
                      </div>
                      <p className="text-sm opacity-70">
                        適用品項：{promotion.menuItemLogicalId}
                      </p>
                      <p className="text-xs opacity-60">
                        {formatTaipeiDateTime(promotion.startsAt)} -{" "}
                        {formatTaipeiDateTime(promotion.endsAt)}
                      </p>
                      <button
                        className="btn btn-xs btn-error btn-outline mt-2"
                        onClick={() => void deleteAdminPromotion(promotion.id)}
                      >
                        刪除
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className={isAdminCouponsPage ? "" : "hidden"}>
            <h2 className="text-2xl font-bold mb-3">優惠券管理</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card bg-base-100 shadow">
                <div className="card-body space-y-4">
                  <div>
                    <h3 className="text-lg font-bold">
                      {editingCouponCode ? "編輯優惠券" : "新增優惠券"}
                    </h3>
                    {editingCouponCode ? (
                      <p className="text-sm opacity-60">
                        正在編輯 {editingCouponCode}，優惠碼本身不可更改。
                      </p>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="label-text mb-1">優惠碼</span>
                      <input
                        className="input input-bordered"
                        value={newCoupon.code}
                        disabled={Boolean(editingCouponCode)}
                        onChange={(event) => {
                          const code = event.currentTarget.value;
                          setNewCoupon((current) => ({
                            ...current,
                            code,
                          }));
                        }}
                        placeholder="例如 BREAKFAST10"
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text mb-1">優惠券名稱</span>
                      <input
                        className="input input-bordered"
                        value={newCoupon.name}
                        onChange={(event) => {
                          const name = event.currentTarget.value;
                          setNewCoupon((current) => ({
                            ...current,
                            name,
                          }));
                        }}
                        placeholder="例如 早餐折 10 元"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
                    <div>
                      <span className="label-text mb-1 block">優惠類型</span>
                      <div className="join w-full">
                      <button
                        className={`btn join-item flex-1 ${
                          newCoupon.discountType === "amount"
                            ? "btn-primary"
                            : "btn-outline"
                        }`}
                        onClick={() =>
                          setNewCoupon((current) => ({
                            ...current,
                            discountType: "amount",
                          }))
                        }
                      >
                        金額 NT
                      </button>
                      <button
                        className={`btn join-item flex-1 ${
                          newCoupon.discountType === "percent"
                            ? "btn-primary"
                            : "btn-outline"
                        }`}
                        onClick={() =>
                        setNewCoupon((current) => ({
                          ...current,
                          discountType: "percent",
                        }))
                      }
                      >
                        百分比 %
                      </button>
                      </div>
                    </div>
                    <label className="form-control">
                      <span className="label-text mb-1">
                        {newCoupon.discountType === "amount"
                          ? "折抵金額（NT）"
                          : "實付比例（%）"}
                      </span>
                      <input
                        className="input input-bordered"
                        inputMode="numeric"
                        value={newCoupon.discountValue}
                        onChange={(event) => {
                          const discountValue = onlyDigits(
                            event.currentTarget.value,
                          );
                          setNewCoupon((current) => ({
                            ...current,
                            discountValue,
                          }));
                        }}
                        placeholder={
                          newCoupon.discountType === "amount" ? "10" : "80"
                        }
                      />
                    </label>
                  </div>

                  <div className="rounded-lg bg-base-200 p-3 text-sm opacity-80">
                    金額 NT 是直接折抵；百分比是「實付比例」，例如 80% 代表打八折。
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="label-text mb-1">最低消費（NT）</span>
                      <input
                        className="input input-bordered"
                        inputMode="numeric"
                        value={newCoupon.minSpend}
                        onChange={(event) => {
                          const minSpend = onlyDigits(event.currentTarget.value);
                          setNewCoupon((current) => ({
                            ...current,
                            minSpend,
                          }));
                        }}
                        placeholder="0 代表無門檻"
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text mb-1">最多折抵（NT）</span>
                      <input
                        className="input input-bordered"
                        inputMode="numeric"
                        value={newCoupon.maxDiscount}
                        onChange={(event) => {
                          const maxDiscount = onlyDigits(
                            event.currentTarget.value,
                          );
                          setNewCoupon((current) => ({
                            ...current,
                            maxDiscount,
                          }));
                        }}
                        placeholder="0 代表不限"
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text mb-1">每個帳號可用次數</span>
                      <input
                        className="input input-bordered"
                        inputMode="numeric"
                        value={newCoupon.usageLimitPerUser}
                        onChange={(event) => {
                          const usageLimitPerUser = onlyDigits(
                            event.currentTarget.value,
                          );
                          setNewCoupon((current) => ({
                            ...current,
                            usageLimitPerUser,
                          }));
                        }}
                        placeholder="例如 1"
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text mb-1">總發放張數</span>
                      <input
                        className="input input-bordered"
                        inputMode="numeric"
                        value={newCoupon.usageLimitTotal}
                        onChange={(event) => {
                          const usageLimitTotal = onlyDigits(
                            event.currentTarget.value,
                          );
                          setNewCoupon((current) => ({
                            ...current,
                            usageLimitTotal,
                          }));
                        }}
                        placeholder="0 代表不限量"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="label-text mb-1">開始日期</span>
                      <input
                        className="input input-bordered"
                        type="date"
                        value={newCoupon.startsDate}
                        onChange={(event) => {
                          const startsDate = event.currentTarget.value;
                          setNewCoupon((current) => ({
                            ...current,
                            startsDate,
                          }));
                        }}
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text mb-1">結束日期</span>
                      <input
                        className="input input-bordered"
                        type="date"
                        value={newCoupon.endsDate}
                        onChange={(event) => {
                          const endsDate = event.currentTarget.value;
                          setNewCoupon((current) => ({
                            ...current,
                            endsDate,
                          }));
                        }}
                      />
                    </label>
                  </div>
                  <p className="text-xs opacity-60">
                    使用期間：
                    {newCoupon.startsDate
                      ? `${newCoupon.startsDate} 00:00:00`
                      : "請選開始日"}{" "}
                    -{" "}
                    {newCoupon.endsDate
                      ? `${newCoupon.endsDate} 23:59:59`
                      : "請選結束日"}
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      void createAdminCoupon();
                    }}
                  >
                    {editingCouponCode ? "更新優惠券" : "新增優惠券"}
                  </button>
                  {editingCouponCode ? (
                    <button
                      className="btn btn-outline"
                      onClick={resetCouponForm}
                    >
                      取消編輯
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="bg-base-100 rounded-lg shadow p-4">
                <ul className="space-y-2">
                  {coupons.map((coupon) => (
                    <li
                      key={coupon.code}
                      className="flex flex-col gap-3 border-b border-base-300 pb-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {coupon.code} - {coupon.name}
                        </p>
                        <p className="text-xs opacity-70">
                          低消 {formatMoney(coupon.minSpend ?? 0)} · 每帳號{" "}
                          {coupon.usageLimitPerUser ?? 1} 次
                          {coupon.usageLimitTotal
                            ? ` · 數量有限 · ${couponRemainingText(coupon)}`
                            : " · 不限總張數"}
                          {coupon.maxDiscount
                            ? ` · 最高折 ${formatMoney(coupon.maxDiscount)}`
                            : ""}
                          {coupon.startsAt
                            ? ` · 開始 ${formatTaipeiDateTime(coupon.startsAt)}`
                            : ""}
                          {coupon.expiresAt
                            ? ` · 到期 ${formatTaipeiDateTime(coupon.expiresAt)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                        <span className="badge badge-accent">
                          {coupon.discountType === "percent"
                            ? `${coupon.discountValue}%`
                            : formatMoney(coupon.discountValue)}
                        </span>
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => startEditCoupon(coupon)}
                        >
                          編輯
                        </button>
                        <button
                          className="btn btn-xs btn-error btn-outline"
                          onClick={() => {
                            void deleteAdminCoupon(coupon.code);
                          }}
                        >
                          刪除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
            </>
          ) : null}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200">
      <div className="navbar bg-base-100 shadow-lg flex-col items-stretch gap-2 md:flex-row md:items-center">
        <div className="flex-1 w-full md:w-auto">
          <div className="normal-case text-2xl font-bold px-2 py-1">
            🍔 {text.appTitle}
          </div>
        </div>
        <div className="flex-none w-full md:w-auto">
          <div className="flex flex-wrap gap-2 items-center md:justify-end">
            <div className="grid min-w-[18rem] grid-cols-2 overflow-hidden rounded-lg border border-base-300 bg-base-200 text-sm">
              <div className="border-r border-base-300 px-4 py-2">
                <span className="block text-xs opacity-70">
                  {text.readyForPickup}
                </span>
                <strong>{pickupNumberList(orderProgress.readyPickupNumbers)}</strong>
              </div>
              <div className="px-4 py-2">
                <span className="block text-xs opacity-70">
                  {text.waitingPickup}
                </span>
                <strong>{pickupNumberList(orderProgress.waitingPickupNumbers)}</strong>
              </div>
            </div>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                if (user) {
                  setCustomerName(profile.nickname || user.name);
                  setCustomerPhone(profile.phone);
                }
                setCartView("items");
                navigate("/cart");
              }}
              disabled={!user}
            >
              {`${text.cartDetails} (${cartItemCount})`}
            </button>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                navigate("/orders");
                void loadOrderHistory();
              }}
              disabled={!user}
            >
              {text.orderHistory}
            </button>
            {user ? (
              <button
                className="btn btn-sm btn-outline"
                onClick={() => navigate("/profile")}
              >
                {text.profile}
              </button>
            ) : null}
            {user ? (
              <button
                className="btn btn-sm"
                onClick={() => {
                  void handleLogout();
                }}
              >
                {text.logout}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <main className="container mx-auto p-6">
        {!user ? (
          <section className="max-w-xl mx-auto card bg-base-100 shadow-md mb-8">
            <div className="card-body">
              <h2 className="card-title">{text.googleTitle}</h2>
              <p className="text-sm opacity-70">
                {text.googleDescription}
              </p>
              {authError ? (
                <div className="alert alert-error">
                  <span>{authError}</span>
                </div>
              ) : null}
              <button
                className="btn btn-primary w-full"
                onClick={() => {
                  void handleGoogleSignIn();
                }}
                disabled={isGoogleSigningIn}
              >
                {isGoogleSigningIn ? text.googleLoading : text.googleLogin}
              </button>
            </div>
          </section>
        ) : null}

        {actionError ? (
          <div className="alert alert-warning mb-4">
            <span>{actionError}</span>
          </div>
        ) : null}

        {completedNoticeOrder ? (
          <div className="alert alert-info mb-4 max-w-4xl mx-auto">
            <div>
              <p className="font-semibold">{text.completedTitle}</p>
              <p className="text-sm">
                {text.pickupNumber}：#{completedNoticeOrder.dailySequence ?? completedNoticeOrder.id}
              </p>
            </div>
          </div>
        ) : null}

        {promotionalItems.length > 0 ? (
          <section className="mb-8 border-l-4 border-warning bg-warning/10 px-4 py-3">
            <h2 className="font-bold text-lg">{text.promotionNoticeTitle}</h2>
            <p className="text-sm opacity-70">
              {text.promotionNoticeDescription}
            </p>
            <div className="mt-3 divide-y divide-base-300">
              {promotionalItems.map((item) => {
                const copy = menuCopy(item);
                return (
                  <div
                    key={`promotion-${item.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="font-semibold">
                      {item.activePromotion?.name} · {copy.name}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="line-through opacity-50">
                        {formatMoney(item.price)}
                      </span>
                      <strong className="text-success">
                        {formatMoney(promotionalMenuItemPrice(item))}
                      </strong>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {items.length === 0 ? (
          <div className="alert alert-info">
            <span>目前沒有菜單資料</span>
          </div>
        ) : (
          <>
            {grouped.recentItems.length > 0 ? (
              <div className="mb-10">
                <h2 className="text-3xl font-bold mb-4 text-primary border-b-2 border-primary pb-2">
                  {text.newItems}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {grouped.recentItems.map((item) => {
                    const copy = menuCopy(item);
                    return (
                      <div
                        key={`recent-${item.id}`}
                        className="card bg-base-100 shadow-md hover:shadow-lg transition-shadow"
                      >
                        <figure className="h-44 overflow-hidden bg-base-300">
                          <img
                            src={item.imageUrl}
                            alt={copy.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(event) => {
                              const target = event.currentTarget;
                              target.src =
                                "https://images.unsplash.com/photo-1526318896980-cf78c088247c?auto=format&fit=crop&w=800&q=80";
                            }}
                          />
                        </figure>
                        <div className="card-body">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="card-title text-lg">{copy.name}</h3>
                            <span className="badge badge-accent shrink-0">
                              {text.newBadge}
                            </span>
                          </div>
                          <p className="text-sm opacity-80 line-clamp-2 min-h-[2.75rem]">
                            {copy.description}
                          </p>
                          <div className="card-actions justify-between items-center">
                            <div className="flex items-baseline gap-2">
                              {item.activePromotion ? (
                                <span className="text-sm line-through opacity-60">
                                  {formatMoney(item.price)}
                                </span>
                              ) : null}
                              <span className="text-xl font-bold text-success">
                                {formatMoney(promotionalMenuItemPrice(item))}
                              </span>
                            </div>
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => {
                                openAddToCart(item);
                              }}
                              disabled={activeItemId === item.id}
                            >
                              {activeItemId === item.id
                                ? text.adding
                                : `${text.addToCart}${cartQtyByItemId[item.id] ? ` (${cartQtyByItemId[item.id]})` : ""}`}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {grouped.categories.map((category) => (
              <div key={category} className="mb-8">
                <h2 className="text-3xl font-bold mb-4 text-primary border-b-2 border-primary pb-2">
                  {categoryLabel(category)}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(grouped.groupedItems[category] || []).map((item) => {
                  const copy = menuCopy(item);
                  return (
                    <div
                      key={item.id}
                      className="card bg-base-100 shadow-md hover:shadow-lg transition-shadow"
                    >
                      <figure className="h-44 overflow-hidden bg-base-300">
                        <img
                          src={item.imageUrl}
                          alt={copy.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(event) => {
                            const target = event.currentTarget;
                            target.src =
                              "https://images.unsplash.com/photo-1526318896980-cf78c088247c?auto=format&fit=crop&w=800&q=80";
                          }}
                        />
                      </figure>
                      <div className="card-body">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="card-title text-lg">{copy.name}</h3>
                          {item.activePromotion ? (
                            <span className="badge badge-accent shrink-0">
                              {item.activePromotion.name}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm opacity-80 line-clamp-2 min-h-[2.75rem]">
                          {copy.description}
                        </p>
                        <div className="card-actions justify-between items-center">
                          <div className="flex items-baseline gap-2">
                            {item.activePromotion ? (
                              <span className="text-sm line-through opacity-60">
                                {formatMoney(item.price)}
                              </span>
                            ) : null}
                            <span className="text-xl font-bold text-success">
                              {formatMoney(promotionalMenuItemPrice(item))}
                            </span>
                          </div>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => {
                              openAddToCart(item);
                            }}
                            disabled={activeItemId === item.id}
                          >
                            {activeItemId === item.id
                              ? text.adding
                              : `${text.addToCart}${cartQtyByItemId[item.id] ? ` (${cartQtyByItemId[item.id]})` : ""}`}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>
            ))}
          </>
        )}

      </main>

      {user && (isHistoryOpen || isOrderHistoryPage) ? (
        <>
          <section className="fixed inset-0 z-50 bg-base-100 shadow-2xl flex flex-col overscroll-none">
            <div className="p-4 border-b border-base-300 flex items-center justify-between">
              <h2 className="text-xl font-bold">{text.orderHistory}</h2>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setIsHistoryOpen(false);
                  navigate("/");
                }}
              >
                {text.close}
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto overscroll-contain">
              {historyLoading ? (
                <div className="alert">
                  <span>{text.loading}</span>
                </div>
              ) : historyOrders.length === 0 ? (
                <div className="alert alert-info">
                  <span>{text.noHistory}</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {historyOrders.map((order) => (
                    <article
                      key={order.id}
                      className="rounded-lg bg-base-200 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <h3 className="font-semibold">{text.order}</h3>
                          <p className="text-xs opacity-60">
                            {text.pickupNumber} #{order.dailySequence ?? order.id}
                          </p>
                        </div>
                        <span
                          className={`badge ${orderStatusBadgeClass(order.status)}`}
                        >
                          {statusText(order.status)}
                        </span>
                      </div>
                      <div className="text-sm opacity-70 space-y-1">
                        <p>{text.customerName}：{order.customerName || user.name}</p>
                        <p>{text.phone}：{order.customerPhone || "-"}</p>
                        <p>{text.submittedAt}：{formatTaipeiDateTime(order.submittedAt)}</p>
                        {order.completedAt ? (
                          <p>{text.completedAt}：{formatTaipeiDateTime(order.completedAt)}</p>
                        ) : null}
                      </div>
                      <ul className="text-sm list-disc pl-5 space-y-1">
                        {order.items.map((detail) => (
                          <li key={`${order.id}-${detail.menuItemId}-${detail.id ?? detail.menuItemName}`}>
                            {orderItemName(detail)} x {detail.qty}
                            {orderItemIsDrink(detail) ? (
                              <span className="opacity-60">
                                {" "}
                                ({detail.sugarLevel ? sugarLabel(detail.sugarLevel) : "正常糖"} /{" "}
                                {detail.iceLevel ? iceLabel(detail.iceLevel) : "正常冰"})
                              </span>
                            ) : null}
                            {orderItemSpecification(detail) ? (
                              <span className="opacity-60">
                                {" "}
                                ({orderItemSpecification(detail)})
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-center justify-between font-semibold">
                        <span>{order.paymentMethod === "card" ? text.card : text.cash}</span>
                        <span>
                          {text.total} {formatMoney(order.total)}
                        </span>
                      </div>
                      <button
                        className="btn btn-sm btn-outline w-full"
                        onClick={() => {
                          void buyAgain(order);
                        }}
                        disabled={activeItemId === `order-${order.id}`}
                      >
                        {activeItemId === `order-${order.id}` ? text.adding : text.buyAgain}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}

      {user && isCheckoutCouponsPage ? (
        <section className="fixed inset-0 z-50 flex flex-col bg-base-100">
          <div className="flex items-center justify-between border-b border-base-300 p-4">
            <h2 className="text-xl font-bold">{text.useCouponTitle}</h2>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                navigate("/cart");
                setCartView("checkout");
              }}
            >
              {text.close}
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <div className="mx-auto max-w-3xl space-y-8">
              <section className="space-y-3">
                <label className="block text-sm font-semibold">
                  {text.enterCouponCode}
                </label>
                <div className="join w-full">
                  <input
                    className="input input-bordered join-item flex-1 focus:outline-none"
                    placeholder={text.couponPlaceholder}
                    value={couponCode}
                    onChange={(event) => {
                      updateCouponCode(event.currentTarget.value);
                    }}
                  />
                  <button
                    className="btn btn-primary join-item"
                    onClick={() => {
                      if (applyCouponCode()) {
                        navigate("/cart");
                        setCartView("checkout");
                      }
                    }}
                  >
                    {text.useCoupon}
                  </button>
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-lg font-bold">{text.availableCoupons}</h3>
                {availableCollectedCoupons.length === 0 ? (
                  <p className="rounded-lg bg-base-200 p-4 text-sm opacity-70">
                    {text.noAvailableCoupons}
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {availableCollectedCoupons.map((coupon) => (
                      <article
                        key={`checkout-available-${coupon.code}`}
                        className="rounded-lg border border-primary/30 bg-base-200 p-4"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <h4 className="font-bold">{coupon.name}</h4>
                            <p className="mt-1 text-sm opacity-70">
                              {couponRuleText(coupon)}
                            </p>
                          </div>
                          <button
                            className="btn btn-sm btn-primary shrink-0"
                            onClick={() => {
                              selectCoupon(coupon);
                              navigate("/cart");
                              setCartView("checkout");
                            }}
                          >
                            {appliedCoupon?.code === coupon.code
                              ? text.couponSelected
                              : text.useCoupon}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-3 text-lg font-bold">{text.unavailableCoupons}</h3>
                {unavailableCollectedCoupons.length === 0 ? (
                  <p className="rounded-lg bg-base-200 p-4 text-sm opacity-70">
                    {text.noUnavailableCoupons}
                  </p>
                ) : (
                  <div className="grid gap-3 opacity-60">
                    {unavailableCollectedCoupons.map((coupon) => (
                      <article
                        key={`checkout-unavailable-${coupon.code}`}
                        className="rounded-lg border border-base-300 bg-base-200 p-4"
                      >
                        <h4 className="font-bold">{coupon.name}</h4>
                        <p className="mt-1 text-sm">{couponRuleText(coupon)}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </section>
      ) : null}

      {user && isCouponWalletPage ? (
        <section className="fixed inset-0 z-50 flex flex-col bg-base-100">
          <div className="flex items-center justify-between border-b border-base-300 p-4">
            <h2 className="text-xl font-bold">{text.couponWalletTitle}</h2>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => navigate("/profile")}
            >
              {text.close}
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <section className="mb-8">
              <label className="mb-3 block text-lg font-bold">
                {text.enterCouponCode}
              </label>
              <div className="join w-full">
                <input
                  className="input input-bordered join-item flex-1 focus:outline-none"
                  placeholder={text.couponPlaceholder}
                  value={couponCode}
                  onChange={(event) => {
                    updateCouponCode(event.currentTarget.value);
                  }}
                />
                <button
                  className="btn btn-primary join-item"
                  onClick={collectCouponCode}
                >
                  {text.collectCoupon}
                </button>
              </div>
            </section>

            <section className="mb-8">
              <h3 className="mb-3 text-lg font-bold">{text.collectedCoupons}</h3>
              {collectedCoupons.length === 0 ? (
                <p className="rounded-lg bg-base-200 p-4 text-sm opacity-70">
                  {text.noCollectedCoupons}
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {collectedCoupons.map((coupon) => (
                    <article
                      key={`collected-${coupon.code}`}
                      className="rounded-lg border border-base-300 bg-base-200 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-bold">{coupon.name}</h4>
                          <p className="text-xs opacity-70">{coupon.code}</p>
                        </div>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            selectCoupon(coupon);
                            navigate(cartDetails.length > 0 ? "/cart" : "/");
                            if (cartDetails.length > 0) setCartView("checkout");
                          }}
                        >
                          {appliedCoupon?.code === coupon.code
                            ? text.couponSelected
                            : text.useCoupon}
                        </button>
                      </div>
                      <p className="mt-3 text-sm opacity-70">
                        {couponRuleText(coupon)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-3 text-lg font-bold">{text.recommendedCoupons}</h3>
              {recommendedCoupons.length === 0 ? (
                <p className="rounded-lg bg-base-200 p-4 text-sm opacity-70">
                  {text.noRecommendedCoupons}
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {recommendedCoupons.map((coupon) => (
                    <article
                      key={`recommended-${coupon.code}`}
                      className="rounded-lg border border-base-300 bg-base-200 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-bold">{coupon.name}</h4>
                          <p className="text-xs opacity-70">{coupon.code}</p>
                        </div>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => collectCoupon(coupon)}
                        >
                          {text.collectCoupon}
                        </button>
                      </div>
                      <p className="mt-3 text-sm opacity-70">
                        {couponRuleText(coupon)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      ) : null}

      {user && (isProfileOpen || isProfilePage) ? (
        <>
          <div
            className="fixed inset-0 bg-black/35 z-40 pointer-events-none"
            aria-hidden="true"
          />
          <section className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-base-100 shadow-2xl">
            <div className="p-4 border-b border-base-300 flex items-center justify-between">
              <h2 className="text-xl font-bold">{text.profileTitle}</h2>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setIsProfileOpen(false);
                  navigate("/");
                }}
              >
                {text.close}
              </button>
            </div>
            <div className="p-4 space-y-4">
              <input
                className="input input-bordered w-full"
                placeholder={text.nicknamePlaceholder}
                value={profile.nickname}
                onChange={(event) => {
                  const nickname = event.currentTarget.value;
                  setProfile((current) => ({
                    ...current,
                    nickname,
                  }));
                }}
              />
              <input
                className="input input-bordered w-full"
                placeholder={text.phonePlaceholder}
                value={profile.phone}
                inputMode="numeric"
                maxLength={10}
                onChange={(event) => {
                  const phone = event.currentTarget.value
                    .replace(/\D/g, "")
                    .slice(0, 10);
                  setProfile((current) => ({
                    ...current,
                    phone,
                  }));
                }}
              />
              <button
                className="btn btn-outline w-full justify-between"
                onClick={() => navigate("/coupons")}
              >
                <span>{text.couponWallet}</span>
                <span className="badge badge-primary">
                  {collectedCoupons.length}
                </span>
              </button>
              <div className="grid grid-cols-2 gap-2">
                {languageOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`btn btn-sm ${
                      profile.language === option.value
                        ? "btn-primary"
                        : "btn-outline"
                    }`}
                    onClick={() =>
                      setProfile((current) => ({
                        ...current,
                        language: option.value,
                      }))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-primary w-full"
                onClick={() => saveProfile(profile)}
              >
                {text.save}
              </button>
            </div>
          </section>
        </>
      ) : null}

      {activeCustomizingItem ? (
        <section className="fixed inset-0 z-[2147483647] h-[100dvh] bg-base-100 flex flex-col">
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-start p-4">
            <button
              className="btn btn-circle bg-base-100/90 shadow"
              onClick={() => {
                setCustomizingItem(null);
                navigate("/");
              }}
              aria-label={text.back}
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-auto pb-28">
            <figure className="bg-base-200">
              <img
                src={activeCustomizingItem.imageUrl || fallbackMenuImage}
                alt={menuCopy(activeCustomizingItem).name}
                className="h-[42vh] min-h-72 w-full object-cover bg-base-300"
                loading="lazy"
                onError={(event) => {
                  const target = event.currentTarget;
                  target.onerror = null;
                  target.src = fallbackMenuImage;
                }}
              />
            </figure>

            <div className="w-full px-5 md:px-10 lg:px-16">
              <section className="border-b border-base-300 px-5 py-6 space-y-3">
                <h3 className="text-2xl font-bold">
                  {menuCopy(activeCustomizingItem).name}
                </h3>
                <p className="text-base leading-relaxed opacity-75">
                  {menuCopy(activeCustomizingItem).description}
                </p>
                <div className="flex items-baseline gap-3">
                  {activeCustomizingItem.activePromotion ? (
                    <span className="text-base line-through opacity-60">
                      {formatMoney(activeCustomizingItem.price)}
                    </span>
                  ) : null}
                  <p className="text-2xl font-black text-success">
                    {formatMoney(promotionalMenuItemPrice(activeCustomizingItem))}
                  </p>
                </div>
              </section>

              <section className="border-b border-base-300 px-5 py-6">
                <label className="label">
                  <span className="label-text">{text.qty}</span>
                </label>
                <div className="join">
                  <button
                    className="btn join-item"
                    onClick={() =>
                      setCartDraft((current) => ({
                        ...current,
                        qty: Math.max(1, current.qty - 1),
                      }))
                    }
                  >
                    -
                  </button>
                  <span className="btn join-item no-animation">
                    {cartDraft.qty}
                  </span>
                  <button
                    className="btn join-item"
                    onClick={() =>
                      setCartDraft((current) => ({
                        ...current,
                        qty: current.qty + 1,
                      }))
                    }
                  >
                    +
                  </button>
                </div>
              </section>

              {activeCustomizingItem.largePrice !== undefined ? (
                <section className="border-b border-base-300 px-5 py-6">
                  <span className="label-text mb-2 block">{text.portion}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`btn ${cartDraft.size === "small" ? "btn-primary" : "btn-outline"}`}
                      onClick={() =>
                        setCartDraft((current) => ({ ...current, size: "small" }))
                      }
                    >
                      {text.small}{" "}
                      {formatMoney(
                        promotionalMenuItemPrice(activeCustomizingItem),
                      )}
                    </button>
                    <button
                      className={`btn ${cartDraft.size === "large" ? "btn-primary" : "btn-outline"}`}
                      onClick={() =>
                        setCartDraft((current) => ({ ...current, size: "large" }))
                      }
                    >
                      {text.large}{" "}
                      {formatMoney(
                        promotionalMenuItemPrice(
                          activeCustomizingItem,
                          activeCustomizingItem.largePrice,
                        ),
                      )}
                    </button>
                  </div>
                </section>
              ) : null}

              {activeCustomizingItem.eggPrice !== undefined ? (
                <section className="border-b border-base-300 px-5 py-6">
                  <span className="label-text mb-2 block">
                    {text.addEgg} +{formatMoney(activeCustomizingItem.eggPrice)}
                  </span>
                  <div className="join">
                    <button
                      className="btn join-item"
                      onClick={() =>
                        setCartDraft((current) => ({
                          ...current,
                          eggQty: Math.max(0, current.eggQty - 1),
                        }))
                      }
                    >
                      -
                    </button>
                    <span className="btn join-item no-animation">
                      {cartDraft.eggQty}
                    </span>
                    <button
                      className="btn join-item"
                      onClick={() =>
                        setCartDraft((current) => ({
                          ...current,
                          eggQty: current.eggQty + 1,
                        }))
                      }
                    >
                      +
                    </button>
                  </div>
                </section>
              ) : null}

              {activeCustomizingItem.cheesePrice !== undefined ? (
                <section className="border-b border-base-300 px-5 py-6">
                  <span className="label-text mb-2 block">
                    {text.addCheese} +{formatMoney(activeCustomizingItem.cheesePrice)}
                  </span>
                  <div className="join">
                    <button
                      className="btn join-item"
                      onClick={() =>
                        setCartDraft((current) => ({
                          ...current,
                          cheeseQty: Math.max(0, current.cheeseQty - 1),
                        }))
                      }
                    >
                      -
                    </button>
                    <span className="btn join-item no-animation">
                      {cartDraft.cheeseQty}
                    </span>
                    <button
                      className="btn join-item"
                      onClick={() =>
                        setCartDraft((current) => ({
                          ...current,
                          cheeseQty: current.cheeseQty + 1,
                        }))
                      }
                    >
                      +
                    </button>
                  </div>
                </section>
              ) : null}

              {(activeCustomizingItem.addonKeys ?? []).map((addonKey) => {
                const addon = (addonSettings.items ?? []).find(
                  (candidate) => candidate.key === addonKey && candidate.isActive,
                );
                if (!addon) return null;
                const selected = (cartDraft.addons ?? []).find(
                  (candidate) => candidate.key === addon.key,
                );
                return (
                  <section
                    key={addon.key}
                    className="border-b border-base-300 px-5 py-6"
                  >
                    <span className="label-text mb-2 block">
                      {addon.name} +{formatMoney(addon.price)}
                    </span>
                    <div className="join">
                      <button
                        className="btn join-item"
                        onClick={() =>
                          setCartDraft((current) => ({
                            ...current,
                            addons: (current.addons ?? [])
                              .map((candidate) =>
                                candidate.key === addon.key
                                  ? { ...candidate, qty: Math.max(0, candidate.qty - 1) }
                                  : candidate,
                              )
                              .filter((candidate) => candidate.qty > 0),
                          }))
                        }
                      >
                        -
                      </button>
                      <span className="btn join-item no-animation">
                        {selected?.qty ?? 0}
                      </span>
                      <button
                        className="btn join-item"
                        onClick={() =>
                          setCartDraft((current) => {
                            const addons = current.addons ?? [];
                            const existing = addons.find(
                              (candidate) => candidate.key === addon.key,
                            );
                            return {
                              ...current,
                              addons: existing
                                ? addons.map((candidate) =>
                                    candidate.key === addon.key
                                      ? { ...candidate, qty: candidate.qty + 1 }
                                      : candidate,
                                  )
                                : [...addons, { ...addon, qty: 1 }],
                            };
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  </section>
                );
              })}

              {isDrink(activeCustomizingItem) ? (
                <section className="divide-y divide-base-300 border-b border-base-300">
                  <div className="px-5 py-6">
                    <span className="label-text mb-2 block">{text.sugar}</span>
                    <div className="grid grid-cols-3 gap-2">
                      {sugarOptions.map((option) => (
                        <button
                          key={option}
                          className={`btn btn-sm ${cartDraft.sugarLevel === option || (!cartDraft.sugarLevel && option === "正常糖") ? "btn-primary" : "btn-outline"}`}
                          onClick={() =>
                            setCartDraft((current) => ({
                              ...current,
                              sugarLevel: option,
                            }))
                          }
                        >
                          {sugarLabel(option)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="px-5 py-6">
                    <span className="label-text mb-2 block">{text.ice}</span>
                    <div className="grid grid-cols-3 gap-2">
                      {iceOptions.map((option) => (
                        <button
                          key={option}
                          className={`btn btn-sm ${cartDraft.iceLevel === option || (!cartDraft.iceLevel && option === "正常冰") ? "btn-primary" : "btn-outline"}`}
                          onClick={() =>
                            setCartDraft((current) => ({
                              ...current,
                              iceLevel: option,
                            }))
                          }
                        >
                          {iceLabel(option)}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              <label className="form-control px-5 py-6">
                <span className="label-text mb-1">{text.note}</span>
                <textarea
                  className="textarea textarea-bordered"
                  placeholder={text.itemNotePlaceholder}
                  value={cartDraft.note}
                  onChange={(event) => {
                    const note = event.currentTarget.value;
                    setCartDraft((current) => ({
                      ...current,
                      note,
                    }));
                  }}
                />
              </label>
            </div>
          </div>
          <div className="border-t border-base-300 p-4 bg-base-100">
            <div className="w-full px-1 md:px-6 lg:px-12">
              <button
                className="btn btn-primary w-full"
                disabled={activeItemId === activeCustomizingItem.id}
                onClick={() => {
                  void addToCart(activeCustomizingItem, cartDraft);
                }}
              >
                {activeItemId === activeCustomizingItem.id
                  ? text.adding
                  : `${text.addToCart} ${formatMoney(customizingUnitPrice * cartDraft.qty)}`}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {user && (isCartOpen || isCartPage) ? (
        <>
          <aside className="fixed inset-0 bg-base-100 shadow-2xl z-50 flex flex-col overscroll-none">
            <div className="p-4 border-b border-base-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {cartView === "checkout" ? (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setCartView("items")}
                  >
                    {text.back}
                  </button>
                ) : null}
                <h2 className="text-xl font-bold">
                  {cartView === "checkout"
                    ? text.checkout
                    : `${text.cartDetails} (${cartItemCount})`}
                </h2>
              </div>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setIsCartOpen(false);
                  navigate("/");
                }}
              >
                {text.close}
              </button>
            </div>

            <div className="p-4 flex-1 overflow-auto overscroll-contain">
              {staleCartItems.length > 0 ? (
                <div className="alert alert-warning mb-4 items-start">
                  <div>
                    <p className="font-semibold">{text.staleCart}</p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {staleCartItems.map((item) => (
                        <li key={item.menuItemId}>
                          {item.menuItemName} x {item.qty}：
                          {formatMoney(item.menuItemPrice)}
                          {typeof item.currentMenuItemPrice === "number"
                            ? ` → ${formatMoney(item.currentMenuItemPrice)}`
                            : "，目前版本不存在"}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
              {cartView === "items" ? (
                cartDetails.length === 0 ? (
                  <div className="alert">
                    <span>{text.cartEmpty}</span>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {cartGroups.map((group) => (
                      <li
                        key={group.itemId}
                        className="p-3 rounded-lg bg-base-200 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold">
                              {menuCopy(group.item).name}
                            </p>
                            <p className="text-sm opacity-70">
                              {text.totalItems} {group.qty}
                            </p>
                          </div>
                          <p className="font-bold">
                            {formatMoney(group.subtotal)}
                          </p>
                        </div>
                        <div className="space-y-2">
                          {group.lines.map((detail) => (
                            <div
                              key={detail.orderItemId ?? `${detail.itemId}-${detail.orderItem.sugarLevel}-${detail.orderItem.iceLevel}`}
                              className="rounded-lg border border-base-300 bg-base-100 p-3 space-y-2"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold">
                                    {isDrink(detail.item)
                                      ? `${sugarLabel(detail.orderItem.sugarLevel || "正常糖")} / ${iceLabel(detail.orderItem.iceLevel || "正常冰")}`
                                      : text.qty}
                                    {orderItemSpecification(detail.orderItem)
                                      ? ` / ${orderItemSpecification(detail.orderItem)}`
                                      : ""}
                                    <span className="ml-2 opacity-70">
                                      x {detail.qty}
                                    </span>
                                  </p>
                                  {detail.orderItem.note ? (
                                    <p className="text-xs opacity-70 truncate">
                                      {detail.orderItem.note}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="join shrink-0">
                                  <button
                                    className="btn btn-sm join-item"
                                    onClick={() => {
                                      void updateCartLineQty(
                                        detail,
                                        Math.max(0, detail.qty - 1),
                                      );
                                    }}
                                  >
                                    -
                                  </button>
                                  <span className="btn btn-sm join-item no-animation">
                                    {detail.qty}
                                  </span>
                                  <button
                                    className="btn btn-sm join-item"
                                    onClick={() => {
                                      void updateCartLineQty(
                                        detail,
                                        detail.qty + 1,
                                      );
                                    }}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              <details className="rounded-lg border border-base-300">
                                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
                                  {text.edit}
                                </summary>
                                <div className="border-t border-base-300 p-3 space-y-3">
                                  {isDrink(detail.item) ? (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                        {sugarOptions.map((option) => {
                                          const selected =
                                            detail.orderItem.sugarLevel ===
                                              option ||
                                            (!detail.orderItem.sugarLevel &&
                                              option === "正常糖");
                                          return (
                                            <button
                                              key={option}
                                              className={`btn btn-xs ${
                                                selected
                                                  ? "btn-primary"
                                                  : "btn-outline"
                                              }`}
                                              onClick={() => {
                                                void updateCartItemOptions(
                                                  detail.orderItemId,
                                                  detail.itemId,
                                                  { sugarLevel: option },
                                                );
                                              }}
                                            >
                                              {sugarLabel(option)}
                                            </button>
                                          );
                                        })}
                                      </div>
                                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                        {iceOptions.map((option) => {
                                          const selected =
                                            detail.orderItem.iceLevel ===
                                              option ||
                                            (!detail.orderItem.iceLevel &&
                                              option === "正常冰");
                                          return (
                                            <button
                                              key={option}
                                              className={`btn btn-xs ${
                                                selected
                                                  ? "btn-primary"
                                                  : "btn-outline"
                                              }`}
                                              onClick={() => {
                                                void updateCartItemOptions(
                                                  detail.orderItemId,
                                                  detail.itemId,
                                                  { iceLevel: option },
                                                );
                                              }}
                                            >
                                              {iceLabel(option)}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}
                                  {detail.item.largePrice !== undefined ? (
                                    <div className="grid grid-cols-2 gap-2">
                                      <button
                                        className={`btn btn-xs ${detail.orderItem.size !== "large" ? "btn-primary" : "btn-outline"}`}
                                        onClick={() => {
                                          void updateCartItemOptions(
                                            detail.orderItemId,
                                            detail.itemId,
                                            { size: "small" },
                                          );
                                        }}
                                      >
                                        {text.small} {formatMoney(detail.item.price)}
                                      </button>
                                      <button
                                        className={`btn btn-xs ${detail.orderItem.size === "large" ? "btn-primary" : "btn-outline"}`}
                                        onClick={() => {
                                          void updateCartItemOptions(
                                            detail.orderItemId,
                                            detail.itemId,
                                            { size: "large" },
                                          );
                                        }}
                                      >
                                        {text.large} {formatMoney(detail.item.largePrice)}
                                      </button>
                                    </div>
                                  ) : null}
                                  {detail.item.eggPrice !== undefined ? (
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-sm">
                                        {text.addEgg} +{formatMoney(detail.item.eggPrice)}
                                      </span>
                                      <div className="join">
                                        <button
                                          className="btn btn-xs join-item"
                                          onClick={() => {
                                            void updateCartItemOptions(
                                              detail.orderItemId,
                                              detail.itemId,
                                              {
                                                eggQty: Math.max(
                                                  0,
                                                  (detail.orderItem.eggQty ?? 0) - 1,
                                                ),
                                              },
                                            );
                                          }}
                                        >
                                          -
                                        </button>
                                        <span className="btn btn-xs join-item no-animation">
                                          {detail.orderItem.eggQty ?? 0}
                                        </span>
                                        <button
                                          className="btn btn-xs join-item"
                                          onClick={() => {
                                            void updateCartItemOptions(
                                              detail.orderItemId,
                                              detail.itemId,
                                              {
                                                eggQty:
                                                  (detail.orderItem.eggQty ?? 0) + 1,
                                              },
                                            );
                                          }}
                                        >
                                          +
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                  {detail.item.cheesePrice !== undefined ? (
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-sm">
                                        {text.addCheese} +{formatMoney(detail.item.cheesePrice)}
                                      </span>
                                      <div className="join">
                                        <button
                                          className="btn btn-xs join-item"
                                          onClick={() => {
                                            void updateCartItemOptions(
                                              detail.orderItemId,
                                              detail.itemId,
                                              {
                                                cheeseQty: Math.max(
                                                  0,
                                                  (detail.orderItem.cheeseQty ?? 0) - 1,
                                                ),
                                              },
                                            );
                                          }}
                                        >
                                          -
                                        </button>
                                        <span className="btn btn-xs join-item no-animation">
                                          {detail.orderItem.cheeseQty ?? 0}
                                        </span>
                                        <button
                                          className="btn btn-xs join-item"
                                          onClick={() => {
                                            void updateCartItemOptions(
                                              detail.orderItemId,
                                              detail.itemId,
                                              {
                                                cheeseQty:
                                                  (detail.orderItem.cheeseQty ?? 0) + 1,
                                              },
                                            );
                                          }}
                                        >
                                          +
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                  {(detail.item.addonKeys ?? []).map((addonKey) => {
                                    const addon = (addonSettings.items ?? []).find(
                                      (candidate) =>
                                        candidate.key === addonKey && candidate.isActive,
                                    );
                                    if (!addon) return null;
                                    const selected = (detail.orderItem.addons ?? []).find(
                                      (candidate) => candidate.key === addon.key,
                                    );
                                    return (
                                      <div
                                        key={addon.key}
                                        className="flex items-center justify-between gap-3"
                                      >
                                        <span className="text-sm">
                                          {addon.name} +{formatMoney(addon.price)}
                                        </span>
                                        <div className="join">
                                          <button
                                            className="btn btn-xs join-item"
                                            onClick={() => {
                                              void updateCartItemOptions(
                                                detail.orderItemId,
                                                detail.itemId,
                                                {
                                                  addons: (detail.orderItem.addons ?? [])
                                                    .map((candidate) =>
                                                      candidate.key === addon.key
                                                        ? {
                                                            ...candidate,
                                                            qty: Math.max(
                                                              0,
                                                              candidate.qty - 1,
                                                            ),
                                                          }
                                                        : candidate,
                                                    )
                                                    .filter(
                                                      (candidate) => candidate.qty > 0,
                                                    ),
                                                },
                                              );
                                            }}
                                          >
                                            -
                                          </button>
                                          <span className="btn btn-xs join-item no-animation">
                                            {selected?.qty ?? 0}
                                          </span>
                                          <button
                                            className="btn btn-xs join-item"
                                            onClick={() => {
                                              const current = detail.orderItem.addons ?? [];
                                              const exists = current.some(
                                                (candidate) => candidate.key === addon.key,
                                              );
                                              void updateCartItemOptions(
                                                detail.orderItemId,
                                                detail.itemId,
                                                {
                                                  addons: exists
                                                    ? current.map((candidate) =>
                                                        candidate.key === addon.key
                                                          ? {
                                                              ...candidate,
                                                              qty: candidate.qty + 1,
                                                            }
                                                          : candidate,
                                                      )
                                                    : [...current, { ...addon, qty: 1 }],
                                                },
                                              );
                                            }}
                                          >
                                            +
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  <input
                                    className="input input-sm input-bordered w-full"
                                    placeholder={text.itemNotePlaceholder}
                                    value={detail.orderItem.note ?? ""}
                                    onChange={(event) => {
                                      const note = event.currentTarget.value;
                                      void updateCartItemOptions(
                                        detail.orderItemId,
                                        detail.itemId,
                                        { note },
                                      );
                                    }}
                                  />
                                </div>
                              </details>
                            </div>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <div className="space-y-4">
                  <input
                    className="input input-bordered w-full"
                    placeholder={text.checkoutNamePlaceholder}
                    value={customerName}
                    onChange={(event) => setCustomerName(event.currentTarget.value)}
                  />
                  <input
                    className="input input-bordered w-full"
                    placeholder={text.checkoutPhonePlaceholder}
                    value={customerPhone}
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) => {
                      const phone = event.currentTarget.value
                        .replace(/\D/g, "")
                        .slice(0, 10);
                      setCustomerPhone(phone);
                    }}
                    required
                  />
                  <input
                    className="input input-bordered w-full"
                    placeholder={text.pickupTimePlaceholder}
                    value={pickupTime}
                    onChange={(event) => setPickupTime(event.currentTarget.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="label cursor-pointer justify-start gap-2 rounded-lg border border-base-300 p-3">
                      <input
                        type="radio"
                        className="radio radio-sm"
                        checked={paymentMethod === "cash"}
                        onChange={() => setPaymentMethod("cash")}
                      />
                      <span>{text.cash}</span>
                    </label>
                    <label className="label cursor-pointer justify-start gap-2 rounded-lg border border-base-300 p-3">
                      <input
                        type="radio"
                        className="radio radio-sm"
                        checked={paymentMethod === "card"}
                        onChange={() => setPaymentMethod("card")}
                      />
                      <span>{text.card}</span>
                    </label>
                  </div>
                  <textarea
                    className="textarea textarea-bordered w-full"
                    placeholder={text.orderNotePlaceholder}
                    value={orderNote}
                    onChange={(event) => setOrderNote(event.currentTarget.value)}
                  />
                  <div className="space-y-2">
                    <button
                      className="btn btn-outline w-full justify-between"
                      onClick={() => navigate("/checkout-coupons")}
                    >
                      <span>{text.useCouponTitle}</span>
                      <span aria-hidden="true">›</span>
                    </button>
                    {appliedCoupon ? (
                      <div
                        className={`rounded-lg px-3 py-2 text-sm border ${
                          couponCanApply
                            ? "bg-success/10 border-success/30"
                            : "bg-error/10 border-error/40"
                        }`}
                      >
                        <p
                          className={`font-semibold ${
                            couponCanApply ? "text-success" : "text-error"
                          }`}
                        >
                          {couponCanApply ? text.couponApplied : text.couponUnavailable}：
                          {appliedCoupon.code}
                        </p>
                        <p className="opacity-70">
                          {couponRuleText(appliedCoupon)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-base-300 space-y-3">
              <div className="flex items-center justify-between font-semibold">
                <span>{text.totalItems}</span>
                <span>{cartItemCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{cartView === "checkout" ? text.originalAmount : text.totalAmount}</span>
                <span>
                  {formatMoney(cartTotal)}
                </span>
              </div>
              {cartView === "checkout" &&
              appliedCoupon &&
              couponCanApply &&
              couponDiscountTotal > 0 ? (
                <div className="flex items-center justify-between text-sm text-success">
                  <span>{text.discount}：{appliedCoupon.code}</span>
                  <span>-{formatMoney(couponDiscountTotal)}</span>
                </div>
              ) : null}
              {cartView === "checkout" ? (
                <div className="flex items-center justify-between text-lg font-bold">
                  <span>{text.totalAmount}</span>
                  <span>{formatMoney(checkoutTotal)}</span>
                </div>
              ) : null}
              {cartView === "items" ? (
                <>
                  <button
                    className="btn btn-error btn-outline w-full"
                    onClick={() => {
                      void clearCart();
                    }}
                    disabled={cartDetails.length === 0 || isClearingCart}
                  >
                    {isClearingCart ? text.clearing : text.clearCart}
                  </button>
                  <button
                    className="btn btn-primary w-full"
                    onClick={() => {
                      if (user) {
                        setCustomerName(profile.nickname || user.name);
                        setCustomerPhone(profile.phone);
                      }
                      setCartView("checkout");
                    }}
                    disabled={cartDetails.length === 0}
                  >
                    {text.checkout}
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary w-full"
                  onClick={() => {
                    void submitOrder();
                  }}
                  disabled={cartDetails.length === 0 || isSubmittingOrder}
                >
                  {isSubmittingOrder ? text.submitting : text.confirmSubmit}
                </button>
              )}
            </div>
          </aside>
        </>
      ) : null}

      {checkoutNotice ? (
        <div className="fixed left-1/2 top-20 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 pointer-events-none">
          <div className="alert alert-warning shadow-lg justify-center">
            <span>{checkoutNotice}</span>
          </div>
        </div>
      ) : null}

      {profileNotice ? (
        <div className="fixed left-1/2 top-20 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 pointer-events-none">
          <div className="alert alert-warning shadow-lg justify-center">
            <span>{profileNotice}</span>
          </div>
        </div>
      ) : null}

      {couponWalletNotice ? (
        <div className="fixed left-1/2 top-20 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 pointer-events-none">
          <div className="alert alert-info shadow-lg justify-center">
            <span>{couponWalletNotice}</span>
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4">
          <section className="w-full max-w-sm rounded-lg bg-base-100 p-5 shadow-2xl">
            <p className="text-lg">{confirmDialog.message}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmDialog(null)}
              >
                {text.cancel}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const onConfirm = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  onConfirm();
                }}
              >
                {text.confirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

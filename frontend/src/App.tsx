import { useEffect, useState, useMemo } from "react";
import "./App.css";
import type {
  ApiDataResponse,
  ActivePromotion,
  Coupon,
  MenuItem,
  MenuItemVersionHistory,
  Order,
  OrderItem,
  OrderProgress,
  PriceSensitivity,
  SessionUser,
  StaleCartItem,
} from "../../shared/contracts.ts";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function buildApiUrl(path: string) {
  return `${apiBaseUrl}${path}`;
}

function versionChangeLabel(history: MenuItemVersionHistory) {
  if (history.version === 1) return "初版";
  return history.minorVersion === 0 ? "主版更新" : "修訂更新";
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
  if (status === "completed") return "已完成";
  if (status === "submitted") return "製作中";
  return "購物車";
}

function orderStatusBadgeClass(status: Order["status"]) {
  if (status === "completed") return "badge-success";
  if (status === "submitted") return "badge-warning";
  return "badge-ghost";
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
    點心: "點心",
    未分類: "未分類",
  },
  en: {
    飲料: "Drinks",
    餐點: "Meals",
    主餐: "Mains",
    點心: "Snacks",
    未分類: "Other",
  },
  ja: {
    飲料: "ドリンク",
    餐點: "食事",
    主餐: "メイン",
    點心: "軽食",
    未分類: "その他",
  },
  ko: {
    飲料: "음료",
    餐點: "식사",
    主餐: "메인",
    點心: "간식",
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
    adding: "加入中...",
    loading: "讀取中...",
    noHistory: "目前尚無歷史訂單。",
    order: "訂單",
    pendingCart: "購物車",
    making: "製作中",
    completed: "已完成",
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
    discount: "優惠折抵",
    couponLimitOnce: "每個帳號限一次",
    clearing: "清空中...",
    clearCart: "清空購物車",
    submitting: "結帳中...",
    confirmSubmit: "確認送出",
  },
  en: {
    appTitle: "Boxiang Breakfast Menu",
    currentDone: "Now serving",
    waitingCount: "Waiting",
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
    adding: "Adding...",
    loading: "Loading...",
    noHistory: "No order history yet.",
    order: "Order",
    pendingCart: "Cart",
    making: "In progress",
    completed: "Completed",
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
    discount: "Discount",
    couponLimitOnce: "Once per account",
    clearing: "Clearing...",
    clearCart: "Clear cart",
    submitting: "Checking out...",
    confirmSubmit: "Place order",
  },
  ja: {
    appTitle: "博翔 朝食メニュー",
    currentDone: "現在提供中",
    waitingCount: "待ち人数",
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
    adding: "追加中...",
    loading: "読み込み中...",
    noHistory: "注文履歴はまだありません。",
    order: "注文",
    pendingCart: "カート",
    making: "調理中",
    completed: "完了",
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
    discount: "割引",
    couponLimitOnce: "1アカウント1回まで",
    clearing: "削除中...",
    clearCart: "カートを空にする",
    submitting: "会計中...",
    confirmSubmit: "注文を確定",
  },
  ko: {
    appTitle: "보샹 아침 메뉴",
    currentDone: "현재 완료",
    waitingCount: "대기 인원",
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
    adding: "담는 중...",
    loading: "불러오는 중...",
    noHistory: "아직 주문 내역이 없습니다.",
    order: "주문",
    pendingCart: "장바구니",
    making: "준비 중",
    completed: "완료",
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
    discount: "할인",
    couponLimitOnce: "계정당 1회",
    clearing: "비우는 중...",
    clearCart: "장바구니 비우기",
    submitting: "결제 중...",
    confirmSubmit: "주문 확정",
  },
};

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const isAdminPage = currentPath.startsWith("/admin");
  const isAdminAddProductPage = currentPath === "/admin/add-product";
  const isCartPage = currentPath === "/cart";
  const isOrderHistoryPage = currentPath === "/orders";
  const isProfilePage = currentPath === "/profile";
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
  });
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [staleCartItems, setStaleCartItems] = useState<StaleCartItem[]>([]);
  const [versionHistoryByLogicalId, setVersionHistoryByLogicalId] = useState<
    Record<string, MenuItemVersionHistory[]>
  >({});
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [isAdminMenuFormOpen, setIsAdminMenuFormOpen] = useState(false);
  const [adminLogin, setAdminLogin] = useState({
    username: "admin",
    password: "admin1234",
  });
  const [adminError, setAdminError] = useState("");
  const [priceSensitivity, setPriceSensitivity] = useState<
    PriceSensitivity[]
  >([]);
  const [activePromotions, setActivePromotions] = useState<ActivePromotion[]>(
    [],
  );
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [editingCouponCode, setEditingCouponCode] = useState<string | null>(null);
  const [newCoupon, setNewCoupon] = useState({
    code: "BREAKFAST10",
    name: "早餐折 10 元",
    discountType: "amount" as "amount" | "percent",
    discountValue: 10,
    minSpend: 0,
    maxDiscount: 0,
    usageLimitPerUser: 1,
    usageLimitTotal: 0,
    startsDate: todayTaipeiDate(),
    endsDate: todayTaipeiDate(),
  });
  const [newMenuItem, setNewMenuItem] = useState({
    price: 50,
    category: "主餐",
    imageUrl: "",
    translations: {
      "zh-TW": { name: "", description: "" },
      en: { name: "", description: "" },
      ja: { name: "", description: "" },
      ko: { name: "", description: "" },
    } as NonNullable<MenuItem["translations"]>,
  });
  const [couponCode, setCouponCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [adminMenuNotice, setAdminMenuNotice] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [adminOrders, setAdminOrders] = useState<Order[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartView, setCartView] = useState<"items" | "checkout">("items");
  const [isClearingCart, setIsClearingCart] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [nowText, setNowText] = useState(
    new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
  );
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [cartDraft, setCartDraft] = useState({
    qty: 1,
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

  const statusText = (status: Order["status"]) => {
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
  const categoryLabel = (category: string) =>
    categoryLabels[profile.language]?.[category] ?? category;
  const sugarLabel = (option: string) =>
    sugarOptionLabels[profile.language]?.[option] ?? option;
  const iceLabel = (option: string) =>
    iceOptionLabels[profile.language]?.[option] ?? option;
  const couponDiscountTotal = useMemo(
    () => calculateCouponDiscount(appliedCoupon, cartTotal),
    [appliedCoupon, cartTotal],
  );
  const checkoutTotal = Math.max(0, cartTotal - couponDiscountTotal);

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
          await Promise.all([loadMenu(), loadCoupons()]);
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
      if (["/cart", "/orders", "/profile"].includes(currentPath)) {
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
    if (!adminMenuNotice) return;

    const timer = window.setTimeout(() => {
      setAdminMenuNotice("");
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [adminMenuNotice]);

  useEffect(() => {
    const shouldLockBody =
      isAdminMenuFormOpen ||
      isAdminAddProductPage ||
      isCartOpen ||
      isCartPage ||
      isHistoryOpen ||
      isOrderHistoryPage ||
      isProfileOpen ||
      isProfilePage ||
      isItemPage ||
      Boolean(customizingItem);
    if (!shouldLockBody) return;

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
    isAdminAddProductPage,
    isAdminMenuFormOpen,
    isCartOpen,
    isCartPage,
    isHistoryOpen,
    isOrderHistoryPage,
    isItemPage,
    isProfilePage,
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
      sugarLevel: "",
      iceLevel: "",
      note: "",
    });
  }, [isItemPage, items.length, loading, routeItem?.id, user]);

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
    const groupedItems = items.reduce(
      (acc, item) => {
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

    return { groupedItems, categories };
  }, [items]);

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
          subtotal: item.price * orderItem.qty,
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
    const submittedToday = adminOrders.filter((order) => {
      const sourceDate = order.submittedAt ?? order.createdAt;
      return (
        new Date(sourceDate).toLocaleDateString("sv-SE", {
          timeZone: "Asia/Taipei",
        }) === today && order.status !== "pending"
      );
    });
    const revenue = submittedToday.reduce((sum, order) => sum + order.total, 0);
    const itemSales = new Map<string, { name: string; qty: number }>();
    const hourlySales = new Map<number, number>();

    for (const order of submittedToday) {
      const hour = new Date(order.submittedAt ?? order.createdAt).getHours();
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
      submittedToday,
      revenue,
      pendingCount: adminOrders.filter((order) => order.status === "submitted")
        .length,
      completedCount: submittedToday.filter(
        (order) => order.status === "completed",
      ).length,
      itemRanking: Array.from(itemSales.values()).sort(
        (a, b) => b.qty - a.qty,
      ),
      hourlyRanking: Array.from(hourlySales.entries())
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => a.hour - b.hour),
    };
  }, [adminOrders]);

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

  async function loadVersionHistory(logicalId: string): Promise<void> {
    if (versionHistoryByLogicalId[logicalId]) {
      setVersionHistoryByLogicalId((current) => {
        const next = { ...current };
        delete next[logicalId];
        return next;
      });
      return;
    }

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
      setVersionHistoryByLogicalId((current) => ({
        ...current,
        [logicalId]: Array.isArray(payload?.data) ? payload.data : [],
      }));
    } catch (historyError) {
      setActionError("讀取版本歷史失敗，請稍後再試。");
      console.error(historyError);
    } finally {
      setLoadingHistoryId(null);
    }
  }

  async function loadAdminData(): Promise<void> {
    setAdminLoading(true);
    setAdminError("");

    try {
      const [analyticsResponse, promotionsResponse, ordersResponse, couponsResponse] =
        await Promise.all([
          fetch(buildApiUrl("/api/menu/analytics/price-sensitivity"), {
            credentials: "include",
          }),
          fetch(buildApiUrl("/api/promotions/active"), {
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
        !analyticsResponse.ok ||
        !promotionsResponse.ok ||
        !ordersResponse.ok ||
        !couponsResponse.ok
      ) {
        if (ordersResponse.status === 401 || analyticsResponse.status === 401) {
          setAdminAuthed(false);
        }
        throw new Error("Admin API failed");
      }

      const analyticsPayload =
        (await analyticsResponse.json()) as ApiDataResponse<
          PriceSensitivity[]
        >;
      const promotionsPayload =
        (await promotionsResponse.json()) as ApiDataResponse<
          ActivePromotion[]
        >;
      const ordersPayload =
        (await ordersResponse.json()) as ApiDataResponse<Order[]>;
      const couponsPayload =
        (await couponsResponse.json()) as ApiDataResponse<Coupon[]>;

      setPriceSensitivity(
        Array.isArray(analyticsPayload?.data) ? analyticsPayload.data : [],
      );
      setActivePromotions(
        Array.isArray(promotionsPayload?.data) ? promotionsPayload.data : [],
      );
      setAdminOrders(
        Array.isArray(ordersPayload?.data) ? ordersPayload.data : [],
      );
      setCoupons(Array.isArray(couponsPayload?.data) ? couponsPayload.data : []);

      const histories = await Promise.all(
        items.map(async (item) => {
          const response = await fetch(
            buildApiUrl(`/api/menu/${item.logicalId}/history`),
            { credentials: "include" },
          );
          if (!response.ok) return [item.logicalId, []] as const;

          const payload =
            (await response.json()) as ApiDataResponse<
              MenuItemVersionHistory[]
            >;
          return [
            item.logicalId,
            Array.isArray(payload?.data) ? payload.data : [],
          ] as const;
        }),
      );

      setVersionHistoryByLogicalId(Object.fromEntries(histories));
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
    setPriceSensitivity([]);
    setVersionHistoryByLogicalId({});
    navigate("/admin");
  }

  async function createAdminCoupon(): Promise<void> {
    const code = newCoupon.code.trim().toUpperCase();
    const name = newCoupon.name.trim();
    if (!code || !name || newCoupon.discountValue <= 0) {
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
      editingCouponCode.toUpperCase() !== code.toUpperCase()
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
        discountValue: newCoupon.discountValue,
        minSpend: newCoupon.minSpend,
        maxDiscount: newCoupon.maxDiscount,
        usageLimitPerUser: newCoupon.usageLimitPerUser,
        usageLimitTotal: newCoupon.usageLimitTotal,
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
      discountValue: coupon.discountValue,
      minSpend: coupon.minSpend ?? 0,
      maxDiscount: coupon.maxDiscount ?? 0,
      usageLimitPerUser: coupon.usageLimitPerUser ?? 1,
      usageLimitTotal: coupon.usageLimitTotal ?? 0,
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
      discountValue: 10,
      minSpend: 0,
      maxDiscount: 0,
      usageLimitPerUser: 1,
      usageLimitTotal: 0,
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

  async function createAdminMenuItem(): Promise<void> {
    const missingTranslation = menuLanguageOptions.some((option) => {
      const translation = newMenuItem.translations[option.value];
      return !translation.name.trim() || !translation.description.trim();
    });
    if (missingTranslation) {
      setAdminMenuNotice("新增商品失敗：四種語言的名稱與介紹都要填。");
      return;
    }
    if (!newMenuItem.imageUrl.trim() || newMenuItem.price < 0) {
      setAdminMenuNotice("請輸入完整的商品價格與圖片。");
      return;
    }
    if (!window.confirm("確定要新增這個商品嗎？")) {
      return;
    }

    const response = await fetch(buildApiUrl("/api/menu"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        price: newMenuItem.price,
        category: newMenuItem.category,
        imageUrl: newMenuItem.imageUrl,
        translations: newMenuItem.translations,
      }),
    });

    if (!response.ok) {
      setAdminMenuNotice("新增商品失敗，請確認四種語言與商品資料都已填寫。");
      return;
    }

    setNewMenuItem((current) => ({
      ...current,
      translations: {
        "zh-TW": { name: "", description: "" },
        en: { name: "", description: "" },
        ja: { name: "", description: "" },
        ko: { name: "", description: "" },
      },
    }));
    setIsAdminMenuFormOpen(false);
    navigate("/admin");
    await Promise.all([loadMenu(), loadAdminData()]);
    setAdminError("商品已新增。");
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

  async function completeAdminOrder(orderId: number): Promise<void> {
    if (!window.confirm(`確定要完成訂單 #${orderId} 嗎？`)) {
      return;
    }

    const response = await fetch(buildApiUrl(`/api/orders/${orderId}/complete`), {
      method: "PATCH",
      credentials: "include",
    });

    if (!response.ok) {
      setAdminError("完成訂單失敗，請稍後再試。");
      return;
    }

    await Promise.all([loadAdminData(), loadOrderProgress()]);
    setAdminError(`訂單 #${orderId} 已完成。`);
  }

  function openAddToCart(item: MenuItem) {
    if (!user) {
      setActionError("請先使用 Google 登入後再加入購物車。");
      return;
    }

    setCartDraft({
      qty: 1,
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
    next: { sugarLevel?: string; iceLevel?: string; note?: string },
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
      }),
    });

    if (!response.ok) {
      setActionError("更新數量失敗，請稍後再試。");
      return;
    }

    const payload = (await response.json()) as ApiDataResponse<Order>;
    if (payload?.data) syncCartFromOrder(payload.data);
  }

  async function clearCart(): Promise<void> {
    if (!user || orderId === null || cartDetails.length === 0) {
      return;
    }
    if (!window.confirm("確定要清空購物車嗎？")) {
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

  function applyCouponCode(): void {
    const normalizedCode = couponCode.trim().toUpperCase();
    if (!normalizedCode) {
      setCheckoutNotice(text.couponInvalid);
      return;
    }

    const coupon =
      coupons.find(
        (item) =>
          item.code.toUpperCase() === normalizedCode && item.isActive !== false,
      ) ?? null;

    if (!coupon || !isCouponUsable(coupon)) {
      setAppliedCoupon(null);
      setCheckoutNotice(text.couponInvalid);
      return;
    }

    setCouponCode(coupon.code);
    setAppliedCoupon(coupon);
    setCheckoutNotice(`${text.couponApplied}：${coupon.code}`);
  }

  function updateCouponCode(nextCode: string): void {
    const normalizedCode = nextCode.toUpperCase();
    setCouponCode(normalizedCode);

    const coupon =
      coupons.find(
        (item) =>
          item.code.toUpperCase() === normalizedCode && item.isActive !== false,
      ) ?? null;
    setAppliedCoupon(coupon && isCouponUsable(coupon) ? coupon : null);
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
        order.couponCode?.toUpperCase() === coupon.code.toUpperCase(),
    ).length;
    if ((coupon.usageLimitTotal ?? 0) > 0 && totalUsedCount >= coupon.usageLimitTotal) {
      return false;
    }

    const usedCount = historyOrders.filter(
      (order) =>
        order.status !== "pending" &&
        order.couponCode?.toUpperCase() === coupon.code.toUpperCase(),
    ).length;
    return usedCount < (coupon.usageLimitPerUser ?? 1);
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
            couponCode: appliedCoupon?.code,
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

        <main className="container mx-auto p-6 space-y-6">
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
                {adminError ? (
                  <div className="alert alert-warning">
                    <span>{adminError}</span>
                  </div>
                ) : null}
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
          {adminError ? (
            <div className="alert alert-warning">
              <span>{adminError}</span>
            </div>
          ) : null}

          <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
            </>
          ) : null}

          {adminAuthed ? (
            <>
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold">菜單商品</h2>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setAdminMenuNotice("");
                  navigate("/admin/add-product");
                }}
              >
                新增商品
              </button>
            </div>
          </section>

          {(isAdminMenuFormOpen || isAdminAddProductPage) ? (
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
                      navigate("/admin");
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
                      void createAdminMenuItem();
                    }}
                  >
                    新增商品
                  </button>
                </div>
              </section>
            </>
          ) : null}

          <section>
            <h2 className="text-2xl font-bold mb-3">POS 訂單看板</h2>
            <div className="overflow-x-auto bg-base-100 rounded-lg shadow">
              <table className="table table-zebra">
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
                    .filter((order) => order.status === "submitted")
                    .slice(0, 20)
                    .map((order) => (
                      <tr key={order.id}>
                        <td className="font-bold">
                          #{order.dailySequence ?? order.id}
                          <div className="text-xs opacity-50">
                            系統 #{order.id}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge ${orderStatusBadgeClass(order.status)}`}
                          >
                            {orderStatusLabel(order.status)}
                          </span>
                        </td>
                        <td>{order.paymentMethod === "card" ? "刷卡" : "現金"}</td>
                        <td>
                          <ul className="space-y-1 text-sm">
                            {order.items.map((item) => (
                              <li key={`${order.id}-${item.menuItemId}`}>
                                {item.menuItemName} x {item.qty}
                                {item.sugarLevel || item.iceLevel ? (
                                  <span className="opacity-60">
                                    {" "}
                                    ({item.sugarLevel ? sugarLabel(item.sugarLevel) : "預設糖"} /{" "}
                                    {item.iceLevel ? iceLabel(item.iceLevel) : "預設冰"})
                                  </span>
                                ) : null}
                                {item.note ? (
                                  <span className="opacity-60">
                                    {" "}
                                    - {item.note}
                                  </span>
                                ) : null}
                              </li>
                            ))}
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
                            <button
                              className="btn btn-xs btn-success"
                              onClick={() => {
                                void completeAdminOrder(order.id);
                              }}
                            >
                              完成
                            </button>
                          ) : (
                            <span className="text-xs opacity-50">完成時間已記錄</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h2 className="text-2xl font-bold mb-3">每日品項銷售排行</h2>
              <div className="bg-base-100 rounded-lg shadow p-4">
                {todayAdminStats.itemRanking.length === 0 ? (
                  <p className="opacity-60">今日尚無已送出訂單。</p>
                ) : (
                  <ol className="space-y-2">
                    {todayAdminStats.itemRanking.slice(0, 10).map((item, index) => (
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
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-3">下單時段統計</h2>
              <div className="bg-base-100 rounded-lg shadow p-4">
                {todayAdminStats.hourlyRanking.length === 0 ? (
                  <p className="opacity-60">今日尚無時段資料。</p>
                ) : (
                  <div className="space-y-2">
                    {todayAdminStats.hourlyRanking.map((row) => (
                      <div
                        key={row.hour}
                        className="flex items-center justify-between"
                      >
                        <span>{String(row.hour).padStart(2, "0")}:00</span>
                        <progress
                          className="progress progress-primary mx-3 flex-1"
                          value={row.count}
                          max={Math.max(
                            ...todayAdminStats.hourlyRanking.map(
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
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3">菜單版本管理</h2>
            <div className="overflow-x-auto bg-base-100 rounded-lg shadow">
              <table className="table table-zebra">
                <thead>
                  <tr>
                    <th>順序</th>
                    <th>品項</th>
                    <th>分級版本</th>
                    <th>A/B</th>
                    <th>促銷</th>
                    <th>價格</th>
                    <th>歷史</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const histories =
                      versionHistoryByLogicalId[item.logicalId] ?? [];

                    return (
                      <tr key={item.id}>
                        <td>{item.displayOrder ?? "-"}</td>
                        <td>
                          <div className="font-semibold">{item.name}</div>
                          <div className="text-xs opacity-60">
                            {item.logicalId} / {item.id}
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <span className="badge badge-primary badge-sm">
                              主版 {item.majorVersion}
                            </span>
                            <span className="badge badge-ghost badge-sm">
                              修訂 {item.minorVersion}
                            </span>
                            <span className="badge badge-outline badge-sm">
                              v{item.majorVersion}.{item.minorVersion}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-secondary badge-sm">
                            {item.testGroup}
                          </span>
                        </td>
                        <td>
                          {item.activePromotion ? (
                            <span className="badge badge-accent badge-sm">
                              {item.activePromotion.name}
                            </span>
                          ) : (
                            <span className="text-sm opacity-50">無</span>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span>{formatMoney(item.price)}</span>
                            <button
                              className="btn btn-xs btn-outline"
                              onClick={() => {
                                void updateAdminMenuPrice(item);
                              }}
                            >
                              調價
                            </button>
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {histories.slice(0, 3).map((history) => (
                              <span
                                key={history.id}
                                className="badge badge-outline badge-sm"
                              >
                                {versionChangeLabel(history)} v
                                {history.majorVersion}.{history.minorVersion}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h2 className="text-2xl font-bold mb-3">價格敏感度分析</h2>
              <div className="overflow-x-auto bg-base-100 rounded-lg shadow">
                <table className="table table-zebra">
                  <thead>
                    <tr>
                      <th>品項</th>
                      <th>版本</th>
                      <th>價格</th>
                      <th>銷量</th>
                      <th>營收</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceSensitivity.map((row) => (
                      <tr
                        key={`${row.logicalId}-${row.version}-${row.price}-${row.testGroup}`}
                      >
                        <td>{row.name}</td>
                        <td>
                          v{row.majorVersion}.{row.minorVersion}
                        </td>
                        <td>{formatMoney(row.price)}</td>
                        <td>{row.totalQty}</td>
                        <td>{formatMoney(row.totalRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-3">目前促銷</h2>
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
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>

          <section>
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
                          const discountValue = parseWholeNumber(
                            event.currentTarget.value,
                            1,
                          );
                          setNewCoupon((current) => ({
                            ...current,
                            discountValue:
                              current.discountType === "percent"
                                ? Math.min(100, Math.max(1, discountValue))
                                : Math.max(1, discountValue),
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
                          const minSpend = parseWholeNumber(
                            event.currentTarget.value,
                          );
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
                          const maxDiscount = parseWholeNumber(
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
                          const usageLimitPerUser = Math.max(
                            1,
                            parseWholeNumber(event.currentTarget.value, 1),
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
                          const usageLimitTotal = parseWholeNumber(
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
                      className="flex items-start justify-between gap-3 border-b border-base-300 pb-2"
                    >
                      <div>
                        <p className="font-semibold">
                          {coupon.code} - {coupon.name}
                        </p>
                        <p className="text-xs opacity-70">
                          低消 {formatMoney(coupon.minSpend ?? 0)} · 每帳號{" "}
                          {coupon.usageLimitPerUser ?? 1} 次
                          {coupon.usageLimitTotal
                            ? ` · 限量 ${coupon.usageLimitTotal} 張`
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
                      <div className="flex items-center gap-2">
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
            <div className="rounded-lg border border-base-300 bg-base-200 px-4 py-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
              <span>
                {text.currentDone}：
                <strong>#{orderProgress.latestCompletedOrderId ?? "-"}</strong>
              </span>
              <span>
                {text.waitingCount}：
                <strong>{orderProgress.waitingCount ?? 0}</strong>
              </span>
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

        {items.length === 0 ? (
          <div className="alert alert-info">
            <span>目前沒有菜單資料</span>
          </div>
        ) : (
          grouped.categories.map((category) => (
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
                        <div className="flex flex-wrap gap-2 min-h-6">
                          {item.priceChanged &&
                          typeof item.previousPrice === "number" ? (
                            <span className="badge badge-warning badge-sm">
                              {formatMoney(item.previousPrice)} →{" "}
                              {formatMoney(item.price)}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm opacity-80 line-clamp-2 min-h-[2.75rem]">
                          {copy.description}
                        </p>
                        <div className="card-actions justify-between items-center">
                          <span className="text-xl font-bold text-success">
                            {formatMoney(item.price)}
                          </span>
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
          ))
        )}

      </main>

      {user && (isHistoryOpen || isOrderHistoryPage) ? (
        <>
          <section className="fixed inset-0 z-50 bg-base-100 shadow-2xl flex flex-col">
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
            <div className="p-4 flex-1 overflow-auto">
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
                        <p>{text.createdAt}：{formatTaipeiDateTime(order.createdAt)}</p>
                        <p>{text.submittedAt}：{formatTaipeiDateTime(order.submittedAt)}</p>
                        {order.completedAt ? (
                          <p>{text.completedAt}：{formatTaipeiDateTime(order.completedAt)}</p>
                        ) : null}
                      </div>
                      <ul className="text-sm list-disc pl-5 space-y-1">
                        {order.items.map((detail) => (
                          <li key={`${order.id}-${detail.menuItemId}-${detail.id ?? detail.menuItemName}`}>
                            {orderItemName(detail)} x {detail.qty}
                            {detail.sugarLevel || detail.iceLevel ? (
                              <span className="opacity-60">
                                {" "}
                                ({detail.sugarLevel ? sugarLabel(detail.sugarLevel) : text.defaultSugar} /{" "}
                                {detail.iceLevel ? iceLabel(detail.iceLevel) : text.defaultIce})
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
        <section className="fixed inset-0 z-50 h-[100dvh] bg-base-100 flex flex-col">
          <div className="p-4 border-b border-base-300 flex items-start justify-between gap-3">
            <div>
              <button
                className="btn btn-sm btn-ghost -ml-2 mb-3"
                onClick={() => {
                  setCustomizingItem(null);
                  navigate("/");
                }}
              >
                {text.back}
              </button>
              <div>
                <h2 className="text-xl font-bold">
                  {menuCopy(activeCustomizingItem).name}
                </h2>
                <p className="text-sm opacity-70">
                  {formatMoney(activeCustomizingItem.price)}
                </p>
              </div>
            </div>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setCustomizingItem(null);
                navigate("/");
              }}
            >
              {text.close}
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-2xl p-4 space-y-5">
              <div className="rounded-lg overflow-hidden bg-base-200 border border-base-300">
                <img
                  src={activeCustomizingItem.image}
                  alt={menuCopy(activeCustomizingItem).name}
                  className="h-64 w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="rounded-lg bg-base-200 p-4 space-y-2">
                <h3 className="text-2xl font-bold">
                  {menuCopy(activeCustomizingItem).name}
                </h3>
                <p className="text-base opacity-75">
                  {menuCopy(activeCustomizingItem).description}
                </p>
                <p className="text-2xl font-black text-success">
                  {formatMoney(activeCustomizingItem.price)}
                </p>
              </div>

              <div>
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
              </div>

              {isDrink(activeCustomizingItem) ? (
                <div className="space-y-3">
                  <div>
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
                  <div>
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
                </div>
              ) : null}

              <label className="form-control">
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
            <div className="mx-auto w-full max-w-2xl">
              <button
                className="btn btn-primary w-full"
                disabled={activeItemId === activeCustomizingItem.id}
                onClick={() => {
                  void addToCart(activeCustomizingItem, cartDraft);
                }}
              >
                {activeItemId === activeCustomizingItem.id
                  ? text.adding
                  : `${text.addToCart} ${formatMoney(activeCustomizingItem.price * cartDraft.qty)}`}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {user && (isCartOpen || isCartPage) ? (
        <>
          <aside className="fixed inset-0 bg-base-100 shadow-2xl z-50 flex flex-col">
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

            <div className="p-4 flex-1 overflow-auto">
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
                              {formatMoney(group.item.price)} x {group.qty}
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
                  <div className="rounded-lg bg-base-200 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span>{text.totalItems}</span>
                      <span className="font-semibold">{cartItemCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-lg font-bold">
                      <span>{text.totalAmount}</span>
                      <span>{formatMoney(checkoutTotal)}</span>
                    </div>
                    {appliedCoupon ? (
                      <div className="flex items-center justify-between text-sm text-success">
                        <span>
                          {text.discount}：{appliedCoupon.code}
                        </span>
                        <span>-{formatMoney(couponDiscountTotal)}</span>
                      </div>
                    ) : null}
                  </div>
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
                    <div className="join w-full">
                      <input
                        className="input input-bordered join-item flex-1 focus:outline-none"
                        placeholder="輸入優惠碼"
                        value={couponCode}
                        onChange={(event) => {
                          updateCouponCode(event.currentTarget.value);
                        }}
                      />
                      <button
                        className="btn btn-outline join-item"
                        onClick={applyCouponCode}
                      >
                        {text.addCoupon}
                      </button>
                    </div>
                    {appliedCoupon ? (
                      <div className="rounded-lg bg-success/10 border border-success/30 px-3 py-2 text-sm">
                        <p className="font-semibold text-success">
                          {text.couponApplied}：{appliedCoupon.code}
                        </p>
                        <p className="opacity-70">
                          {text.couponLimitOnce}，{text.discount}{" "}
                          {formatMoney(couponDiscountTotal)}
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
              <div className="flex items-center justify-between text-lg font-bold">
                <span>{text.totalAmount}</span>
                <span>
                  {formatMoney(cartView === "checkout" ? checkoutTotal : cartTotal)}
                </span>
              </div>
              {cartView === "checkout" && appliedCoupon ? (
                <div className="flex items-center justify-between text-sm text-success">
                  <span>{text.discount}</span>
                  <span>-{formatMoney(couponDiscountTotal)}</span>
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
    </div>
  );
}

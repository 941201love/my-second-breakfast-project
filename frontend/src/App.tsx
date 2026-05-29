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

type UserProfile = {
  nickname: string;
  phone: string;
  language: "zh-TW" | "en" | "ja" | "ko";
};

const sugarOptions = ["正常糖", "少糖", "半糖", "微糖", "無糖"];
const iceOptions = ["正常冰", "少冰", "微冰", "去冰", "熱飲"];

export default function App() {
  const isAdminPage = window.location.pathname.startsWith("/admin");
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
  const [newCoupon, setNewCoupon] = useState({
    code: "BREAKFAST10",
    name: "早餐折 10 元",
    discountType: "amount" as "amount" | "percent",
    discountValue: 10,
  });
  const [couponCode, setCouponCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [pickupTime, setPickupTime] = useState("");
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
          await loadMenu();
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
  }, [user]);

  function saveProfile(nextProfile: UserProfile) {
    if (!user) return;

    setProfile(nextProfile);
    setCustomerName(nextProfile.nickname || user.name);
    setCustomerPhone(nextProfile.phone);
    window.localStorage.setItem(
      `breakfast-profile:${user.id}`,
      JSON.stringify(nextProfile),
    );
    setIsProfileOpen(false);
  }

  useEffect(() => {
    if (!completedNoticeOrder) return;

    const timer = window.setTimeout(() => {
      setCompletedNoticeOrder(null);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [completedNoticeOrder]);

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

  const cartDetails = useMemo(() => {
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
      .filter((entry) => entry !== null);
  }, [cartOrderItemById, cartQtyByItemId, items]);

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
  }

  async function createAdminCoupon(): Promise<void> {
    const response = await fetch(buildApiUrl("/api/coupons"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...newCoupon, isActive: true }),
    });

    if (!response.ok) {
      setAdminError("新增優惠券失敗。");
      return;
    }

    await loadAdminData();
  }

  async function updateAdminMenuPrice(item: MenuItem): Promise<void> {
    const raw = window.prompt(`調整「${item.name}」價格`, String(item.price));
    if (!raw) return;
    const price = Number(raw);
    if (!Number.isFinite(price) || price < 0) return;

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
  }

  async function completeAdminOrder(orderId: number): Promise<void> {
    const response = await fetch(buildApiUrl(`/api/orders/${orderId}/complete`), {
      method: "PATCH",
      credentials: "include",
    });

    if (!response.ok) {
      setAdminError("完成訂單失敗，請稍後再試。");
      return;
    }

    await Promise.all([loadAdminData(), loadOrderProgress()]);
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
      setIsCartOpen(true);
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

  async function submitOrder(): Promise<void> {
    if (!user || orderId === null || cartDetails.length === 0) {
      return;
    }

    setActionError("");
    setStaleCartItems([]);
    if (!customerPhone.trim()) {
      setActionError("請填寫電話號碼，方便店家確認取餐。");
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
            couponCode: couponCode.trim() || undefined,
            customerName: customerName.trim() || user.name,
            customerPhone: customerPhone.trim() || undefined,
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

        throw new Error(`Submit order failed: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as ApiDataResponse<Order>;
      setLastSubmittedOrder(payload.data);
      resetCartState();
      setIsCartOpen(false);
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
            <a className="btn btn-ghost normal-case text-2xl" href="/admin">
              早餐店管理後台
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
                  onChange={(event) =>
                    setAdminLogin((current) => ({
                      ...current,
                      username: event.currentTarget.value,
                    }))
                  }
                  placeholder="帳號"
                />
                <input
                  className="input input-bordered"
                  type="password"
                  value={adminLogin.password}
                  onChange={(event) =>
                    setAdminLogin((current) => ({
                      ...current,
                      password: event.currentTarget.value,
                    }))
                  }
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
                <div className="stat-value text-primary">
                  {todayAdminStats.submittedToday.length}
                </div>
              </div>
            </div>
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">今日營業額</div>
                <div className="stat-value text-secondary">
                  ${todayAdminStats.revenue}
                </div>
              </div>
            </div>
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">待完成</div>
                <div className="stat-value text-accent">
                  {todayAdminStats.pendingCount}
                </div>
              </div>
            </div>
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">已完成</div>
                <div className="stat-value text-success">
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
                                    ({item.sugarLevel || "預設糖"} /{" "}
                                    {item.iceLevel || "預設冰"})
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
                        <td className="font-semibold">${order.total}</td>
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
                            <span>${item.price}</span>
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
                        <td>${row.price}</td>
                        <td>{row.totalQty}</td>
                        <td>${row.totalRevenue}</td>
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
                              : `$${promotion.discountValue}`}
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
                <div className="card-body">
                  <input
                    className="input input-bordered"
                    value={newCoupon.code}
                    onChange={(event) =>
                      setNewCoupon((current) => ({
                        ...current,
                        code: event.currentTarget.value,
                      }))
                    }
                    placeholder="優惠碼"
                  />
                  <input
                    className="input input-bordered"
                    value={newCoupon.name}
                    onChange={(event) =>
                      setNewCoupon((current) => ({
                        ...current,
                        name: event.currentTarget.value,
                      }))
                    }
                    placeholder="優惠券名稱"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="select select-bordered"
                      value={newCoupon.discountType}
                      onChange={(event) =>
                        setNewCoupon((current) => ({
                          ...current,
                          discountType: event.currentTarget.value as
                            | "amount"
                            | "percent",
                        }))
                      }
                    >
                      <option value="amount">折抵金額</option>
                      <option value="percent">百分比</option>
                    </select>
                    <input
                      className="input input-bordered"
                      type="number"
                      value={newCoupon.discountValue}
                      onChange={(event) =>
                        setNewCoupon((current) => ({
                          ...current,
                          discountValue: Number(event.currentTarget.value),
                        }))
                      }
                    />
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      void createAdminCoupon();
                    }}
                  >
                    新增 / 更新優惠券
                  </button>
                </div>
              </div>
              <div className="bg-base-100 rounded-lg shadow p-4">
                <ul className="space-y-2">
                  {coupons.map((coupon) => (
                    <li
                      key={coupon.code}
                      className="flex items-center justify-between border-b border-base-300 pb-2"
                    >
                      <span>
                        {coupon.code} - {coupon.name}
                      </span>
                      <span className="badge badge-accent">
                        {coupon.discountType === "percent"
                          ? `${coupon.discountValue}%`
                          : `$${coupon.discountValue}`}
                      </span>
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
          <a className="btn btn-ghost normal-case text-2xl">
            🍔 博翔早餐菜單
          </a>
        </div>
        <div className="flex-none w-full md:w-auto">
          <div className="flex flex-wrap gap-2 items-center md:justify-end">
            <div className="rounded-lg border border-base-300 bg-base-200 px-4 py-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
              <span>
                目前已做到：
                <strong>#{orderProgress.latestCompletedOrderId ?? "-"}</strong>
              </span>
              <span>
                等候人數：
                <strong>{orderProgress.waitingCount ?? 0}</strong>
              </span>
            </div>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                setCartView("items");
                setIsCartOpen(true);
              }}
              disabled={!user}
            >
              購物車明細
            </button>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                setIsHistoryOpen(true);
                void loadOrderHistory();
              }}
              disabled={!user}
            >
              歷史訂單
            </button>
            {user ? (
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setIsProfileOpen(true)}
              >
                個人
              </button>
            ) : null}
            {user ? (
              <button
                className="btn btn-sm"
                onClick={() => {
                  void handleLogout();
                }}
              >
                登出
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <main className="container mx-auto p-6">
        {!user ? (
          <section className="max-w-xl mx-auto card bg-base-100 shadow-md mb-8">
            <div className="card-body">
              <h2 className="card-title">使用 Google 帳號登入</h2>
              <p className="text-sm opacity-70">
                點擊下方按鈕，使用您的 Google 帳號登入後即可開始點餐。
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
                {isGoogleSigningIn ? "導向 Google 中..." : "使用 Google 登入"}
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
              <p className="font-semibold">餐點已完成，可以取餐</p>
              <p className="text-sm">
                取餐編號：#{completedNoticeOrder.dailySequence ?? completedNoticeOrder.id}
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
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(grouped.groupedItems[category] || []).map((item) => (
                  <div
                    key={item.id}
                    className="card bg-base-100 shadow-md hover:shadow-lg transition-shadow"
                  >
                    <figure className="h-44 overflow-hidden bg-base-300">
                      <img
                        src={item.imageUrl}
                        alt={item.name}
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
                        <h3 className="card-title text-lg">{item.name}</h3>
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
                            ${item.previousPrice} → ${item.price}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm opacity-80 line-clamp-2 min-h-[2.75rem]">
                        {item.description}
                      </p>
                      <div className="card-actions justify-between items-center">
                        <span className="text-xl font-bold text-success">
                          ${item.price}
                        </span>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            openAddToCart(item);
                          }}
                          disabled={activeItemId === item.id}
                        >
                          {activeItemId === item.id
                            ? "加入中..."
                            : `加入購物車${cartQtyByItemId[item.id] ? ` (${cartQtyByItemId[item.id]})` : ""}`}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

      </main>

      {user && isHistoryOpen ? (
        <>
          <button
            className="fixed inset-0 bg-black/35 z-20"
            aria-label="close order history"
            onClick={() => setIsHistoryOpen(false)}
          />
          <section className="fixed inset-0 z-30 bg-base-100 shadow-2xl flex flex-col">
            <div className="p-4 border-b border-base-300 flex items-center justify-between">
              <h2 className="text-xl font-bold">歷史訂單</h2>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setIsHistoryOpen(false)}
              >
                關閉
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto">
              {historyLoading ? (
                <div className="alert">
                  <span>讀取中...</span>
                </div>
              ) : historyOrders.length === 0 ? (
                <div className="alert alert-info">
                  <span>目前尚無歷史訂單。</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {historyOrders.map((order) => (
                    <article
                      key={order.id}
                      className="rounded-lg bg-base-200 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h3 className="font-semibold">
                          訂單 #{order.dailySequence ?? order.id}
                        </h3>
                        <span
                          className={`badge ${orderStatusBadgeClass(order.status)}`}
                        >
                          {orderStatusLabel(order.status)}
                        </span>
                      </div>
                      <div className="text-sm opacity-70 space-y-1">
                        <p>訂購人：{order.customerName || user.name}</p>
                        <p>電話：{order.customerPhone || "-"}</p>
                        <p>建立時間：{formatTaipeiDateTime(order.createdAt)}</p>
                        <p>下單時間：{formatTaipeiDateTime(order.submittedAt)}</p>
                        {order.completedAt ? (
                          <p>完成時間：{formatTaipeiDateTime(order.completedAt)}</p>
                        ) : null}
                      </div>
                      <ul className="text-sm list-disc pl-5 space-y-1">
                        {order.items.map((detail) => (
                          <li key={`${order.id}-${detail.menuItemId}-${detail.id ?? detail.menuItemName}`}>
                            {detail.menuItemName} x {detail.qty}
                            {detail.sugarLevel || detail.iceLevel ? (
                              <span className="opacity-60">
                                {" "}
                                ({detail.sugarLevel || "預設糖"} /{" "}
                                {detail.iceLevel || "預設冰"})
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-center justify-between font-semibold">
                        <span>{order.paymentMethod === "card" ? "刷卡" : "現金"}</span>
                        <span>總額 ${order.total}</span>
                      </div>
                      <button
                        className="btn btn-sm btn-outline w-full"
                        onClick={() => {
                          void buyAgain(order);
                        }}
                        disabled={activeItemId === `order-${order.id}`}
                      >
                        {activeItemId === `order-${order.id}` ? "加入中..." : "買一次"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}

      {user && isProfileOpen ? (
        <>
          <button
            className="fixed inset-0 bg-black/35 z-20"
            aria-label="close profile"
            onClick={() => setIsProfileOpen(false)}
          />
          <section className="fixed left-1/2 top-1/2 z-30 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-base-100 shadow-2xl">
            <div className="p-4 border-b border-base-300 flex items-center justify-between">
              <h2 className="text-xl font-bold">個人資料</h2>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setIsProfileOpen(false)}
              >
                關閉
              </button>
            </div>
            <div className="p-4 space-y-4">
              <input
                className="input input-bordered w-full"
                placeholder="暱稱"
                value={profile.nickname}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    nickname: event.currentTarget.value,
                  }))
                }
              />
              <input
                className="input input-bordered w-full"
                placeholder="電話"
                value={profile.phone}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    phone: event.currentTarget.value,
                  }))
                }
              />
              <select
                className="select select-bordered w-full"
                value={profile.language}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    language: event.currentTarget.value as UserProfile["language"],
                  }))
                }
              >
                <option value="zh-TW">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
              <p className="text-xs opacity-60">
                語言設定先儲存偏好；自動翻譯會在多語系模組接上。
              </p>
              <button
                className="btn btn-primary w-full"
                onClick={() => saveProfile(profile)}
              >
                儲存
              </button>
            </div>
          </section>
        </>
      ) : null}

      {customizingItem ? (
        <>
          <button
            className="fixed inset-0 bg-black/35 z-20"
            aria-label="close add-to-cart dialog"
            onClick={() => setCustomizingItem(null)}
          />
          <section className="fixed left-1/2 top-1/2 z-30 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-base-100 shadow-2xl">
            <div className="p-4 border-b border-base-300 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{customizingItem.name}</h2>
                <p className="text-sm opacity-70">${customizingItem.price}</p>
              </div>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setCustomizingItem(null)}
              >
                關閉
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">
                  <span className="label-text">數量</span>
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

              {isDrink(customizingItem) ? (
                <div className="space-y-3">
                  <div>
                    <span className="label-text mb-2 block">糖度</span>
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
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="label-text mb-2 block">冰塊</span>
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
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="form-control">
                <span className="label-text mb-1">備註</span>
                <textarea
                  className="textarea textarea-bordered"
                  placeholder="例如：不要醬、餐點分開裝、吐司烤焦一點"
                  value={cartDraft.note}
                  onChange={(event) =>
                    setCartDraft((current) => ({
                      ...current,
                      note: event.currentTarget.value,
                    }))
                  }
                />
              </label>

              <button
                className="btn btn-primary w-full"
                disabled={activeItemId === customizingItem.id}
                onClick={() => {
                  void addToCart(customizingItem, cartDraft);
                }}
              >
                {activeItemId === customizingItem.id
                  ? "加入中..."
                  : `加入購物車 $${customizingItem.price * cartDraft.qty}`}
              </button>
            </div>
          </section>
        </>
      ) : null}

      {user && isCartOpen ? (
        <>
          <button
            className="fixed inset-0 bg-black/35"
            aria-label="close cart drawer"
            onClick={() => {
              setIsCartOpen(false);
            }}
          />
          <aside className="fixed inset-0 bg-base-100 shadow-2xl z-10 flex flex-col">
            <div className="p-4 border-b border-base-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {cartView === "checkout" ? (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setCartView("items")}
                  >
                    返回
                  </button>
                ) : null}
                <h2 className="text-xl font-bold">
                  {cartView === "checkout" ? "結帳" : "購物車明細"}
                </h2>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setIsCartOpen(false)}>
                關閉
              </button>
            </div>

            <div className="p-4 flex-1 overflow-auto">
              {staleCartItems.length > 0 ? (
                <div className="alert alert-warning mb-4 items-start">
                  <div>
                    <p className="font-semibold">購物車有品項已更新</p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {staleCartItems.map((item) => (
                        <li key={item.menuItemId}>
                          {item.menuItemName} x {item.qty}：
                          ${item.menuItemPrice}
                          {typeof item.currentMenuItemPrice === "number"
                            ? ` → $${item.currentMenuItemPrice}`
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
                    <span>購物車目前是空的。</span>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {cartDetails.map((detail) => (
                      <li
                        key={detail.orderItemId ?? detail.itemId}
                        className="p-3 rounded-lg bg-base-200 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold">{detail.item.name}</p>
                            <p className="text-sm opacity-70">
                              單價 ${detail.item.price} x {detail.qty}
                            </p>
                          </div>
                          <p className="font-bold">${detail.subtotal}</p>
                        </div>
                        <div className="join">
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
                              void updateCartLineQty(detail, detail.qty + 1);
                            }}
                          >
                            +
                          </button>
                        </div>
                        {isDrink(detail.item) ? (
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              className="select select-sm select-bordered"
                              value={detail.orderItem?.sugarLevel ?? ""}
                              onChange={(event) => {
                                void updateCartItemOptions(
                                  detail.orderItemId,
                                  detail.itemId,
                                  { sugarLevel: event.currentTarget.value },
                                );
                              }}
                            >
                              <option value="">正常糖</option>
                              <option value="無糖">無糖</option>
                              <option value="微糖">微糖</option>
                              <option value="半糖">半糖</option>
                              <option value="少糖">少糖</option>
                              <option value="正常糖">正常糖</option>
                            </select>
                            <select
                              className="select select-sm select-bordered"
                              value={detail.orderItem?.iceLevel ?? ""}
                              onChange={(event) => {
                                void updateCartItemOptions(
                                  detail.orderItemId,
                                  detail.itemId,
                                  { iceLevel: event.currentTarget.value },
                                );
                              }}
                            >
                              <option value="">正常冰</option>
                              <option value="去冰">去冰</option>
                              <option value="微冰">微冰</option>
                              <option value="少冰">少冰</option>
                              <option value="正常冰">正常冰</option>
                              <option value="熱飲">熱飲</option>
                            </select>
                          </div>
                        ) : null}
                        <label className="form-control">
                          <input
                            className="input input-sm input-bordered"
                            placeholder="品項備註，例如：不要醬、吐司烤焦一點"
                            value={detail.orderItem?.note ?? ""}
                            onChange={(event) => {
                              void updateCartItemOptions(
                                detail.orderItemId,
                                detail.itemId,
                                { note: event.currentTarget.value },
                              );
                            }}
                          />
                        </label>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg bg-base-200 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span>總件數</span>
                      <span className="font-semibold">{cartItemCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-lg font-bold">
                      <span>總金額</span>
                      <span>${cartTotal}</span>
                    </div>
                  </div>
                  <input
                    className="input input-bordered w-full"
                    placeholder="暱稱，例如 小翔"
                    value={customerName}
                    onChange={(event) => setCustomerName(event.currentTarget.value)}
                  />
                  <input
                    className="input input-bordered w-full"
                    placeholder="電話號碼（必填），例如 0912345678"
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.currentTarget.value)}
                    required
                  />
                  <input
                    className="input input-bordered w-full"
                    placeholder="大概幾點拿，例如 08:30"
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
                      <span>現金</span>
                    </label>
                    <label className="label cursor-pointer justify-start gap-2 rounded-lg border border-base-300 p-3">
                      <input
                        type="radio"
                        className="radio radio-sm"
                        checked={paymentMethod === "card"}
                        onChange={() => setPaymentMethod("card")}
                      />
                      <span>刷卡</span>
                    </label>
                  </div>
                  <textarea
                    className="textarea textarea-bordered w-full"
                    placeholder="整張訂單備註，例如：餐點分開裝、到店再做"
                    value={orderNote}
                    onChange={(event) => setOrderNote(event.currentTarget.value)}
                  />
                  <input
                    className="input input-bordered w-full"
                    placeholder="優惠碼，例如 BREAKFAST10"
                    value={couponCode}
                    onChange={(event) =>
                      setCouponCode(event.currentTarget.value.toUpperCase())
                    }
                  />
                </div>
              )}
            </div>

            <div className="p-4 border-t border-base-300 space-y-3">
              <div className="flex items-center justify-between font-semibold">
                <span>總件數</span>
                <span>{cartItemCount}</span>
              </div>
              <div className="flex items-center justify-between text-lg font-bold">
                <span>總金額</span>
                <span>${cartTotal}</span>
              </div>
              {cartView === "items" ? (
                <>
                  <button
                    className="btn btn-error btn-outline w-full"
                    onClick={() => {
                      void clearCart();
                    }}
                    disabled={cartDetails.length === 0 || isClearingCart}
                  >
                    {isClearingCart ? "清空中..." : "清空購物車"}
                  </button>
                  <button
                    className="btn btn-primary w-full"
                    onClick={() => setCartView("checkout")}
                    disabled={cartDetails.length === 0}
                  >
                    結帳
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
                  {isSubmittingOrder ? "結帳中..." : "確認送出"}
                </button>
              )}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}

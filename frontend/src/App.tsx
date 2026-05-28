import { useEffect, useState, useMemo } from "react";
import "./App.css";
import type {
  ApiDataResponse,
  ActivePromotion,
  MenuItem,
  MenuItemVersionHistory,
  Order,
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
  const [cartQtyByItemId, setCartQtyByItemId] = useState<
    Record<string, number>
  >({});
  const [cartTotal, setCartTotal] = useState(0);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [staleCartItems, setStaleCartItems] = useState<StaleCartItem[]>([]);
  const [versionHistoryByLogicalId, setVersionHistoryByLogicalId] = useState<
    Record<string, MenuItemVersionHistory[]>
  >({});
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [priceSensitivity, setPriceSensitivity] = useState<
    PriceSensitivity[]
  >([]);
  const [activePromotions, setActivePromotions] = useState<ActivePromotion[]>(
    [],
  );
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isClearingCart, setIsClearingCart] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

  function syncCartFromOrder(order: Order) {
    const nextQtyByItemId = order.items.reduce(
      (acc, orderItem) => {
        acc[orderItem.menuItemId] = orderItem.qty;
        return acc;
      },
      {} as Record<string, number>,
    );

    setCartQtyByItemId(nextQtyByItemId);
    setCartTotal(order.total);
  }

  function resetCartState() {
    setOrderId(null);
    setCartQtyByItemId({});
    setCartTotal(0);
    setStaleCartItems([]);
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

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setHistoryOrders([]);
      setIsCartOpen(false);
      resetCartState();
      return;
    }

    void refreshUserOrders().catch((refreshError) => {
      setActionError("載入使用者訂單資料失敗，請稍後再試。");
      console.error(refreshError);
    });
  }, [user]);

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

    void loadAdminData();
  }, [isAdminPage, loading, items]);

  const cartItemCount = useMemo(
    () => Object.values(cartQtyByItemId).reduce((sum, qty) => sum + qty, 0),
    [cartQtyByItemId],
  );

  const cartDetails = useMemo(() => {
    const itemById = new Map(items.map((item) => [item.id, item]));

    return Object.entries(cartQtyByItemId)
      .map(([itemIdText, qty]) => {
        const itemId = itemIdText;
        const item = itemById.get(itemId);
        if (!item || qty <= 0) {
          return null;
        }

        return {
          itemId,
          qty,
          item,
          subtotal: item.price * qty,
        };
      })
      .filter((entry) => entry !== null);
  }, [cartQtyByItemId, items]);

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
      const [analyticsResponse, promotionsResponse] = await Promise.all([
        fetch(buildApiUrl("/api/menu/analytics/price-sensitivity"), {
          credentials: "include",
        }),
        fetch(buildApiUrl("/api/promotions/active"), {
          credentials: "include",
        }),
      ]);

      if (!analyticsResponse.ok || !promotionsResponse.ok) {
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

      setPriceSensitivity(
        Array.isArray(analyticsPayload?.data) ? analyticsPayload.data : [],
      );
      setActivePromotions(
        Array.isArray(promotionsPayload?.data) ? promotionsPayload.data : [],
      );

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

  async function addToCart(item: MenuItem): Promise<void> {
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
      const currentQty = cartQtyByItemId[item.id] ?? 0;
      const nextQty = currentQty + 1;

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
          const recoveredQty =
            recoveredOrder?.items.find(
              (orderItem) => orderItem.menuItemId === item.id,
            )?.qty ?? 0;
          const retryQty = recoveredQty + 1;

          const retriedOrder = await patchOrderItem(retryOrderId, retryQty);
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
    }
  }

  async function clearCart(): Promise<void> {
    if (!user || orderId === null || cartDetails.length === 0) {
      return;
    }

    setActionError("");
    setStaleCartItems([]);
    setIsClearingCart(true);

    try {
      for (const detail of cartDetails) {
        const response = await fetch(buildApiUrl(`/api/orders/${orderId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            itemId: detail.itemId,
            qty: 0,
          }),
        });

        if (!response.ok) {
          throw new Error(`Clear cart failed: HTTP ${response.status}`);
        }
      }

      setCartQtyByItemId({});
      setCartTotal(0);
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
    setIsSubmittingOrder(true);

    try {
      const response = await fetch(
        buildApiUrl(`/api/orders/${orderId}/submit`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
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
          await loadMenu();
          return;
        }

        throw new Error(`Submit order failed: HTTP ${response.status}`);
      }

      resetCartState();
      setIsCartOpen(false);
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
          </div>
        </div>

        <main className="container mx-auto p-6 space-y-6">
          {adminError ? (
            <div className="alert alert-warning">
              <span>{adminError}</span>
            </div>
          ) : null}

          <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">目前品項</div>
                <div className="stat-value text-primary">{items.length}</div>
              </div>
            </div>
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">分類數</div>
                <div className="stat-value text-secondary">
                  {grouped.categories.length}
                </div>
              </div>
            </div>
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">促銷中</div>
                <div className="stat-value text-accent">
                  {activePromotions.length}
                </div>
              </div>
            </div>
            <div className="stats shadow bg-base-100">
              <div className="stat">
                <div className="stat-title">分析資料</div>
                <div className="stat-value text-success">
                  {priceSensitivity.length}
                </div>
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
                        <td>${item.price}</td>
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
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200">
      <div className="navbar bg-base-100 shadow-lg flex-col items-stretch gap-2 md:flex-row md:items-center">
        <div className="flex-1 w-full md:w-auto">
          <a className="btn btn-ghost normal-case text-2xl">
            🌅 聯大資工早餐菜單
          </a>
        </div>
        <div className="flex-none w-full md:w-auto">
          <div className="flex flex-wrap gap-2 items-center md:justify-end">
            <div className="badge badge-outline">
              {user ? `已登入 ${user.name}` : "尚未登入"}
            </div>
            <div className="badge badge-primary">
              {items.length} 個品項・{grouped.categories.length} 類
            </div>
            <div className="badge badge-secondary">
              購物車 {cartItemCount} 件
            </div>
            <div className="badge badge-accent">總計 ${cartTotal}</div>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                setIsCartOpen(true);
              }}
              disabled={!user}
            >
              購物車明細
            </button>
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
                        {item.isRecentlyUpdated ? (
                          <span className="badge badge-info badge-sm">
                            最近更新
                          </span>
                        ) : null}
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
                            void addToCart(item);
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

        {user ? (
          <section className="mt-10">
            <h2 className="text-2xl font-bold mb-4">我的訂單歷史</h2>
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
                    className="card bg-base-100 shadow-sm border border-base-300"
                  >
                    <div className="card-body p-4">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h3 className="font-semibold">訂單 #{order.id}</h3>
                        <span className="badge badge-success">已送出</span>
                      </div>
                      <p className="text-sm opacity-70">
                        建立時間：{order.createdAt}
                      </p>
                      <ul className="text-sm list-disc pl-5 space-y-1">
                        {order.items.map((detail) => (
                          <li key={`${order.id}-${detail.menuItemId}`}>
                            {detail.menuItemName} x {detail.qty}
                          </li>
                        ))}
                      </ul>
                      <p className="font-bold text-right">
                        總額 ${order.total}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </main>

      {user && isCartOpen ? (
        <>
          <button
            className="fixed inset-0 bg-black/35"
            aria-label="close cart drawer"
            onClick={() => {
              setIsCartOpen(false);
            }}
          />
          <aside className="fixed right-0 top-0 h-full w-full max-w-md bg-base-100 shadow-2xl z-10 flex flex-col">
            <div className="p-4 border-b border-base-300 flex items-center justify-between">
              <h2 className="text-xl font-bold">購物車明細</h2>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setIsCartOpen(false);
                }}
              >
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
              {cartDetails.length === 0 ? (
                <div className="alert">
                  <span>購物車目前是空的。</span>
                </div>
              ) : (
                <ul className="space-y-3">
                  {cartDetails.map((detail) => (
                    <li
                      key={detail.itemId}
                      className="p-3 rounded-lg bg-base-200 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-semibold">{detail.item.name}</p>
                        <p className="text-sm opacity-70">
                          單價 ${detail.item.price} x {detail.qty}
                        </p>
                      </div>
                      <p className="font-bold">${detail.subtotal}</p>
                    </li>
                  ))}
                </ul>
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
                onClick={() => {
                  void submitOrder();
                }}
                disabled={cartDetails.length === 0 || isSubmittingOrder}
              >
                {isSubmittingOrder ? "送出中..." : "送出訂單"}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}

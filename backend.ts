import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { cors } from "@elysia/cors";
import { existsSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import toTaipeiDateTime from "./util.ts";
import {
  activePromotionListResponseSchema,
  activePromotionResponseSchema,
  addonSettingsResponseSchema,
  adminLoginBodySchema,
  adminLoginResponseSchema,
  apiErrorResponseSchema,
  couponListResponseSchema,
  couponParamsSchema,
  couponResponseSchema,
  createCouponBodySchema,
  createMenuItemBodySchema,
  createPromotionBodySchema,
  deleteMenuItemParamsSchema,
  employeeListResponseSchema,
  employeeResponseSchema,
  getOrderByIdParamsSchema,
  healthResponseSchema,
  menuItemResponseSchema,
  menuItemVersionHistoryListResponseSchema,
  menuListResponseSchema,
  nullableOrderResponseEnvelopeSchema,
  orderListResponseSchema,
  orderProgressResponseSchema,
  orderResponseEnvelopeSchema,
  priceSensitivityListResponseSchema,
  promotionParamsSchema,
  submitOrderParamsSchema,
  submitOrderBodySchema,
  toOrderResponse,
  upsertEmployeeBodySchema,
  updateMenuDisplayOrderBodySchema,
  updateAddonSettingsBodySchema,
  updateMenuItemBodySchema,
  updateMenuItemParamsSchema,
  updateOrderBodySchema,
  updateOrderParamsSchema,
  updateOrderReviewBodySchema,
  updateOrderReviewParamsSchema,
  updatePromotionBodySchema,
} from "./shared/route-schemas.ts";
import { createStore } from "./store/index.ts";
import type { MenuItem } from "./shared/contracts.ts";
import { auth, getCurrentUser } from "./auth/better-auth.ts";
import { menuRepository } from "./db/repositories/menuRepository.ts";
import { calculateOrderProgress } from "./order-progress.ts";

// 從環境變量獲取配置
const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "localhost";
const allowedOrigin = process.env.API_ALLOWED_ORIGIN || "*";
const isProduction =
  process.env.NODE_ENV === "production" || process.env.RENDER === "true";
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword =
  process.env.ADMIN_PASSWORD || (isProduction ? "" : "admin1234");
const devAdminBranchPasswords: Record<string, string> = isProduction
  ? {}
  : {
      taipei: "dev-taipei-password",
      tainan: "dev-tainan-password",
      kaohsiung: "dev-kaohsiung-password",
    };
const adminBranchPasswords = (process.env.ADMIN_BRANCH_PASSWORDS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .reduce<Record<string, string>>((mapping, entry) => {
    const [code, password] = entry.split(":").map((part) => part.trim());
    if (code && password) {
      mapping[code] = password;
    }
    return mapping;
  }, {});
if (Object.keys(adminBranchPasswords).length === 0) {
  Object.assign(adminBranchPasswords, devAdminBranchPasswords);
}
const adminSessionSecret =
  process.env.ADMIN_SESSION_SECRET ||
  (isProduction ? "" : "change-this-admin-session-secret");
const store = createStore({ dataFilePath: "./data/store.json" });
const hasPublicAssets =
  existsSync("./public") && existsSync("./public/index.html");
const deferredMenuImagePathPattern = /^\/api\/menu\/[^/]+\/image(?:\?.*)?$/;

if (isProduction && !adminSessionSecret) {
  throw new Error(
    "Production ADMIN_SESSION_SECRET is unsafe. Set ADMIN_SESSION_SECRET.",
  );
}
if (isProduction && !adminPassword) {
  throw new Error("Production ADMIN_PASSWORD is required.");
}
if (isProduction && Object.keys(adminBranchPasswords).length === 0) {
  throw new Error(
    "Production ADMIN_BRANCH_PASSWORDS is required. Example: taipei:<password>,tainan:<password>,kaohsiung:<password>",
  );
}

const defaultDevOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];
const allowedOrigins =
  allowedOrigin === "*"
    ? isProduction
      ? [process.env.BETTER_AUTH_URL].filter((origin): origin is string =>
          Boolean(origin),
        )
      : defaultDevOrigins
    : allowedOrigin
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
const adminLoginAttempts = new Map<
  string,
  { count: number; resetAt: number; blockedUntil: number }
>();

// ─── Auth Helper ──────────────────────────────────────────────────────────────
// 簡化的 helper 函數，用於保護路由並獲取 user，失敗時拋出 401 錯誤
async function requireUser(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}

function signAdminSession(sessionKey: string) {
  return createHmac("sha256", adminSessionSecret)
    .update(sessionKey)
    .digest("hex");
}

function isAdminSessionValue(session: string) {
  const validKeys = [
    adminUsername,
    ...Object.keys(adminBranchPasswords).map((code) => `branch:${code}`),
  ];

  return validKeys.some((sessionKey) => {
    const expected = signAdminSession(sessionKey);
    const sessionBuffer = Buffer.from(session);
    const expectedBuffer = Buffer.from(expected);
    return (
      sessionBuffer.length === expectedBuffer.length &&
      timingSafeEqual(sessionBuffer, expectedBuffer)
    );
  });
}

function isAdminRequest(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const session = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("admin_session="))
    ?.split("=")[1];
  if (!session) return false;

  return isAdminSessionValue(session);
}

function adminSessionBranch(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const session = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("admin_session="))
    ?.split("=")[1];
  if (!session) return null;

  // check branch codes
  for (const code of Object.keys(adminBranchPasswords)) {
    const expected = signAdminSession(`branch:${code}`);
    const sessionBuffer = Buffer.from(session);
    const expectedBuffer = Buffer.from(expected);
    if (
      sessionBuffer.length === expectedBuffer.length &&
      timingSafeEqual(sessionBuffer, expectedBuffer)
    ) {
      return code;
    }
  }

  // not a branch session
  return null;
}

function requireAdmin(request: Request) {
  if (isAdminRequest(request)) return;

  throw new Response(JSON.stringify({ error: "Admin unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function requireHeadquarter(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const session = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("admin_session="))
    ?.split("=")[1];
  if (!session) {
    throw new Response(JSON.stringify({ error: "Admin unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only the headquarter admin username is allowed to manage promotions/coupons
  const expected = signAdminSession(adminUsername);
  const sessionBuffer = Buffer.from(session);
  const expectedBuffer = Buffer.from(expected);
  const ok =
    sessionBuffer.length === expectedBuffer.length &&
    timingSafeEqual(sessionBuffer, expectedBuffer);
  if (ok) return;

  throw new Response(JSON.stringify({ error: "Headquarter admin required" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function canAdminAccessOrder(request: Request, order: { storeCode?: string }) {
  const branch = adminSessionBranch(request);
  if (!branch) return true;
  return (order.storeCode ?? "default") === branch;
}

function adminCookie(value: string, maxAge: number) {
  const secure = isProduction ? "; Secure" : "";
  return `admin_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function isDataImageUrl(value: string | undefined): value is string {
  return Boolean(value?.startsWith("data:image/"));
}

function menuImageUrl(item: MenuItem): string {
  if (!isDataImageUrl(item.imageUrl)) return item.imageUrl;
  return `/api/menu/${encodeURIComponent(item.id)}/image?v=${item.version}`;
}

function toCompactMenuItem(item: MenuItem): MenuItem {
  const imageUrl = menuImageUrl(item);
  return imageUrl === item.imageUrl ? item : { ...item, imageUrl };
}

function toCompactMenuItems(items: ReadonlyArray<MenuItem>): MenuItem[] {
  return items.map(toCompactMenuItem);
}

function isDeferredMenuImageUrl(value: string | undefined): boolean {
  return Boolean(value && deferredMenuImagePathPattern.test(value));
}

function dataImageResponse(imageUrl: string): Response | null {
  const match = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;

  const [, contentType, base64] = match;
  return new Response(Buffer.from(base64, "base64"), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": contentType,
    },
  });
}

function clientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function checkAdminLoginRateLimit(request: Request) {
  const ip = clientIp(request);
  const now = Date.now();
  const current = adminLoginAttempts.get(ip);
  if (current?.blockedUntil && current.blockedUntil > now) {
    throw new Response(JSON.stringify({ error: "Too many login attempts" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!current || current.resetAt <= now) {
    adminLoginAttempts.set(ip, {
      count: 0,
      resetAt: now + 10 * 60 * 1000,
      blockedUntil: 0,
    });
  }
}

function recordAdminLoginFailure(request: Request) {
  const ip = clientIp(request);
  const now = Date.now();
  const current = adminLoginAttempts.get(ip) ?? {
    count: 0,
    resetAt: now + 10 * 60 * 1000,
    blockedUntil: 0,
  };
  const count = current.count + 1;
  adminLoginAttempts.set(ip, {
    count,
    resetAt: current.resetAt,
    blockedUntil: count >= 5 ? now + 10 * 60 * 1000 : 0,
  });
}

function clearAdminLoginFailures(request: Request) {
  adminLoginAttempts.delete(clientIp(request));
}

const app = new Elysia();

// ─── CORS Plugin ──────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: ({ headers }) => {
      const origin = headers.get("origin");
      if (!origin) return true;
      return allowedOrigins.includes(origin);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.onAfterHandle(({ set }) => {
  set.headers["X-Content-Type-Options"] = "nosniff";
  set.headers["X-Frame-Options"] = "DENY";
  set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
  set.headers["Permissions-Policy"] =
    "camera=(), microphone=(), geolocation=()";
  set.headers["Content-Security-Policy"] =
    "default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
  if (isProduction) {
    set.headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }
});

// ─── Better Auth Routes ───────────────────────────────────────────────────────
// ⚠️ 注意：不能使用 app.mount("/api/auth", auth.handler)
// 原因：Better Auth handler 是標準的 fetch handler function，
//       但 Elysia 的 .mount() 期望的是 Elysia instance 或特定格式的 handler。
//       測試結果：.mount() 會導致 404 錯誤。
//
// ✅ 正確做法：使用 wildcard 路由明確處理 GET 和 POST
// 必須在其他 API 路由之前定義，確保 Better Auth 路由優先匹配
app.get("/api/auth/*", ({ request }) => auth.handler(request));
app.post("/api/auth/*", ({ request }) => auth.handler(request));

// ─── OpenAPI Plugin ───────────────────────────────────────────────────────────
app.use(
  openapi({
    path: "/openapi",
    specPath: "/openapi/json",
    documentation: {
      info: {
        title: "Breakfast Demo API",
        version: "0.2.3",
        description:
          "Breakfast ordering demo API for teaching route schema, contract-first design, and future database/auth upgrades. V9-clean-better-auth-v3: optimized static handling, CORS plugin, and Better Auth macro integration.",
      },
      tags: [
        { name: "auth", description: "Authentication endpoints" },
        { name: "menu", description: "Menu management endpoints" },
        { name: "orders", description: "Order query and mutation endpoints" },
        { name: "system", description: "System and health check endpoints" },
      ],
    },
    exclude: {
      staticFile: true,
      paths: ["/openapi", "/openapi/json"],
    },
  }),
);

// 請求記錄中間件
// ─── Request Logger ───────────────────────────────────────────────────────────
app.onRequest(({ request }) => {
  console.log(
    `[${toTaipeiDateTime(new Date().toISOString())}] ${request.method} ${new URL(request.url).pathname}`,
  );
});

// API 路由

// ─── Sign-out Proxy ───────────────────────────────────────────────────────────
// Better Auth 的 /api/auth/sign-out 有 CSRF origin 驗證（比對 trustedOrigins）。
// production 環境若 BETTER_AUTH_URL 設定錯誤（如仍是 localhost），
// 瀏覽器送出的 Origin（正式網址）不在白名單，導致 sign-out 回 403 但前端不知道，
// 造成「看似登出，實際 session 仍在」的假登出。
//
// 解法：在 Elysia 層加一個 proxy，以 server 信任的 baseURL 當 Origin 轉發給 Better Auth。
// 安全性：session 識別仍靠 cookie，CSRF bypass 只在 server 端發生，不降低安全性。
app.post("/api/sign-out", async ({ request }) => {
  const baBaseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

  // 複製原始 headers，強制覆寫 origin 為 Better Auth 信任的 baseURL
  const proxiedHeaders = new Headers(request.headers);
  proxiedHeaders.set("origin", baBaseUrl);

  const proxiedRequest = new Request(`${baBaseUrl}/api/auth/sign-out`, {
    method: "POST",
    headers: proxiedHeaders,
  });

  const res = await auth.handler(proxiedRequest);
  if (!res.ok) {
    const body = await res
      .clone()
      .text()
      .catch(() => "(unreadable)");
    console.error(`[sign-out proxy] Better Auth returned ${res.status}:`, body);
  }
  return res;
});

app.post(
  "/api/admin/login",
  ({ body, request }) => {
    checkAdminLoginRateLimit(request);

    let sessionKey: string | null = null;
    const storeCode = body.storeCode?.trim();

    if (storeCode) {
      const branchPassword = adminBranchPasswords[storeCode];
      if (!branchPassword || body.password !== branchPassword) {
        recordAdminLoginFailure(request);
        throw new Response(JSON.stringify({ error: "Invalid admin login" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      sessionKey = `branch:${storeCode}`;
    } else if (
      body.username === adminUsername &&
      body.password === adminPassword
    ) {
      sessionKey = adminUsername;
    }

    if (!sessionKey) {
      recordAdminLoginFailure(request);
      throw new Response(JSON.stringify({ error: "Invalid admin login" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    clearAdminLoginFailures(request);
    return new Response(JSON.stringify({ data: { username: sessionKey } }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": adminCookie(signAdminSession(sessionKey), 86400),
      },
    });
  },
  {
    body: adminLoginBodySchema,
    response: {
      200: adminLoginResponseSchema,
      401: apiErrorResponseSchema,
      429: apiErrorResponseSchema,
    },
  },
);

app.post("/api/admin/logout", () => {
  return new Response(JSON.stringify({ data: { ok: true } }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": adminCookie("", 0),
    },
  });
});

app.get("/api/admin/session", ({ request }) => {
  requireAdmin(request);
  return { data: { username: adminUsername } };
});

// 菜單路由
app.get("/api/menu", () => ({ data: toCompactMenuItems(store.getMenu()) }), {
  detail: {
    tags: ["menu"],
    summary: "List menu items",
    description: "Return all available breakfast menu items.",
  },
  response: {
    200: menuListResponseSchema,
  },
});

app.get("/api/menu/:id/image", ({ params, set }) => {
  const menuItem = store
    .getMenu()
    .find((item) => item.id === params.id || item.logicalId === params.id);
  if (!menuItem || !isDataImageUrl(menuItem.imageUrl)) {
    set.status = 404;
    return { error: "Menu image not found" };
  }

  const response = dataImageResponse(menuItem.imageUrl);
  if (!response) {
    set.status = 404;
    return { error: "Menu image not found" };
  }

  return response;
});

app.get("/api/addons", () => ({ data: store.getAddonSettings() }), {
  response: {
    200: addonSettingsResponseSchema,
  },
});

app.patch(
  "/api/addons",
  async ({ body, request }) => {
    requireHeadquarter(request);
    return { data: await store.updateAddonSettings(body) };
  },
  {
    body: updateAddonSettingsBodySchema,
    response: {
      200: addonSettingsResponseSchema,
    },
  },
);

app.post(
  "/api/menu",
  async ({ body, request, set }) => {
    requireAdmin(request);
    const newMenuItem = await store.createMenuItem(body);
    set.status = 201;
    return { data: toCompactMenuItem(newMenuItem) };
  },
  {
    body: createMenuItemBodySchema,
    detail: {
      tags: ["menu"],
      summary: "Create a menu item",
      description: "Add a new menu item into the breakfast menu.",
    },
    response: {
      201: menuItemResponseSchema,
    },
  },
);

app.patch(
  "/api/menu/display-order",
  async ({ body, request }) => {
    requireAdmin(request);
    await menuRepository.updateDisplayOrder(body.items);
    return { data: toCompactMenuItems(await menuRepository.getCurrentMenu()) };
  },
  {
    body: updateMenuDisplayOrderBodySchema,
    detail: {
      tags: ["menu"],
      summary: "Update menu display order",
      description: "Reorder current menu items by logical id.",
    },
    response: {
      200: menuListResponseSchema,
    },
  },
);

app.patch(
  "/api/menu/:id",
  async ({ params, body, request, set }) => {
    requireAdmin(request);
    const patch =
      isDeferredMenuImageUrl(body.changes.imageUrl)
        ? {
            ...body,
            changes: { ...body.changes, imageUrl: undefined },
          }
        : body;
    const menuItem = await store.updateMenuItem(params.id, patch);

    if (!menuItem) {
      set.status = 404;
      return { error: "Menu item not found" };
    }

    return { data: toCompactMenuItem(menuItem) };
  },
  {
    params: updateMenuItemParamsSchema,
    body: updateMenuItemBodySchema,
    detail: {
      tags: ["menu"],
      summary: "Update a menu item",
      description: "Update fields of an existing menu item.",
    },
    response: {
      200: menuItemResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/menu/analytics/price-sensitivity",
  async ({ request }) => {
    requireAdmin(request);
    return { data: await menuRepository.getPriceSensitivity() };
  },
  {
    detail: {
      tags: ["menu"],
      summary: "Price sensitivity analytics",
      description:
        "Return submitted-order quantity and revenue grouped by menu version and price.",
    },
    response: {
      200: priceSensitivityListResponseSchema,
    },
  },
);

app.get(
  "/api/promotions/active",
  async () => ({ data: await menuRepository.getActivePromotions() }),
  {
    detail: {
      tags: ["menu"],
      summary: "List active promotions",
      description: "Return promotions that are currently active.",
    },
    response: {
      200: activePromotionListResponseSchema,
    },
  },
);

app.get(
  "/api/promotions",
  async ({ request }) => {
    requireHeadquarter(request);
    return { data: await menuRepository.getPromotions() };
  },
  {
    response: {
      200: activePromotionListResponseSchema,
    },
  },
);

app.post(
  "/api/promotions",
  async ({ body, request, set }) => {
    requireHeadquarter(request);
    const promotion = await menuRepository.createPromotion(body);
    set.status = 201;
    return { data: promotion };
  },
  {
    body: createPromotionBodySchema,
    response: {
      201: activePromotionResponseSchema,
    },
  },
);

app.patch(
  "/api/promotions/:id",
  async ({ params, body, request, set }) => {
    requireHeadquarter(request);
    const promotion = await menuRepository.updatePromotion(
      Number.parseInt(params.id, 10),
      body,
    );
    if (!promotion) {
      set.status = 404;
      return { error: "Promotion not found" };
    }
    return { data: promotion };
  },
  {
    params: promotionParamsSchema,
    body: updatePromotionBodySchema,
    response: {
      200: activePromotionResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.delete(
  "/api/promotions/:id",
  async ({ params, request, set }) => {
    requireHeadquarter(request);
    const promotion = await menuRepository.deletePromotion(
      Number.parseInt(params.id, 10),
    );
    if (!promotion) {
      set.status = 404;
      return { error: "Promotion not found" };
    }
    return { data: promotion };
  },
  {
    params: promotionParamsSchema,
    response: {
      200: activePromotionResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.get("/api/coupons", () => ({ data: [...store.getCoupons()] }), {
  response: {
    200: couponListResponseSchema,
  },
});

app.post(
  "/api/coupons",
  async ({ body, request }) => {
    requireHeadquarter(request);
    const coupon = await store.createCoupon({
      code: body.code,
      name: body.name,
      discountType: body.discountType,
      discountValue: body.discountValue,
      minSpend: body.minSpend,
      maxDiscount: body.maxDiscount,
      usageLimitPerUser: body.usageLimitPerUser,
      usageLimitTotal: body.usageLimitTotal,
      applicableStoreCodes: body.applicableStoreCodes,
      startsAt: body.startsAt,
      expiresAt: body.expiresAt,
      isActive: body.isActive,
    });
    return { data: coupon };
  },
  {
    body: createCouponBodySchema,
    response: {
      200: couponResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

app.delete(
  "/api/coupons/:code",
  async ({ params, request, set }) => {
    requireHeadquarter(request);
    const coupon = await store.deleteCoupon(params.code);
    if (!coupon) {
      set.status = 404;
      return { error: "Coupon not found" };
    }

    return { data: coupon };
  },
  {
    params: couponParamsSchema,
    response: {
      200: couponResponseSchema,
      401: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/employees",
  ({ request }) => {
    requireAdmin(request);
    const branch = adminSessionBranch(request);
    const requestedStoreCode = new URL(request.url).searchParams
      .get("storeCode")
      ?.trim();
    const storeCode = branch ?? requestedStoreCode;
    const employees = storeCode
      ? store
          .getEmployees()
          .filter((employee) => employee.storeCode === storeCode)
      : store.getEmployees();
    return { data: employees };
  },
  {
    response: {
      200: employeeListResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

app.post(
  "/api/employees",
  async ({ body, request }) => {
    requireHeadquarter(request);
    const employee = await store.upsertEmployee(body);
    return { data: employee };
  },
  {
    body: upsertEmployeeBodySchema,
    response: {
      200: employeeResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/menu/:id/history",
  async ({ params }) => {
    const history = await menuRepository.getMenuVersionHistory(params.id);
    return { data: history };
  },
  {
    params: updateMenuItemParamsSchema,
    detail: {
      tags: ["menu"],
      summary: "List menu item version history",
      description: "Return version history for a logical menu item id.",
    },
    response: {
      200: menuItemVersionHistoryListResponseSchema,
    },
  },
);

app.delete(
  "/api/menu/:id",
  async ({ params, request, set }) => {
    requireAdmin(request);
    const removedMenuItem = await store.deleteMenuItem(params.id);

    if (!removedMenuItem) {
      set.status = 404;
      return { error: "Menu item not found" };
    }

    return { data: toCompactMenuItem(removedMenuItem) };
  },
  {
    params: deleteMenuItemParamsSchema,
    detail: {
      tags: ["menu"],
      summary: "Delete a menu item",
      description: "Remove a menu item by id.",
    },
    response: {
      200: menuItemResponseSchema,
      401: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

// 訂單列表路由
app.get(
  "/api/orders",
  ({ request }) => {
    requireAdmin(request);
    const selectedStoreCode = new URL(request.url).searchParams
      .get("storeCode")
      ?.trim();
    const branch = adminSessionBranch(request) ?? selectedStoreCode;
    const orders = store.getOrders().filter((o) => {
      if (!branch) return true;
      return (o.storeCode ?? "default") === branch;
    });
    return { data: orders.map(toOrderResponse) };
  },
  {
    detail: {
      tags: ["orders"],
      summary: "List all orders",
      description: "Return all orders stored in the demo backend.",
    },
    response: {
      200: orderListResponseSchema,
    },
  },
);

// 取得使用者目前進行中的訂單
app.get(
  "/api/orders/current",
  async ({ request }) => {
    const user = await requireUser(request);
    const storeCode = new URL(request.url).searchParams
      .get("storeCode")
      ?.trim();
    const currentOrder = store.getCurrentOrderByUserId(
      user.id,
      storeCode || undefined,
    );
    return { data: currentOrder ? toOrderResponse(currentOrder) : null };
  },
  {
    detail: {
      tags: ["orders"],
      summary: "Get current order",
      description:
        "Return the current pending order of a user, or null if none exists.",
    },
    response: {
      200: nullableOrderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
    },
  },
);

// 取得使用者歷史訂單
app.get(
  "/api/orders/history",
  async ({ request }) => {
    const user = await requireUser(request);
    return {
      data: store.getOrderHistoryByUserId(user.id).map(toOrderResponse),
    };
  },
  {
    detail: {
      tags: ["orders"],
      summary: "Get order history",
      description: "Return submitted orders belonging to a user.",
    },
    response: {
      200: orderListResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

// 創建新訂單
app.post(
  "/api/orders",
  async ({ body, request, set }) => {
    const user = await requireUser(request);
    const requestedStoreCode = (body as any)?.storeCode?.trim();
    const existingOrder = store.getCurrentOrderByUserId(
      user.id,
      requestedStoreCode || undefined,
    );
    if (existingOrder) {
      return { data: toOrderResponse(existingOrder) };
    }

    const newOrder = await store.createOrder({
      userId: user.id,
      storeCode: requestedStoreCode,
    });
    set.status = 201;
    return { data: toOrderResponse(newOrder) };
  },
  {
    detail: {
      tags: ["orders"],
      summary: "Create or reuse current order",
      description:
        "Create a new pending order, or return the existing pending order for the user.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      201: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/orders/progress",
  ({ request }) => {
    const requestedStoreCode = new URL(request.url).searchParams
      .get("storeCode")
      ?.trim();
    const branch = requestedStoreCode || adminSessionBranch(request);

    return {
      data: calculateOrderProgress(store.getOrders(), { storeCode: branch }),
    };
  },
  {
    detail: {
      tags: ["orders"],
      summary: "Get order progress",
      description:
        "Return today's ready-for-pickup and in-progress pickup numbers.",
    },
    response: {
      200: orderProgressResponseSchema,
    },
  },
);

app.patch(
  "/api/orders/:id/complete",
  async ({ params, request, set }) => {
    requireAdmin(request);
    const orderId = parseInt(params.id, 10);
    const existingOrder = store.getOrderById(orderId);
    if (!existingOrder) {
      set.status = 404;
      return { error: "Order not found or cannot be completed" };
    }
    if (!canAdminAccessOrder(request, existingOrder)) {
      set.status = 403;
      return { error: "Forbidden" };
    }
    const order = await store.completeOrder(orderId);

    if (!order) {
      set.status = 404;
      return { error: "Order not found or cannot be completed" };
    }

    return { data: toOrderResponse(order) };
  },
  {
    params: updateOrderParamsSchema,
    detail: {
      tags: ["orders"],
      summary: "Complete order",
      description: "Mark a submitted order as completed from POS admin.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.patch(
  "/api/orders/:id/reopen",
  async ({ params, request, set }) => {
    requireAdmin(request);
    const orderId = parseInt(params.id, 10);
    const existingOrder = store.getOrderById(orderId);
    if (!existingOrder) {
      set.status = 404;
      return { error: "Order not found or cannot be reopened" };
    }
    if (!canAdminAccessOrder(request, existingOrder)) {
      set.status = 403;
      return { error: "Forbidden" };
    }
    const order = await store.reopenOrder(orderId);

    if (!order) {
      set.status = 404;
      return { error: "Order not found or cannot be reopened" };
    }

    return { data: toOrderResponse(order) };
  },
  {
    params: updateOrderParamsSchema,
    detail: {
      tags: ["orders"],
      summary: "Reopen order",
      description: "Move a completed order back to submitted for rework.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.patch(
  "/api/orders/:id/pick-up",
  async ({ params, request, set }) => {
    requireAdmin(request);

    const orderId = parseInt(params.id, 10);
    const order = store.getOrderById(orderId);

    if (!order) {
      set.status = 404;
      return { error: "Order not found or cannot be picked up" };
    }
    if (!canAdminAccessOrder(request, order)) {
      set.status = 403;
      return { error: "Forbidden" };
    }

    const pickedUpOrder = await store.pickUpOrder(orderId);

    if (!pickedUpOrder) {
      set.status = 404;
      return { error: "Order not found or cannot be picked up" };
    }

    return { data: toOrderResponse(pickedUpOrder) };
  },
  {
    params: updateOrderParamsSchema,
    detail: {
      tags: ["orders"],
      summary: "Pick up order",
      description:
        "Archive a completed order after an admin marks it picked up.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

// 獲取單筆訂單
app.get(
  "/api/orders/:id",
  async ({ params, request, set }) => {
    const user = await requireUser(request);
    const orderId = parseInt(params.id, 10);
    const order = store.getOrderById(orderId);

    if (!order) {
      set.status = 404;
      return { error: "Order not found" };
    }

    if (order.userId !== user.id) {
      set.status = 403;
      return { error: "Forbidden" };
    }

    return { data: toOrderResponse(order) };
  },
  {
    params: getOrderByIdParamsSchema,
    detail: {
      tags: ["orders"],
      summary: "Get order by id",
      description:
        "Return a single order when it belongs to the requested user.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

// 新增或更新歷史訂單顧客評價
app.patch(
  "/api/orders/:id/review",
  async ({ params, body, request, set }) => {
    const user = await requireUser(request);
    const orderId = parseInt(params.id, 10);
    const order = await store.updateOrderReview(orderId, {
      userId: user.id,
      rating: body.rating,
      review: body.review,
    });

    if (!order) {
      set.status = 404;
      return { error: "Order not found or not reviewable" };
    }

    return { data: toOrderResponse(order) };
  },
  {
    params: updateOrderReviewParamsSchema,
    body: updateOrderReviewBodySchema,
    detail: {
      tags: ["orders"],
      summary: "Review an order",
      description:
        "Create or update the customer's rating and review for a submitted order.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

// 更新訂單項目
app.patch(
  "/api/orders/:id",
  async ({ params, body, request, set }) => {
    const user = await requireUser(request);
    const orderId = parseInt(params.id);
    const result = await store.updateOrderItem(orderId, {
      userId: user.id,
      orderItemId: body.orderItemId,
      itemId: body.itemId,
      qty: body.qty,
      size: body.size,
      eggQty: body.eggQty,
      cheeseQty: body.cheeseQty,
      addons: body.addons,
      sugarLevel: body.sugarLevel,
      iceLevel: body.iceLevel,
      note: body.note,
      forceNew: body.forceNew,
    });

    if (!result.ok && result.code === "ORDER_NOT_FOUND") {
      set.status = 404;
      return { error: "Order not found" };
    }

    if (!result.ok && result.code === "MENU_ITEM_NOT_FOUND") {
      set.status = 404;
      return { error: "Menu item not found" };
    }

    if (!result.ok && result.code === "ORDER_NOT_OWNED") {
      set.status = 403;
      return { error: "Forbidden" };
    }

    if (!result.ok && result.code === "ORDER_NOT_EDITABLE") {
      set.status = 409;
      return { error: "Order is not editable" };
    }

    if (!result.ok) {
      set.status = 500;
      return { error: "Unexpected store state" };
    }

    return { data: toOrderResponse(result.order) };
  },
  {
    params: updateOrderParamsSchema,
    body: updateOrderBodySchema,
    detail: {
      tags: ["orders"],
      summary: "Update order item quantity",
      description: "Set the quantity of a menu item within a pending order.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
      409: apiErrorResponseSchema,
      500: apiErrorResponseSchema,
    },
  },
);

// 清空購物車
app.delete(
  "/api/orders/:id/items",
  async ({ params, request, set }) => {
    const user = await requireUser(request);
    const orderId = parseInt(params.id, 10);
    const result = await store.clearOrderItems(orderId, {
      userId: user.id,
    });

    if (!result.ok && result.code === "ORDER_NOT_FOUND") {
      set.status = 404;
      return { error: "Order not found" };
    }

    if (!result.ok && result.code === "ORDER_NOT_OWNED") {
      set.status = 403;
      return { error: "Forbidden" };
    }

    if (!result.ok && result.code === "ORDER_NOT_EDITABLE") {
      set.status = 409;
      return { error: "Order is not editable" };
    }

    if (!result.ok) {
      set.status = 500;
      return { error: "Unexpected store state" };
    }

    return { data: toOrderResponse(result.order) };
  },
  {
    params: updateOrderParamsSchema,
    detail: {
      tags: ["orders"],
      summary: "Clear all items in a pending order",
      description:
        "Remove every line item from the current user's pending order.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
      409: apiErrorResponseSchema,
      500: apiErrorResponseSchema,
    },
  },
);

// 送出訂單
app.post(
  "/api/orders/:id/submit",
  async ({ params, body, request, set }) => {
    const user = await requireUser(request);
    const orderId = parseInt(params.id, 10);
    const result = await store.submitOrder(orderId, {
      userId: user.id,
      paymentMethod: body.paymentMethod,
      note: body.note,
      couponCode: body.couponCode,
      storeCode: body.storeCode,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      pickupTime: body.pickupTime,
    });

    if (!result.ok && result.code === "ORDER_NOT_FOUND") {
      set.status = 404;
      return { error: "Order not found" };
    }

    if (!result.ok && result.code === "ORDER_NOT_OWNED") {
      set.status = 403;
      return { error: "Forbidden" };
    }

    if (!result.ok && result.code === "ORDER_NOT_EDITABLE") {
      set.status = 409;
      return { error: "Order already submitted" };
    }

    if (!result.ok && result.code === "EMPTY_ORDER") {
      set.status = 400;
      return { error: "Empty order cannot be submitted" };
    }

    if (!result.ok && result.code === "COUPON_NOT_AVAILABLE") {
      set.status = 400;
      return {
        error: "Coupon not available",
        message: "優惠券不符合使用條件、已過期或已達使用次數。",
      };
    }

    if (!result.ok && result.code === "MENU_VERSION_STALE") {
      set.status = 409;
      return {
        error: "Menu item version is stale",
        message: "購物車中有品項已更新，請重新確認菜單後再送出。",
        staleItems: result.staleItems ?? [],
      };
    }

    if (!result.ok) {
      set.status = 500;
      return { error: "Unexpected store state" };
    }

    return { data: toOrderResponse(result.order) };
  },
  {
    params: submitOrderParamsSchema,
    body: submitOrderBodySchema,
    detail: {
      tags: ["orders"],
      summary: "Submit order",
      description: "Submit a pending order that belongs to the user.",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      400: apiErrorResponseSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
      409: apiErrorResponseSchema,
      500: apiErrorResponseSchema,
    },
  },
);

// 健康檢查路由
app.get("/health", () => ({ status: "ok" }), {
  detail: {
    tags: ["system"],
    summary: "Health check",
    description: "Return API health status.",
  },
  response: {
    200: healthResponseSchema,
  },
});

// ─── Manual Static File & SPA Fallback ────────────────────────────────────────
// 完全手動處理靜態檔案和 SPA fallback，避免 staticPlugin 的路由衝突問題
if (hasPublicAssets) {
  app.get("*", async ({ request }) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);

    // API 路徑返回 404
    if (
      pathname.startsWith("/api/") ||
      pathname.startsWith("/openapi") ||
      pathname.includes("..")
    ) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 嘗試回傳對應的靜態檔案
    const staticFile = Bun.file(`./public${pathname}`);
    if (pathname !== "/" && (await staticFile.exists())) {
      return staticFile;
    }

    // SPA fallback: 回傳 index.html
    return Bun.file("./public/index.html");
  });
}

// 全域錯誤處理
app.onError(({ error, set, code }) => {
  if (code === "VALIDATION") {
    set.status = 400;
    return {
      error: "Validation failed",
      message: "Please check your request parameters",
    };
  }

  set.status = 500;
  return { error: "Internal server error" };
});

// 啟動服務器
await store.init();

app.listen(port, () => {
  console.log(`🍳 早餐店 API 運行在 http://${host}:${port}`);
  console.log(`🌐 Web App: http://${host}:${port}`);
  console.log(`📋 菜單 API: http://${host}:${port}/api/menu`);
  console.log(`📦 訂單 API: http://${host}:${port}/api/orders`);
  console.log(`💚 健康檢查: http://${host}:${port}/health`);
  console.log(`🔐 CORS Origin: ${allowedOrigin}`);
  if (!hasPublicAssets) {
    console.log(
      "⚠️ public/ 不存在，目前只提供 API。若要提供前端頁面，先執行 bun run build:frontend",
    );
  }
});

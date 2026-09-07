import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.93.2";
import {
  authenticateExternalApiRequest,
  createRequestHash,
  type ExternalApiCredential,
  ExternalApiRequestError,
  type ExternalApiScope,
  parseBoolean,
  parseBoundedInteger,
  parseDeliveredItems,
  parseExternalApiCredentials,
  requireIdempotencyKey,
  requireUuid,
  sha256,
} from "../_shared/external-api-security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXTERNAL_API_ENABLED = Deno.env.get("EXTERNAL_API_ENABLED") === "true";
const MAX_BODY_BYTES = 64 * 1024;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const allowedOrigins = new Set(
  (Deno.env.get("EXTERNAL_API_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const supabaseAdmin: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

let credentialsCache: ExternalApiCredential[] | undefined;

interface ApiResult {
  body: Record<string, unknown>;
  status: number;
}

interface RequestContext {
  credential: ExternalApiCredential;
  requestId: string;
}

interface ActionDefinition {
  methods: ReadonlySet<string>;
  scope: ExternalApiScope;
  mutates: boolean;
  handler: (
    payload: Record<string, unknown>,
    context: RequestContext,
  ) => Promise<unknown>;
}

function getCredentials(): ExternalApiCredential[] {
  credentialsCache ??= parseExternalApiCredentials(
    Deno.env.get("EXTERNAL_API_CREDENTIALS"),
  );
  return credentialsCache;
}

function requestIdFrom(headers: Headers): string {
  const supplied = headers.get("X-Request-ID");
  return supplied && /^[A-Za-z0-9._-]{1,64}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

function responseHeaders(
  req: Request,
  requestId: string,
  additional: Record<string, string> = {},
): Headers {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-ID": requestId,
    Vary: "Origin",
    ...additional,
  });
  const origin = req.headers.get("Origin");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, content-type, idempotency-key, x-api-key, x-request-id",
    );
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function json(
  req: Request,
  requestId: string,
  result: ApiResult,
  additionalHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: responseHeaders(req, requestId, additionalHeaders),
  });
}

async function parsePayload(req: Request): Promise<Record<string, unknown>> {
  const url = new URL(req.url);
  if (req.method === "GET") {
    return Object.fromEntries(url.searchParams.entries());
  }

  if (req.method !== "POST") {
    throw new ExternalApiRequestError(
      405,
      "method_not_allowed",
      "Method not allowed",
    );
  }
  if (!req.headers.get("Content-Type")?.includes("application/json")) {
    throw new ExternalApiRequestError(
      415,
      "unsupported_media_type",
      "Content-Type must be application/json",
    );
  }

  const declaredLength = Number(req.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ExternalApiRequestError(
      413,
      "payload_too_large",
      "Request body is too large",
    );
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    throw new ExternalApiRequestError(
      413,
      "payload_too_large",
      "Request body is too large",
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ExternalApiRequestError(400, "invalid_json", "Invalid JSON body");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ExternalApiRequestError(
      400,
      "invalid_payload",
      "JSON body must be an object",
    );
  }
  return payload as Record<string, unknown>;
}

function requireDate(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw new ExternalApiRequestError(
      400,
      `invalid_${field}`,
      `${field} must use YYYY-MM-DD`,
    );
  }
  return value;
}

function optionalOrderStatus(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !["open", "locked", "cancelled", "delivered"].includes(value)
  ) {
    throw new ExternalApiRequestError(
      400,
      "invalid_status",
      "Invalid order status",
    );
  }
  return value;
}

function ensureDatabaseSuccess(error: unknown): void {
  if (error) throw new Error("database_operation_failed");
}

const actions: Record<string, ActionDefinition> = {
  "billing.status": {
    methods: new Set(["POST"]), scope: "billing:write", mutates: false,
    handler: async () => {
      const {data,error}=await supabaseAdmin.from("billing_control").select("sync_enabled").single();
      ensureDatabaseSuccess(error); return data;
    },
  },
  "billing.stage": {
    methods: new Set(["POST"]), scope: "billing:write", mutates: true,
    handler: async (p) => {
      const {data,error}=await supabaseAdmin.rpc("billing_stage",{p_source:p.source_id,p_company:p.company_id,p_revision:p.revision,p_part:p.part,p_parts:p.parts,p_credit:p.credit,p_invoices:p.invoices,p_deleted:p.deleted});
      ensureDatabaseSuccess(error); return data;
    },
  },
  "billing.commit": {
    methods: new Set(["POST"]), scope: "billing:write", mutates: true,
    handler: async (p) => {
      const {data,error}=await supabaseAdmin.rpc("billing_commit",{p_source:p.source_id,p_company:p.company_id,p_revision:p.revision});
      ensureDatabaseSuccess(error); return data;
    },
  },
  health: {
    methods: new Set(["GET", "POST"]),
    scope: "health:read",
    mutates: false,
    handler: async (_payload, context) => ({
      status: "ok",
      credential_id: context.credential.id,
      timestamp: new Date().toISOString(),
    }),
  },

  "products.list": {
    methods: new Set(["GET", "POST"]),
    scope: "products:read",
    mutates: false,
    handler: async (payload) => {
      const limit = parseBoundedInteger(payload.limit, 100, 1, 1000, "limit");
      const available = parseBoolean(payload.available, true, "available");
      const { data, error } = await supabaseAdmin
        .from("products")
        .select(
          "id, name, name_ro, category, unit, price_standard, available, variant_label, packaging, min_order_qty, display_order",
        )
        .eq("available", available)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("name", { ascending: true })
        .limit(limit);
      ensureDatabaseSuccess(error);
      return data ?? [];
    },
  },

  "products.invoice_prices": {
    methods: new Set(["POST"]),
    scope: "orders:read",
    mutates: false,
    handler: async (payload) => {
      const storeId = requireUuid(payload.store_id, "store_id");
      const { data: store, error: storeError } = await supabaseAdmin
        .from("client_store").select("owner_id").eq("id", storeId).maybeSingle();
      ensureDatabaseSuccess(storeError);
      if (!store?.owner_id) throw new ExternalApiRequestError(404, "store_not_found", "Store pricing identity not found");
      // Reuse the platform's authoritative rules: product override/discount,
      // category discount, general discount, then standard price. Read-only RPC.
      const { data, error } = await supabaseAdmin.rpc("get_effective_prices_batch", {
        _owner_ids: [store.owner_id],
      }).limit(1001);
      ensureDatabaseSuccess(error);
      if (!data || data.length >= 1000) throw new ExternalApiRequestError(409, "pricing_limit", "Pricing catalogue exceeds the export limit");
      return { store_id: storeId, prices: data.map((row: { product_id: string; effective_price: number }) => ({
        product_id: row.product_id, unit_price: row.effective_price,
      })) };
    },
  },

  "companies.list": {
    methods: new Set(["GET", "POST"]),
    scope: "companies:read",
    mutates: false,
    handler: async (payload) => {
      const limit = parseBoundedInteger(payload.limit, 1000, 1, 5000, "limit");
      const { data, error } = await supabaseAdmin
        .from("client_company")
        .select("id, name, address, vat_number, registration_number")
        .order("name", { ascending: true })
        .limit(limit);
      ensureDatabaseSuccess(error);
      return data ?? [];
    },
  },

  "stores.list": {
    methods: new Set(["GET", "POST"]),
    scope: "stores:read",
    mutates: false,
    handler: async (payload) => {
      const limit = parseBoundedInteger(payload.limit, 1000, 1, 5000, "limit");
      const { data, error } = await supabaseAdmin
        .from("client_store")
        .select(
          "id, name, address, postcode, owner_id, zone_id, route_order, phone, google_maps_url, active, client_company_id, client_company:client_company_id(id, name, address, vat_number, registration_number)",
        )
        .order("route_order", { ascending: true })
        .limit(limit);
      ensureDatabaseSuccess(error);
      return data ?? [];
    },
  },

  "orders.weekly_export": {
    methods: new Set(["GET", "POST"]),
    scope: "orders:read",
    mutates: false,
    handler: async (payload) => {
      const weekStart = requireDate(payload.week_start, "week_start");
      const weekEnd = requireDate(payload.week_end, "week_end");
      const start = new Date(`${weekStart}T00:00:00Z`);
      const end = new Date(`${weekEnd}T00:00:00Z`);
      if (
        start.getUTCDay() !== 1 ||
        end.getUTCDay() !== 0 ||
        Math.round((end.getTime() - start.getTime()) / 86400000) !== 6
      ) {
        throw new ExternalApiRequestError(
          400,
          "invalid_week",
          "Billing period must be exactly Monday through Sunday",
        );
      }
      const limit = parseBoundedInteger(payload.limit, 1000, 1, 1000, "limit");
      const cursor = payload.cursor === null || payload.cursor === undefined
        ? undefined
        : requireUuid(payload.cursor, "cursor");
      let query = supabaseAdmin
        .from("orders")
        .select(
          "id, delivery_date, status, updated_at, client_store:client_store_id(id, name, address, postcode, phone, client_company_id, zone_id, route_order, zone:zone_id(id, name, color, active, driver_id, driver:driver_id(id, name)), client_company:client_company_id(id, name, address, vat_number, registration_number)), order_items(id, qty_ordered, qty_delivered, unit_price_snapshot, products:product_id(id, name, name_ro, variant_label, unit, category, price_standard, available, display_order))",
        )
        .gte("delivery_date", weekStart)
        .lte("delivery_date", weekEnd)
        .in("status", ["open", "locked"])
        .order("id", { ascending: true })
        .limit(limit + 1);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query;
      ensureDatabaseSuccess(error);
      let zones: unknown[] | undefined;
      if (!cursor) {
        const { data: zoneRows, error: zonesError } = await supabaseAdmin
          .from("zones")
          .select("id, name, color, active, driver_id, driver:driver_id(id, name)")
          .eq("active", true)
          .order("name", { ascending: true })
          .limit(5000);
        ensureDatabaseSuccess(zonesError);
        zones = zoneRows ?? [];
      }
      const rows = data ?? [];
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map((order: Record<string, unknown>) => ({
        ...order,
        order_items: Array.isArray(order.order_items)
          ? order.order_items.map((item: Record<string, unknown>) => ({
              ...item,
              quantity: item.qty_delivered ?? item.qty_ordered,
            })).filter((item: Record<string, unknown>) =>
              typeof item.quantity === "number" && item.quantity > 0
            )
          : [],
      }));
      return {
        orders: page,
        ...(zones ? { zones } : {}),
        next_cursor: hasMore && page.length > 0
          ? String((page[page.length - 1] as Record<string, unknown>).id)
          : null,
      };
    },
  },

  "orders.list": {
    methods: new Set(["GET", "POST"]),
    scope: "orders:read",
    mutates: false,
    handler: async (payload) => {
      const limit = parseBoundedInteger(payload.limit, 100, 1, 1000, "limit");
      const offset = parseBoundedInteger(
        payload.offset,
        0,
        0,
        100000,
        "offset",
      );
      const status = optionalOrderStatus(payload.status);

      let query = supabaseAdmin
        .from("orders")
        .select(
          "id, delivery_date, status, notes, created_at, updated_at, client_store_id, client_store:client_store_id(id, name, address)",
        )
        .order("delivery_date", { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq("status", status);
      if (payload.delivery_date !== undefined) {
        query = query.eq(
          "delivery_date",
          requireDate(payload.delivery_date, "delivery_date"),
        );
      }
      if (payload.store_id !== undefined) {
        query = query.eq(
          "client_store_id",
          requireUuid(payload.store_id, "store_id"),
        );
      }

      const { data, error } = await query;
      ensureDatabaseSuccess(error);
      return data ?? [];
    },
  },

  "orders.get": {
    methods: new Set(["GET", "POST"]),
    scope: "orders:read",
    mutates: false,
    handler: async (payload) => {
      const id = requireUuid(payload.id, "id");
      const { data, error } = await supabaseAdmin
        .from("orders")
        .select(
          "id, delivery_date, status, notes, created_at, updated_at, client_store_id, client_store:client_store_id(id, name, address, postcode), order_items(id, product_id, qty_ordered, qty_delivered, unit_price_snapshot, products:product_id(id, name, name_ro, unit))",
        )
        .eq("id", id)
        .maybeSingle();
      ensureDatabaseSuccess(error);
      if (!data) {
        throw new ExternalApiRequestError(
          404,
          "order_not_found",
          "Order not found",
        );
      }
      return data;
    },
  },

  "orders.update_status": {
    methods: new Set(["POST"]),
    scope: "orders:write",
    mutates: true,
    handler: async (payload) => {
      const id = requireUuid(payload.id, "id");
      const status = optionalOrderStatus(payload.status);
      if (!status || !["open", "locked", "cancelled"].includes(status)) {
        throw new ExternalApiRequestError(
          400,
          "invalid_status",
          "status must be open, locked or cancelled",
        );
      }
      const { data, error } = await supabaseAdmin
        .from("orders")
        .update({ status })
        .eq("id", id)
        .select("id, status, updated_at")
        .maybeSingle();
      ensureDatabaseSuccess(error);
      if (!data) {
        throw new ExternalApiRequestError(
          404,
          "order_not_found",
          "Order not found",
        );
      }
      return data;
    },
  },

  "orders.update_notes": {
    methods: new Set(["POST"]),
    scope: "orders:write",
    mutates: true,
    handler: async (payload) => {
      const id = requireUuid(payload.id, "id");
      if (
        payload.notes !== null &&
        payload.notes !== undefined &&
        (typeof payload.notes !== "string" || payload.notes.length > 2000)
      ) {
        throw new ExternalApiRequestError(
          400,
          "invalid_notes",
          "notes must be text up to 2000 characters",
        );
      }
      const notes = typeof payload.notes === "string" ? payload.notes : null;
      const { data, error } = await supabaseAdmin
        .from("orders")
        .update({ notes })
        .eq("id", id)
        .select("id, notes, updated_at")
        .maybeSingle();
      ensureDatabaseSuccess(error);
      if (!data) {
        throw new ExternalApiRequestError(
          404,
          "order_not_found",
          "Order not found",
        );
      }
      return data;
    },
  },

  "orders.mark_items_delivered": {
    methods: new Set(["POST"]),
    scope: "orders:write",
    mutates: true,
    handler: async (payload) => {
      const orderId = requireUuid(payload.order_id, "order_id");
      const items = parseDeliveredItems(payload.items);
      const { data, error } = await supabaseAdmin.rpc(
        "external_api_mark_items_delivered",
        {
          _order_id: orderId,
          _items: items,
        },
      );
      ensureDatabaseSuccess(error);
      return data;
    },
  },
};

async function enforceRateLimit(
  credential: ExternalApiCredential,
): Promise<void> {
  const windowStartedAt = new Date();
  windowStartedAt.setUTCSeconds(0, 0);
  const { data, error } = await supabaseAdmin.rpc(
    "consume_external_api_rate_limit",
    {
      _credential_id: credential.id,
      _window_started_at: windowStartedAt.toISOString(),
      _limit: credential.rateLimitPerMinute,
    },
  );
  ensureDatabaseSuccess(error);
  const result = Array.isArray(data) ? data[0] : undefined;
  if (!result?.allowed) {
    throw new ExternalApiRequestError(
      429,
      "rate_limit_exceeded",
      "Rate limit exceeded",
    );
  }
}

async function findIdempotentResponse(
  credentialId: string,
  keyHash: string,
  action: string,
  requestHash: string,
): Promise<ApiResult | null> {
  const { data, error } = await supabaseAdmin
    .from("external_api_idempotency")
    .select("action, request_hash, response_body, response_status")
    .eq("credential_id", credentialId)
    .eq("idempotency_key_hash", keyHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  ensureDatabaseSuccess(error);
  if (!data) return null;
  if (data.action !== action || data.request_hash !== requestHash) {
    throw new ExternalApiRequestError(
      409,
      "idempotency_conflict",
      "Idempotency-Key was already used for another request",
    );
  }
  return {
    body: data.response_body as Record<string, unknown>,
    status: data.response_status,
  };
}

async function saveIdempotentResponse(
  credentialId: string,
  keyHash: string,
  action: string,
  requestHash: string,
  result: ApiResult,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("external_api_idempotency")
    .upsert(
      {
        credential_id: credentialId,
        idempotency_key_hash: keyHash,
        action,
        request_hash: requestHash,
        response_body: result.body,
        response_status: result.status,
        expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
      },
      { onConflict: "credential_id,idempotency_key_hash", ignoreDuplicates: true },
    );
  ensureDatabaseSuccess(error);
}

async function recordAudit(entry: {
  requestId: string;
  credentialId: string;
  action: string;
  outcome: "succeeded" | "rejected" | "failed" | "replayed";
  status: number;
  durationMs: number;
  errorCode?: string;
  idempotencyKeyHash?: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("external_api_audit_log").insert({
    request_id: entry.requestId,
    credential_id: entry.credentialId,
    action: entry.action,
    outcome: entry.outcome,
    http_status: entry.status,
    duration_ms: entry.durationMs,
    error_code: entry.errorCode ?? null,
    idempotency_key_hash: entry.idempotencyKeyHash ?? null,
  });
  if (error) {
    console.error("External API audit write failed", {
      requestId: entry.requestId,
      action: entry.action,
    });
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = performance.now();
  const requestId = requestIdFrom(req.headers);
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) {
      return json(req, requestId, {
        status: 403,
        body: { success: false, error: "Origin not allowed" },
      });
    }
    return new Response(null, {
      status: 204,
      headers: responseHeaders(req, requestId),
    });
  }

  if (!EXTERNAL_API_ENABLED) {
    return json(req, requestId, {
      status: 503,
      body: { success: false, error: "External API is disabled" },
    });
  }

  let credential: ExternalApiCredential | undefined;
  let action = "unknown";
  let idempotencyKeyHash: string | undefined;

  try {
    const payload = await parsePayload(req);
    const rawAction = payload.action;
    if (typeof rawAction !== "string" || !actions[rawAction]) {
      throw new ExternalApiRequestError(
        400,
        "invalid_action",
        "Missing or unknown action",
      );
    }
    action = rawAction;
    delete payload.action;

    const definition = actions[action];
    if (!definition.methods.has(req.method)) {
      throw new ExternalApiRequestError(
        405,
        "method_not_allowed",
        "Method not allowed for action",
      );
    }

    credential = await authenticateExternalApiRequest(
      req.headers,
      getCredentials(),
      definition.scope,
    );
    await enforceRateLimit(credential);

    let requestHash: string | undefined;
    if (definition.mutates) {
      const idempotencyKey = requireIdempotencyKey(req.headers);
      idempotencyKeyHash = await sha256(
        `${credential.id}:${idempotencyKey}`,
      );
      requestHash = await createRequestHash(action, payload);
      const replay = await findIdempotentResponse(
        credential.id,
        idempotencyKeyHash,
        action,
        requestHash,
      );
      if (replay) {
        await recordAudit({
          requestId,
          credentialId: credential.id,
          action,
          outcome: "replayed",
          status: replay.status,
          durationMs: Math.round(performance.now() - startedAt),
          idempotencyKeyHash,
        });
        return json(req, requestId, replay, { "Idempotency-Replayed": "true" });
      }
    }

    const data = await definition.handler(payload, { credential, requestId });
    const result: ApiResult = {
      status: 200,
      body: { success: true, data },
    };

    if (definition.mutates && idempotencyKeyHash && requestHash) {
      await saveIdempotentResponse(
        credential.id,
        idempotencyKeyHash,
        action,
        requestHash,
        result,
      );
    }

    await recordAudit({
      requestId,
      credentialId: credential.id,
      action,
      outcome: "succeeded",
      status: result.status,
      durationMs: Math.round(performance.now() - startedAt),
      idempotencyKeyHash,
    });
    return json(req, requestId, result);
  } catch (error: unknown) {
    const requestError =
      error instanceof ExternalApiRequestError ? error : null;
    const status = requestError?.status ?? 500;
    const code = requestError?.code ?? "internal_error";
    const message = requestError?.message ?? "Internal server error";

    if (credential) {
      await recordAudit({
        requestId,
        credentialId: credential.id,
        action,
        outcome: status >= 500 ? "failed" : "rejected",
        status,
        durationMs: Math.round(performance.now() - startedAt),
        errorCode: code,
        idempotencyKeyHash,
      });
    } else {
      console.warn("External API request rejected", { requestId, action, code });
    }

    return json(
      req,
      requestId,
      {
        status,
        body: { success: false, error: message, code },
      },
      status === 429 ? { "Retry-After": "60" } : undefined,
    );
  }
});

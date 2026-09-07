export const EXTERNAL_API_SCOPES = [
  "health:read",
  "billing:write",
  "products:read",
  "companies:read",
  "stores:read",
  "orders:read",
  "orders:write",
] as const;

export type ExternalApiScope = (typeof EXTERNAL_API_SCOPES)[number];

export interface ExternalApiCredential {
  id: string;
  keyHash: string;
  scopes: ReadonlySet<ExternalApiScope>;
  expiresAt: number;
  rateLimitPerMinute: number;
}

interface RawCredential {
  id?: unknown;
  key_hash?: unknown;
  scopes?: unknown;
  expires_at?: unknown;
  rate_limit_per_minute?: unknown;
  enabled?: unknown;
}

export class ExternalApiRequestError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ExternalApiRequestError";
  }
}

const CREDENTIAL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function parseExternalApiCredentials(
  rawConfig: string | undefined,
): ExternalApiCredential[] {
  if (!rawConfig) {
    throw new Error("EXTERNAL_API_CREDENTIALS is not configured");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    throw new Error("EXTERNAL_API_CREDENTIALS must be valid JSON");
  }

  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 50) {
    throw new Error("EXTERNAL_API_CREDENTIALS must contain 1 to 50 entries");
  }

  const seenIds = new Set<string>();
  return parsed.flatMap((entry: RawCredential) => {
    if (entry.enabled === false) return [];
    if (
      typeof entry.id !== "string" ||
      !CREDENTIAL_ID_PATTERN.test(entry.id) ||
      seenIds.has(entry.id)
    ) {
      throw new Error("External API credential identifiers must be unique");
    }
    seenIds.add(entry.id);

    if (
      typeof entry.key_hash !== "string" ||
      !SHA256_PATTERN.test(entry.key_hash)
    ) {
      throw new Error("External API credential hashes must be SHA-256 hex");
    }

    if (!Array.isArray(entry.scopes) || entry.scopes.length < 1) {
      throw new Error("External API credentials require at least one scope");
    }
    const scopes = new Set<ExternalApiScope>();
    for (const scope of entry.scopes) {
      if (
        typeof scope !== "string" ||
        !EXTERNAL_API_SCOPES.includes(scope as ExternalApiScope)
      ) {
        throw new Error("External API credential contains an unknown scope");
      }
      scopes.add(scope as ExternalApiScope);
    }

    if (typeof entry.expires_at !== "string") {
      throw new Error("External API credentials require an expiry");
    }
    const expiresAt = Date.parse(entry.expires_at);
    if (!Number.isFinite(expiresAt)) {
      throw new Error("External API credential expiry is invalid");
    }

    const rateLimit = Number(entry.rate_limit_per_minute ?? 120);
    if (
      !Number.isInteger(rateLimit) ||
      rateLimit < 1 ||
      rateLimit > 10000
    ) {
      throw new Error("External API rate limit must be between 1 and 10000");
    }

    return [{
      id: entry.id,
      keyHash: entry.key_hash,
      scopes,
      expiresAt,
      rateLimitPerMinute: rateLimit,
    }];
  });
}

// Server-managed, additive authorization for one existing integration identity.
// Never take this identifier from a request. Existing key, expiry, enabled state,
// rate limit and all other scopes remain authoritative in the aggregate config.
export function withBillingWriterScope(
  credentials: ExternalApiCredential[],
  configuredWriterId: string | undefined,
): ExternalApiCredential[] {
  if (!configuredWriterId || !CREDENTIAL_ID_PATTERN.test(configuredWriterId)) {
    return credentials;
  }
  return credentials.map((credential) =>
    credential.id === configuredWriterId
      ? { ...credential, scopes: new Set([...credential.scopes, "billing:write" as const]) }
      : credential
  );
}

function extractBearerToken(headers: Headers): string {
  const authorization = headers.get("Authorization");
  const apiKey = headers.get("X-API-Key");

  if (authorization && apiKey) {
    throw new ExternalApiRequestError(
      401,
      "ambiguous_credential",
      "Unauthorized",
    );
  }

  let token: string | null = null;
  if (authorization) {
    const match = authorization.match(/^Bearer ([^\s]+)$/);
    token = match?.[1] ?? null;
  } else {
    token = apiKey;
  }

  if (!token || token.length < 32 || token.length > 512) {
    throw new ExternalApiRequestError(401, "invalid_credential", "Unauthorized");
  }
  return token;
}

export async function authenticateExternalApiRequest(
  headers: Headers,
  credentials: ExternalApiCredential[],
  requiredScope: ExternalApiScope,
  now = Date.now(),
): Promise<ExternalApiCredential> {
  const presentedHash = await sha256(extractBearerToken(headers));
  const credential = credentials.find((candidate) =>
    constantTimeEqual(candidate.keyHash, presentedHash)
  );

  if (!credential) {
    throw new ExternalApiRequestError(401, "invalid_credential", "Unauthorized");
  }
  if (credential.expiresAt <= now) {
    throw new ExternalApiRequestError(401, "expired_credential", "Unauthorized");
  }
  if (!credential.scopes.has(requiredScope)) {
    throw new ExternalApiRequestError(403, "insufficient_scope", "Forbidden");
  }
  return credential;
}

export function requireIdempotencyKey(headers: Headers): string {
  const key = headers.get("Idempotency-Key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ExternalApiRequestError(
      400,
      "invalid_idempotency_key",
      "A 16 to 128 character Idempotency-Key is required",
    );
  }
  return key;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new ExternalApiRequestError(400, "invalid_number", "Invalid number");
  }
  return value;
}

export async function createRequestHash(
  action: string,
  payload: Record<string, unknown>,
): Promise<string> {
  return sha256(JSON.stringify(canonicalize({ action, payload })));
}

export function parseBoundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ExternalApiRequestError(
      400,
      `invalid_${field}`,
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

export function parseBoolean(
  value: unknown,
  fallback: boolean,
  field: string,
): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new ExternalApiRequestError(
    400,
    `invalid_${field}`,
    `${field} must be true or false`,
  );
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ExternalApiRequestError(
      400,
      `invalid_${field}`,
      `${field} must be a UUID`,
    );
  }
  return value;
}

export interface DeliveredItemInput {
  order_item_id: string;
  qty_delivered: number;
}

export function parseDeliveredItems(value: unknown): DeliveredItemInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    throw new ExternalApiRequestError(
      400,
      "invalid_items",
      "items must contain between 1 and 500 entries",
    );
  }

  const seenIds = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ExternalApiRequestError(
        400,
        "invalid_item",
        `items[${index}] must be an object`,
      );
    }
    const record = item as Record<string, unknown>;
    const orderItemId = requireUuid(
      record.order_item_id,
      `items_${index}_order_item_id`,
    );
    if (seenIds.has(orderItemId)) {
      throw new ExternalApiRequestError(
        400,
        "duplicate_order_item",
        "Duplicate order item identifiers are not allowed",
      );
    }
    seenIds.add(orderItemId);

    const quantity = record.qty_delivered;
    if (
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      quantity > 1000000
    ) {
      throw new ExternalApiRequestError(
        400,
        "invalid_qty_delivered",
        "qty_delivered must be between 0 and 1000000",
      );
    }

    return {
      order_item_id: orderItemId,
      qty_delivered: quantity,
    };
  });
}

import { randomUUID } from 'crypto';

export const VR_BAKER_API_ENDPOINT = 'https://qcblxsbzopvsgohfghrv.supabase.co/functions/v1/external-api';

export interface VrBakerCompany {
  id: string;
  name: string;
  address: string;
  vatNumber: string;
  registrationNumber: string;
}

export interface VrBakerStore {
  id: string;
  name: string;
  address: string;
  phone: string;
  company: VrBakerCompany | null;
}

export interface VrBakerOrderItem {
  id: string;
  productId: string;
  productName: string;
  nameRo: string;
  variantLabel: string;
  unit: string;
  category: string;
  priceStandard: number;
  unitPrice: number;
  quantity: number;
  available: boolean;
}

export interface VrBakerOrder {
  id: string;
  deliveryDate: string;
  status: 'open' | 'locked';
  updatedAt: string;
  store: VrBakerStore;
  items: VrBakerOrderItem[];
}

export interface VrBakerProduct {
  id: string;
  name: string;
  nameRo: string;
  variantLabel: string;
  unit: string;
  category: string;
  priceStandard: number;
  available: boolean;
}

interface RequestOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

function requireRecord(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} are un format invalid.`);
  }
  return value as Record<string, any>;
}

function requireString(value: unknown, label: string, max = 1000) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`${label} este invalid.`);
  }
  return value;
}

function optionalString(value: unknown, max = 2000) {
  return typeof value === 'string' && value.length <= max ? value : '';
}

function requireUuid(value: unknown, label: string) {
  const parsed = requireString(value, label, 64);
  if (!UUID_PATTERN.test(parsed)) throw new Error(`${label} nu este un UUID valid.`);
  return parsed;
}

function finiteNonNegative(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000) {
    throw new Error(`${label} este invalid.`);
  }
  return parsed;
}

export function validateWeeklyPeriod(startDate: string, endDate: string) {
  if (!ISO_DATE_PATTERN.test(startDate) || !ISO_DATE_PATTERN.test(endDate)) {
    throw new Error('Perioada trebuie să folosească formatul YYYY-MM-DD.');
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('Perioada nu este validă.');
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (start.getUTCDay() !== 1 || end.getUTCDay() !== 0 || days !== 6) {
    throw new Error('Perioada de facturare trebuie să fie de luni până duminică.');
  }
  return { startDate, endDate };
}

function parseCompany(value: unknown): VrBakerCompany | null {
  if (value === null || value === undefined) return null;
  const company = requireRecord(value, 'Compania VR Baker');
  return {
    id: requireUuid(company.id, 'ID companie'),
    name: requireString(company.name, 'Numele companiei', 300),
    address: optionalString(company.address),
    vatNumber: optionalString(company.vat_number, 100),
    registrationNumber: optionalString(company.registration_number, 100),
  };
}

function parseStore(value: unknown): VrBakerStore {
  const store = requireRecord(value, 'Magazinul VR Baker');
  return {
    id: requireUuid(store.id, 'ID magazin'),
    name: requireString(store.name, 'Numele magazinului', 300),
    address: optionalString(store.address),
    phone: optionalString(store.phone, 100),
    company: parseCompany(store.client_company),
  };
}

function parseProduct(value: unknown): VrBakerProduct {
  const product = requireRecord(value, 'Produsul VR Baker');
  return {
    id: requireUuid(product.id, 'ID produs'),
    name: requireString(product.name, 'Numele produsului', 300),
    nameRo: optionalString(product.name_ro, 300),
    variantLabel: optionalString(product.variant_label, 200),
    unit: optionalString(product.unit, 50) || 'buc',
    category: optionalString(product.category, 100) || 'patisserie',
    priceStandard: finiteNonNegative(product.price_standard ?? 0, 'Prețul standard'),
    available: product.available !== false,
  };
}

function parseOrder(value: unknown): VrBakerOrder {
  const order = requireRecord(value, 'Comanda VR Baker');
  const status = requireString(order.status, 'Statusul comenzii', 20);
  if (status !== 'open' && status !== 'locked') {
    throw new Error('API-ul a returnat un status de comandă neacceptat.');
  }
  if (!ISO_DATE_PATTERN.test(String(order.delivery_date || ''))) throw new Error('Data livrării este invalidă.');
  if (!Array.isArray(order.order_items) || order.order_items.length > 10_000) {
    throw new Error('Pozițiile comenzii au un format invalid.');
  }
  const items = order.order_items.map((rawItem: unknown) => {
    const item = requireRecord(rawItem, 'Poziția comenzii');
    const product = parseProduct(item.products);
    return {
      ...product,
      id: requireUuid(item.id, 'ID poziție'),
      productId: product.id,
      productName: product.name,
      unitPrice: finiteNonNegative(item.unit_price_snapshot, 'Prețul poziției'),
      quantity: finiteNonNegative(item.quantity, 'Cantitatea poziției'),
    } satisfies VrBakerOrderItem;
  }).filter((item: VrBakerOrderItem) => item.quantity > 0);
  return {
    id: requireUuid(order.id, 'ID comandă'),
    deliveryDate: String(order.delivery_date),
    status,
    updatedAt: requireString(order.updated_at, 'Data actualizării', 100),
    store: parseStore(order.client_store),
    items,
  };
}

export class VrBakerApiClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(token: string, options: RequestOptions = {}) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 512) {
      throw new Error('Tokenul VR Baker API este invalid.');
    }
    this.token = token;
    this.fetchImpl = options.fetchImpl || fetch;
    this.endpoint = options.endpoint || VR_BAKER_API_ENDPOINT;
    this.timeoutMs = options.timeoutMs || 15_000;
    this.maxAttempts = options.maxAttempts || 3;
    this.wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    let lastError = new Error('VR Baker Platform nu este disponibilă.');
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.token,
            'X-Request-ID': randomUUID(),
          },
          body: JSON.stringify({ action, ...payload }),
          signal: controller.signal,
        });
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Răspunsul VR Baker este prea mare.');
        let body: any;
        try { body = JSON.parse(raw); } catch { throw new Error('VR Baker a returnat un răspuns invalid.'); }
        if (response.ok && body?.success === true) return body.data as T;
        lastError = new Error(typeof body?.error === 'string' ? body.error : 'Cererea VR Baker a eșuat.');
        if (response.status !== 429 && response.status < 500) {
          throw Object.assign(lastError, { retryable: false });
        }
      } catch (error) {
        lastError = error instanceof Error && error.name === 'AbortError'
          ? new Error('Conexiunea cu VR Baker a expirat.')
          : error instanceof Error ? error : lastError;
        if ((error as { retryable?: boolean })?.retryable === false || attempt >= this.maxAttempts) break;
      } finally {
        clearTimeout(timeout);
      }
      await this.wait(250 * attempt);
    }
    throw lastError;
  }

  async health() {
    return this.request<{ status: string; credential_id: string; timestamp: string }>('health');
  }

  async fetchWeeklyOrders(startDate: string, endDate: string) {
    validateWeeklyPeriod(startDate, endDate);
    const collected: VrBakerOrder[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const data = await this.request<{ orders: unknown[]; next_cursor?: string | null }>('orders.weekly_export', {
        week_start: startDate,
        week_end: endDate,
        cursor,
        limit: 1000,
      });
      if (!data || !Array.isArray(data.orders)) throw new Error('Exportul săptămânal VR Baker este invalid.');
      const parsed = data.orders.map(parseOrder);
      collected.push(...parsed);
      const next = data.next_cursor || null;
      if (!next) return collected;
      if (!UUID_PATTERN.test(next) || next === cursor) throw new Error('Paginarea VR Baker este invalidă.');
      cursor = next;
    }
    throw new Error('Exportul VR Baker a depășit limita de paginare.');
  }

  async fetchProducts() {
    const data = await this.request<unknown[]>('products.list', { available: true, limit: 1000 });
    if (!Array.isArray(data)) throw new Error('Catalogul VR Baker este invalid.');
    if (data.length === 0) throw new Error('Catalogul VR Baker este gol; produsele locale nu au fost modificate.');
    if (data.length >= 1000) throw new Error('Catalogul VR Baker a atins limita API; sincronizarea a fost oprită pentru a evita un import incomplet.');
    return data.map(parseProduct);
  }

  async fetchCompanies() {
    const data = await this.request<unknown[]>('companies.list', { limit: 5000 });
    if (!Array.isArray(data)) throw new Error('Lista companiilor VR Baker este invalidă.');
    return data.map((value) => {
      const company = parseCompany(value);
      if (!company) throw new Error('Compania VR Baker este invalidă.');
      return company;
    });
  }

  async fetchStores() {
    const data = await this.request<unknown[]>('stores.list', { limit: 5000 });
    if (!Array.isArray(data)) throw new Error('Lista magazinelor VR Baker este invalidă.');
    return data.map(parseStore);
  }
}

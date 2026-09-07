import { createHash } from 'crypto';
import type { VrBakerOrder, VrBakerStore } from './vrBakerApiClient';

export interface WeeklyInvoiceGroup {
  store: VrBakerStore;
  items: Array<{
    externalProductId: string;
    productName: string;
    name_ro: string;
    variant_label: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    productOrder: number | null;
  }>;
  sourceOrders: Array<{ id: string; updatedAt: string }>;
  sourceFingerprint: string;
}

export function aggregateWeeklyOrders(orders: VrBakerOrder[]): WeeklyInvoiceGroup[] {
  const stores = new Map<string, { store: VrBakerStore; items: Map<string, WeeklyInvoiceGroup['items'][number]>; sourceOrders: WeeklyInvoiceGroup['sourceOrders'] }>();
  for (const order of orders) {
    if (order.status !== 'open' && order.status !== 'locked') continue;
    let group = stores.get(order.store.id);
    if (!group) {
      group = { store: order.store, items: new Map(), sourceOrders: [] };
      stores.set(order.store.id, group);
    }
    group.sourceOrders.push({ id: order.id, updatedAt: order.updatedAt });
    for (const item of order.items) {
      if (item.quantity <= 0) continue;
      const key = `${item.productId}\u0000${item.unitPrice}`;
      const existing = group.items.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        existing.totalPrice = existing.quantity * existing.unitPrice;
      } else {
        group.items.set(key, {
          externalProductId: item.productId,
          productName: item.productName,
          name_ro: item.nameRo,
          variant_label: item.variantLabel,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.quantity * item.unitPrice,
          productOrder: item.displayOrder,
        });
      }
    }
  }
  return [...stores.values()].map((group) => {
    const sourceOrders = group.sourceOrders.sort((a, b) => a.id.localeCompare(b.id));
    const items = [...group.items.values()].sort((a, b) => {
      const orderA = a.productOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.productOrder ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB || `${a.productName}:${a.unitPrice}`.localeCompare(`${b.productName}:${b.unitPrice}`);
    });
    // Keep the legacy fingerprint shape stable so adding bilingual presentation
    // fields does not falsely report old invoices as having a changed source.
    const fingerprintItems = items.map((item) => ({
      productName: item.name_ro || item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    })).sort((a, b) => `${a.productName}:${a.unitPrice}`.localeCompare(`${b.productName}:${b.unitPrice}`));
    const sourceFingerprint = createHash('sha256').update(JSON.stringify({ sourceOrders, items: fingerprintItems })).digest('hex');
    return { store: group.store, items, sourceOrders, sourceFingerprint };
  }).filter((group) => group.items.length > 0).sort((a, b) => {
    const zoneA = a.store.zone?.name || '\uffff';
    const zoneB = b.store.zone?.name || '\uffff';
    const zoneOrder = zoneA.localeCompare(zoneB, 'ro');
    if (zoneOrder !== 0) return zoneOrder;
    const routeA = a.store.routeOrder ?? Number.MAX_SAFE_INTEGER;
    const routeB = b.store.routeOrder ?? Number.MAX_SAFE_INTEGER;
    return routeA - routeB || a.store.name.localeCompare(b.store.name, 'ro');
  });
}

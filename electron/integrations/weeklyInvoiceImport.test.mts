import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { aggregateWeeklyOrders } from './weeklyInvoiceImport.ts';
import type { VrBakerOrder } from './vrBakerApiClient.ts';

test('weekly invoice items keep English and Romanian names without changing the legacy fingerprint', () => {
  const order: VrBakerOrder = {
    id: '11111111-1111-4111-8111-111111111111',
    deliveryDate: '2026-08-24',
    status: 'open',
    updatedAt: '2026-08-24T10:00:00Z',
    store: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Store',
      address: '',
      phone: '',
      company: null,
    },
    items: [{
      id: '33333333-3333-4333-8333-333333333333',
      productId: '44444444-4444-4444-8444-444444444444',
      productName: 'Cheese Pie',
      nameRo: 'Plăcintă cu brânză',
      variantLabel: 'Large',
      unit: 'buc',
      category: 'patisserie',
      priceStandard: 3,
      unitPrice: 2.5,
      quantity: 2,
      available: true,
    }],
  };

  const [group] = aggregateWeeklyOrders([order]);
  assert.deepEqual(group.items, [{
    productName: 'Cheese Pie',
    name_ro: 'Plăcintă cu brânză',
    variant_label: 'Large',
    unit: 'buc',
    quantity: 2,
    unitPrice: 2.5,
    totalPrice: 5,
  }]);
  const legacyPayload = {
    sourceOrders: [{ id: order.id, updatedAt: order.updatedAt }],
    items: [{ productName: 'Plăcintă cu brânză', quantity: 2, unitPrice: 2.5, totalPrice: 5 }],
  };
  assert.equal(group.sourceFingerprint, createHash('sha256').update(JSON.stringify(legacyPayload)).digest('hex'));
});

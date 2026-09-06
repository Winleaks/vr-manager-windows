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
      routeOrder: null,
      zone: null,
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
      displayOrder: 7,
      unitPrice: 2.5,
      quantity: 2,
      available: true,
    }, {
      id: '55555555-5555-4555-8555-555555555555',
      productId: '66666666-6666-4666-8666-666666666666',
      productName: 'Apple Pie',
      nameRo: 'Plăcintă cu mere',
      variantLabel: '',
      unit: 'buc',
      category: 'patisserie',
      priceStandard: 4,
      displayOrder: 20,
      unitPrice: 3,
      quantity: 1,
      available: true,
    }],
  };

  const [group] = aggregateWeeklyOrders([order]);
  assert.deepEqual(group.items, [{
    externalProductId: '44444444-4444-4444-8444-444444444444',
    productName: 'Cheese Pie',
    name_ro: 'Plăcintă cu brânză',
    variant_label: 'Large',
    unit: 'buc',
    quantity: 2,
    unitPrice: 2.5,
    totalPrice: 5,
    productOrder: 7,
  }, {
    externalProductId: '66666666-6666-4666-8666-666666666666',
    productName: 'Apple Pie',
    name_ro: 'Plăcintă cu mere',
    variant_label: '',
    unit: 'buc',
    quantity: 1,
    unitPrice: 3,
    totalPrice: 3,
    productOrder: 20,
  }]);
  const legacyPayload = {
    sourceOrders: [{ id: order.id, updatedAt: order.updatedAt }],
    items: [
      { productName: 'Plăcintă cu brânză', quantity: 2, unitPrice: 2.5, totalPrice: 5 },
      { productName: 'Plăcintă cu mere', quantity: 1, unitPrice: 3, totalPrice: 3 },
    ],
  };
  assert.equal(group.sourceFingerprint, createHash('sha256').update(JSON.stringify(legacyPayload)).digest('hex'));
});

test('weekly stores are ordered by zone and driver route, with unassigned stores last', () => {
  const base: VrBakerOrder = {
    id: '11111111-1111-4111-8111-111111111111',
    deliveryDate: '2026-08-24',
    status: 'open',
    updatedAt: '2026-08-24T10:00:00Z',
    store: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Second stop', address: '', phone: '', routeOrder: 2,
      zone: { id: '77777777-7777-4777-8777-777777777777', name: 'North', color: '#111111', driver: null },
      company: null,
    },
    items: [{
      id: '33333333-3333-4333-8333-333333333333',
      productId: '44444444-4444-4444-8444-444444444444',
      productName: 'Bread', nameRo: 'Pâine', variantLabel: '', unit: 'buc', category: 'bakery',
      priceStandard: 2, displayOrder: 1, unitPrice: 2, quantity: 1, available: true,
    }],
  };
  const first = {
    ...base,
    id: '55555555-5555-4555-8555-555555555555',
    store: { ...base.store, id: '66666666-6666-4666-8666-666666666666', name: 'First stop', routeOrder: 1 },
  };
  const unassigned = {
    ...base,
    id: '88888888-8888-4888-8888-888888888888',
    store: { ...base.store, id: '99999999-9999-4999-8999-999999999999', name: 'Unassigned', routeOrder: null, zone: null },
  };
  assert.deepEqual(aggregateWeeklyOrders([base, unassigned, first]).map((group) => group.store.name), [
    'First stop', 'Second stop', 'Unassigned',
  ]);
});

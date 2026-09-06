import assert from 'node:assert/strict';
import test from 'node:test';
import { VrBakerApiClient, validateWeeklyPeriod } from './vrBakerApiClient.ts';

const TOKEN = 'a'.repeat(48);

test('accepts only complete Monday-to-Sunday billing periods', () => {
  assert.deepEqual(validateWeeklyPeriod('2026-08-03', '2026-08-09'), {
    startDate: '2026-08-03', endDate: '2026-08-09',
  });
  assert.throws(() => validateWeeklyPeriod('2026-08-04', '2026-08-10'), /luni până duminică/);
  assert.throws(() => validateWeeklyPeriod('2026-08-03', '2026-08-10'), /luni până duminică/);
});

test('retries transient responses but not authorization failures', async () => {
  let transientCalls = 0;
  const transientClient = new VrBakerApiClient(TOKEN, {
    maxAttempts: 3,
    wait: async () => {},
    fetchImpl: (async () => {
      transientCalls += 1;
      return transientCalls < 3
        ? new Response(JSON.stringify({ success: false, error: 'temporar' }), { status: 503 })
        : new Response(JSON.stringify({ success: true, data: { status: 'ok' } }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal((await transientClient.health()).status, 'ok');
  assert.equal(transientCalls, 3);

  let deniedCalls = 0;
  const deniedClient = new VrBakerApiClient(TOKEN, {
    wait: async () => {},
    fetchImpl: (async () => {
      deniedCalls += 1;
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 });
    }) as typeof fetch,
  });
  await assert.rejects(() => deniedClient.health(), /Unauthorized/);
  assert.equal(deniedCalls, 1);
});

test('rejects delivered orders until the driver application owns that status', async () => {
  const deliveredClient = new VrBakerApiClient(TOKEN, {
    maxAttempts: 1,
    fetchImpl: (async () => new Response(JSON.stringify({ success: true, data: { orders: [{
      id: '11111111-1111-4111-8111-111111111111', delivery_date: '2026-08-03', status: 'delivered',
      updated_at: '2026-08-03T10:00:00Z',
      client_store: { id: '22222222-2222-4222-8222-222222222222', name: 'Magazin', postcode: 'SS14 1EU', client_company: null },
      order_items: [],
    }], next_cursor: null } }), { status: 200 })) as typeof fetch,
  });
  await assert.rejects(() => deliveredClient.fetchWeeklyOrders('2026-08-03', '2026-08-09'), /status de comandă neacceptat/);
});

test('refuses an empty product catalog before local reconciliation', async () => {
  const client = new VrBakerApiClient(TOKEN, {
    maxAttempts: 1,
    fetchImpl: (async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })) as typeof fetch,
  });
  await assert.rejects(() => client.fetchProducts(), /catalogul VR Baker este gol/i);
});

test('accepts canonical PostgreSQL UUIDs without RFC marker restrictions', async () => {
  const legacyProductId = '99999999-9999-9999-9999-999999999999';
  const client = new VrBakerApiClient(TOKEN, {
    maxAttempts: 1,
    fetchImpl: (async () => new Response(JSON.stringify({ success: true, data: { orders: [{
      id: '11111111-1111-4111-8111-111111111111', delivery_date: '2026-08-03', status: 'open',
      updated_at: '2026-08-03T10:00:00Z',
      client_store: { id: '22222222-2222-4222-8222-222222222222', name: 'Magazin', postcode: 'SS14 1EU', route_order: 4, zone: { id: '77777777-7777-4777-8777-777777777777', name: 'North', color: '#123456', driver: { id: '88888888-8888-4888-8888-888888888888', name: 'Ion' } }, client_company: null },
      order_items: [{
        id: '33333333-3333-4333-8333-333333333333', quantity: 2, unit_price_snapshot: 1.5,
        products: { id: legacyProductId, name: 'Bread', name_ro: 'Pâine', available: true, display_order: 12 },
      }],
    }], next_cursor: null } }), { status: 200 })) as typeof fetch,
  });

  const orders = await client.fetchWeeklyOrders('2026-08-03', '2026-08-09');
  assert.equal(orders[0]?.items[0]?.productId, legacyProductId);
  assert.equal(orders[0]?.items[0]?.displayOrder, 12);
  assert.equal(orders[0]?.store.postcode, 'SS14 1EU');
  assert.equal(orders[0]?.store.routeOrder, 4);
  assert.equal(orders[0]?.store.zone?.name, 'North');
  assert.equal(orders[0]?.store.zone?.driver?.name, 'Ion');
});

test('weekly snapshot includes active zones without orders in the same API response', async () => {
  const client = new VrBakerApiClient(TOKEN, {
    maxAttempts: 1,
    fetchImpl: (async () => new Response(JSON.stringify({ success: true, data: {
      orders: [],
      zones: [{ id: '77777777-7777-4777-8777-777777777777', name: 'South', color: '#abcdef', driver: { id: '88888888-8888-4888-8888-888888888888', name: 'Maria' } }],
      next_cursor: null,
    } }), { status: 200 })) as typeof fetch,
  });
  const snapshot = await client.fetchWeeklyBillingSnapshot('2026-08-03', '2026-08-09');
  assert.equal(snapshot.orders.length, 0);
  assert.deepEqual(snapshot.zones.map((zone) => [zone.name, zone.driver?.name]), [['South', 'Maria']]);
});

test('continues to reject malformed product identifiers', async () => {
  const client = new VrBakerApiClient(TOKEN, {
    maxAttempts: 1,
    fetchImpl: (async () => new Response(JSON.stringify({ success: true, data: { orders: [{
      id: '11111111-1111-4111-8111-111111111111', delivery_date: '2026-08-03', status: 'open',
      updated_at: '2026-08-03T10:00:00Z',
      client_store: { id: '22222222-2222-4222-8222-222222222222', name: 'Magazin', client_company: null },
      order_items: [{
        id: '33333333-3333-4333-8333-333333333333', quantity: 2, unit_price_snapshot: 1.5,
        products: { id: 'not-a-uuid', name: 'Bread', name_ro: 'Pâine', available: true },
      }],
    }], next_cursor: null } }), { status: 200 })) as typeof fetch,
  });

  await assert.rejects(
    () => client.fetchWeeklyOrders('2026-08-03', '2026-08-09'),
    /ID produs nu este un UUID valid/,
  );
});

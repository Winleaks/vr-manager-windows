import assert from 'node:assert/strict';
import test from 'node:test';
import { localInvoiceCatalog, priceInvoiceCatalog } from './invoiceCatalogPricing.ts';
import { VrBakerApiClient } from './vrBakerApiClient.ts';

const storeId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const product = { id: 1, name: 'Bread', price_standard: 5, supabase_product_id: productId };

test('new lines use platform effective prices, including zero and higher preferential prices', async () => {
  for (const unitPrice of [0, 2.5, 5, 7]) {
    const [priced] = await priceInvoiceCatalog({ storeExternalId: storeId, products: [product] }, async (id) => {
      assert.equal(id, storeId);
      return new Map([[productId, unitPrice]]);
    });
    assert.equal(priced.unitPrice, unitPrice);
    assert.equal(priced.priceSource, 'vr-baker');
    assert.equal(product.price_standard, 5);
  }
});

test('unlinked local customers use standard prices without any provider call', async () => {
  const [priced] = await priceInvoiceCatalog({ storeExternalId: null, products: [product] }, async () => { throw new Error('unexpected network call'); });
  assert.equal(priced.unitPrice, 5);
  assert.equal(priced.priceSource, 'standard');
});

test('offline, missing and invalid tariffs never silently fall back to standard prices', async () => {
  const context = { storeExternalId: storeId, products: [product] };
  const [offline] = await priceInvoiceCatalog(context, async () => { throw new Error('offline credential must not escape'); });
  assert.equal(offline.id, product.id); assert.equal(offline.unitPrice, null); assert.equal(offline.priceSource, 'unverified'); assert.equal(offline.priceIssue, 'unavailable');
  assert.equal(JSON.stringify(offline).includes('credential'), false);
  const [missing] = await priceInvoiceCatalog(context, async () => new Map());
  assert.equal(missing.unitPrice, null); assert.equal(missing.priceIssue, 'missing');
  for (const price of [NaN, -1, Infinity]) {
    const [invalid] = await priceInvoiceCatalog(context, async () => new Map([[productId, price]]));
    assert.equal(invalid.unitPrice, null); assert.equal(invalid.priceIssue, 'invalid');
  }
});

test('one missing tariff does not hide the other products or invalidate their verified prices', async () => {
  const second = { ...product, id: 2, supabase_product_id: storeId, name: 'Cake' };
  const result = await priceInvoiceCatalog({ storeExternalId: storeId, products: [product, second] }, async () => new Map([[productId, 2.5]]));
  assert.equal(result.length, 2); assert.equal(result[0].unitPrice, 2.5); assert.equal(result[0].priceSource, 'vr-baker');
  assert.equal(result[1].id, second.id); assert.equal(result[1].unitPrice, null); assert.equal(result[1].priceIssue, 'missing');
});

test('local catalogue is immediately available without claiming that client tariffs are verified', () => {
  const localOnly = { ...product, id: 2, supabase_product_id: null };
  const rows = localInvoiceCatalog({ storeExternalId: storeId, products: [product, localOnly] });
  assert.equal(rows[0].unitPrice, null); assert.equal(rows[0].priceSource, 'unverified'); assert.equal(rows[0].price_standard, 5);
  assert.equal(rows[1].unitPrice, 5); assert.equal(rows[1].priceSource, 'standard');
});

test('retry restores verified pricing without mutating catalogue or previous results; empty catalogue skips network', async () => {
  const context = { storeExternalId: storeId, products: [product] };
  const first = await priceInvoiceCatalog(context, async () => { throw Error('offline'); });
  const retry = await priceInvoiceCatalog(context, async () => new Map([[productId, 0]]));
  assert.equal(first[0].unitPrice, null); assert.equal(retry[0].unitPrice, 0); assert.equal(product.price_standard, 5);
  assert.deepEqual(await priceInvoiceCatalog({ storeExternalId: storeId, products: [] }, async () => { throw Error('must not call'); }), []);
});

function client(data: unknown, inspect?: (payload: any) => void) {
  return new VrBakerApiClient('a'.repeat(48), { maxAttempts: 1, fetchImpl: (async (_url, init) => {
    inspect?.(JSON.parse(init!.body as string));
    return new Response(JSON.stringify({ success: true, data }));
  }) as typeof fetch });
}

test('pricing API sends only store identity and validates the returned store/product mapping', async () => {
  const result = await client({ store_id: storeId, prices: [{ product_id: productId, unit_price: 0 }] }, (payload) => {
    assert.deepEqual(payload, { action: 'products.invoice_prices', store_id: storeId });
  }).fetchInvoicePrices(storeId);
  assert.equal(result.get(productId), 0);
  for (const data of [
    { store_id: productId, prices: [] },
    { store_id: storeId, prices: [{ product_id: productId, unit_price: null }] },
    { store_id: storeId, prices: [{ product_id: productId, unit_price: -1 }] },
    { store_id: storeId, prices: [{ product_id: 'invalid', unit_price: 2 }] },
    { store_id: storeId, prices: Array(2).fill({ product_id: productId, unit_price: 2 }) },
    { store_id: storeId, prices: Array(1000).fill({ product_id: productId, unit_price: 2 }) },
  ]) await assert.rejects(client(data).fetchInvoicePrices(storeId));
  await assert.rejects(client({}).fetchInvoicePrices('invalid'));
});

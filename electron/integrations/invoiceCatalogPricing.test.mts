import assert from 'node:assert/strict';
import test from 'node:test';
import { priceInvoiceCatalog } from './invoiceCatalogPricing.ts';
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
  await assert.rejects(priceInvoiceCatalog(context, async () => { throw new Error('offline'); }), /offline/);
  await assert.rejects(priceInvoiceCatalog(context, async () => new Map()), /lipsește/);
  for (const price of [NaN, -1, Infinity]) {
    await assert.rejects(priceInvoiceCatalog(context, async () => new Map([[productId, price]])), /invalid/);
  }
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

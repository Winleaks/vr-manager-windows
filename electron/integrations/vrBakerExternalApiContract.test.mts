import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../supabase/functions/external-api/index.ts', import.meta.url), 'utf8');

test('invoice pricing is read-only and resolves the owner from the store, reusing platform pricing rules', () => {
  const action = source.slice(source.indexOf('"products.invoice_prices":'), source.indexOf('"companies.list":'));
  assert.match(action, /scope: "orders:read"/);
  assert.match(action, /mutates: false/);
  assert.match(action, /requireUuid\(payload.store_id/);
  assert.match(action, /\.from\("client_store"\).*\.eq\("id", storeId\)/);
  assert.match(action, /rpc\("get_effective_prices_batch"/);
  assert.match(action, /_owner_ids: \[store.owner_id\]/);
  assert.doesNotMatch(action, /payload.owner_id|\.update\(|\.insert\(/);
});

test('weekly export includes read-only zone, driver and route metadata', () => {
  assert.match(source, /zone:zone_id\(id, name, color, active, driver_id, driver:driver_id\(id, name\)\)/);
  assert.match(source, /\.from\("zones"\)[\s\S]*\.eq\("active", true\)/);
  assert.match(source, /route_order/);
  assert.match(source, /\.in\("status", \["open", "locked"\]\)/);
  assert.doesNotMatch(source, /\.in\("status", \["open", "locked", "delivered"\]\)/);
});

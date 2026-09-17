import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { VrBakerApiClient } from './vrBakerApiClient.ts';
import { aggregateWeeklyOrders } from './weeklyInvoiceImport.ts';
import { ExternalApiRequestError, parseBoolean, parseBoundedInteger, requireUuid } from '../../supabase/functions/_shared/external-api-security.ts';
import { resolveStoreCompany, storeCompanyColumns } from '../../supabase/functions/_shared/store-company.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const week = { week_start: '2026-09-14', week_end: '2026-09-20' };
function order(n: number, status: string, delivered: Array<number | null>, actor: string | null = null) {
  return { id: id(n), status, delivery_date: '2026-09-17', updated_at: '2026-09-17T08:47:00Z', delivered_by: actor,
    client_store: { id: id(100), name: 'Synthetic shop', client_company: null },
    order_items: delivered.map((qty, i) => ({ id: id(n * 10 + i), qty_ordered: 2, qty_delivered: qty, unit_price_snapshot: [0.1, 1.95, 1.8][i],
      products: { id: id(200 + i), name: `Product ${i}`, available: true } })),
  };
}

// Execute the actual export handler, replacing only its read-only database adapter.
function exportHarness(rows: ReturnType<typeof order>[]) {
  const source = fs.readFileSync(new URL('../../supabase/functions/external-api/index.ts', import.meta.url), 'utf8');
  const section = source.slice(source.indexOf('"orders.weekly_export":'), source.indexOf('"orders.list":'));
  const script = ts.transpileModule(`const actions = {${section}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const bindings = {
    ExternalApiRequestError, parseBoolean, parseBoundedInteger, requireUuid, resolveStoreCompany, storeCompanyColumns,
    requireDate: (value: string) => value,
    ensureDatabaseSuccess: (error: unknown) => { if (error) throw error; },
    supabaseAdmin: { from(table: string) {
      let selected: any[] = table === 'orders' ? structuredClone(rows) : [];
      let maxRows = Infinity;
      const query = {
        select() { return query; },
        gte(key: string, value: string) { selected = selected.filter(r => r[key] >= value); return query; },
        lte(key: string, value: string) { selected = selected.filter(r => r[key] <= value); return query; },
        gt(key: string, value: string) { selected = selected.filter(r => r[key] > value); return query; },
        eq() { return query; },
        in(key: string, values: string[]) { selected = selected.filter(r => values.includes(r[key])); return query; },
        order(key: string) { selected.sort((a,b) => a[key].localeCompare(b[key])); return query; },
        limit(n: number) { maxRows = n; return query; },
        then(resolve: (result: unknown) => unknown) { return Promise.resolve(resolve({ data: selected.slice(0,maxRows), error: null })); },
      };
      return query;
    } },
  };
  return new Function(...Object.keys(bindings), script + '\nreturn actions["orders.weekly_export"].handler;')(...Object.values(bindings));
}

test('real weekly export and Hub bill delivered 1/1/1, identically for driver or admin', async () => {
  for (const actor of ['driver', 'admin', null]) {
    const original = order(1, 'delivered', [1,1,1], actor);
    const handler = exportHarness([original, order(2, 'cancelled', [2,2,2])]);
    const client = new VrBakerApiClient('a'.repeat(48), { maxAttempts: 1, fetchImpl: (async (_url, options) => {
      const payload = JSON.parse(String(options?.body));
      assert.equal(payload.include_delivered, true);
      return new Response(JSON.stringify({ success: true, data: await handler(payload) }));
    }) as typeof fetch });
    const orders = await client.fetchWeeklyOrders(week.week_start, week.week_end);
    const groups = aggregateWeeklyOrders(orders);
    assert.deepEqual(groups[0].items.map(i => i.quantity), [1,1,1]);
    assert.equal(Math.round(groups[0].items.reduce((sum,i) => sum+i.totalPrice, 0) * 100), 385);
    assert.deepEqual(groups[0].sourceOrders.map(o => o.id), [original.id]);
    assert.deepEqual(original.order_items.map(i => i.qty_ordered), [2,2,2]);
    const before = structuredClone(orders); before[0].items.forEach(i => { i.quantity = 2; });
    assert.notEqual(groups[0].sourceFingerprint, aggregateWeeklyOrders(before)[0].sourceFingerprint);
  }
});

test('export preserves legacy callers and open/locked imports, zero delivery and paging', async () => {
  const handler = exportHarness([order(1,'open',[null]), order(2,'locked',[1]), order(3,'delivered',[0,1,null]), order(4,'cancelled',[2])]);
  const legacy = await handler(week);
  assert.equal(legacy.includes_delivered, false);
  assert.deepEqual(legacy.orders.map((o: any) => o.status), ['open','locked']);
  const result = await handler({ ...week, include_delivered: true });
  assert.deepEqual(result.orders.map((o: any) => o.order_items.map((i: any) => i.quantity)), [[2],[1],[1,2]]);
  let cursor = null; const seen: string[] = [];
  do {
    const page = await handler({ ...week, include_delivered: true, limit: 1, cursor });
    assert.equal(page.includes_delivered, true);
    seen.push(...page.orders.map((o: any) => o.id)); cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(seen, [id(1), id(2), id(3)]);
  await assert.rejects(() => handler({ ...week, include_delivered: 'invalid' }), /must be true or false/);
});

test('updated Hub refuses missing delivery capability and cancelled/unknown statuses', async () => {
  for (const data of [
    { orders: [] },
    { orders: [], includes_delivered: false },
    ...['cancelled','unexpected'].map(status => ({ orders: [order(1,status,[1])], includes_delivered: true })),
  ]) {
    const client = new VrBakerApiClient('a'.repeat(48), { maxAttempts: 1, fetchImpl: (async () => new Response(JSON.stringify({ success: true, data }))) as typeof fetch });
    await assert.rejects(() => client.fetchWeeklyOrders(week.week_start, week.week_end), /actualizat|status de comandă neacceptat/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveStoreCompany, storeCompanyColumns } from '../../supabase/functions/_shared/store-company.ts';
import { VrBakerApiClient } from './vrBakerApiClient.ts';

const company = { id: '11111111-1111-4111-8111-111111111111', name: 'Fixture Company', address: 'Official address', vat_number: 'VAT-A' };
const other = { ...company, id: '22222222-2222-4222-8222-222222222222' }; // same name, distinct legal identity
const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const store = { id: '33333333-3333-4333-8333-333333333333', name: 'Different shop name', active: false,
  client_company_id: null, client_company: null, owner_id: ownerId,
  company_owner: { id: ownerId, active: false, activated: false, client_company_id: company.id, client_company: company } };

test('owner-only association uses exact foreign keys even for inactive owner/store, without disclosing profile', () => {
  const before = structuredClone(store);
  const row = resolveStoreCompany(store);
  assert.equal(row.client_company_id, company.id);
  assert.deepEqual(row.client_company, company);
  assert.equal(row.active, false);
  assert.equal('company_owner' in row, false);
  assert.deepEqual(store, before);
});

test('direct, matching dual and genuinely unassociated stores retain their identities', () => {
  const direct = { ...store, client_company_id: company.id, client_company: company };
  for (const row of [direct, { ...direct, owner_id: null, company_owner: null },
    { ...direct, company_owner: { ...store.company_owner, client_company_id: null, client_company: null } }]) {
    assert.equal(resolveStoreCompany(row).client_company_id, company.id);
  }
  assert.equal(resolveStoreCompany({ ...store, owner_id: null, company_owner: null }).client_company_id, null);
  assert.equal(resolveStoreCompany({ ...store, company_owner: { ...store.company_owner, client_company_id: null, client_company: null } }).client_company, null);
});

test('conflicting or broken joins fail closed, never selecting a company by name', () => {
  for (const row of [
    { ...store, client_company_id: other.id, client_company: other },
    { ...store, client_company_id: company.id, client_company: null },
    { ...store, client_company_id: company.id, client_company: other },
    { ...store, company_owner: null },
    { ...store, owner_id: null },
    { ...store, company_owner: { ...store.company_owner, id: other.id } },
    { ...store, company_owner: { ...store.company_owner, client_company: other } },
    { ...store, company_owner: { ...store.company_owner, client_company: null } },
  ]) assert.throws(() => resolveStoreCompany(row), /association|inconsistent/);
});

test('all twelve owner-only fixture links are understood by the installed full-snapshot client', async () => {
  const companies = Array.from({ length: 12 }, (_, i) => ({ ...company, id: `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111` }));
  const stores = companies.map((c, i) => resolveStoreCompany({ ...store,
    id: `${String(i + 1).padStart(8, '0')}-3333-4333-8333-333333333333`,
    company_owner: { ...store.company_owner, client_company_id: c.id, client_company: c } }));
  const client = new VrBakerApiClient('a'.repeat(48), { maxAttempts: 1, fetchImpl: (async (_url, init) => {
    const action = JSON.parse(String(init?.body)).action;
    const rows = action === 'companies.list' ? companies : stores;
    return new Response(JSON.stringify({ success: true, data: { version: 1, rows, count: rows.length, complete: true } }));
  }) as typeof fetch });
  const result = await client.fetchEntitySnapshot();
  assert.equal(result.stores.length, 12);
  result.stores.forEach((s, i) => { assert.equal(s.company?.id, companies[i].id); assert.equal(s.platformActive, false); });
});

test('entity and weekly exports share one minimal owner/company join and resolver', () => {
  assert.match(storeCompanyColumns, /profiles!client_store_owner_id_fkey/);
  assert.doesNotMatch(storeCompanyColumns, /email|full_name|active|activated|!inner/);
  const source = readFileSync(new URL('../../supabase/functions/external-api/index.ts', import.meta.url), 'utf8');
  const stores = source.slice(source.indexOf('"stores.list":'), source.indexOf('"orders.weekly_export":'));
  const weekly = source.slice(source.indexOf('"orders.weekly_export":'), source.indexOf('"orders.list":'));
  assert.match(stores, /\$\{storeCompanyColumns\}/);
  assert.match(stores, /\.map\(resolveStoreCompany\)/);
  assert.match(weekly, /\$\{storeCompanyColumns\}/);
  assert.match(weekly, /client_store: resolveStoreCompany\(order.client_store\)/);
  assert.doesNotMatch(stores + weekly, /\.update\(|\.insert\(|\.delete\(/);
});

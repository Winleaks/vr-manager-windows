import assert from 'node:assert/strict';
import test from 'node:test';
import { VrBakerApiClient } from './vrBakerApiClient.ts';
import { resolveVrBakerEntities } from './vrBakerEntities.ts';

const company = {
  id: '11111111-1111-4111-8111-111111111111', name: 'CARAYMAN LTD',
  address: '', vatNumber: '', registrationNumber: '',
};
const store = {
  id: '22222222-2222-4222-8222-222222222222', name: company.name,
  address: '', phone: '', routeOrder: null, zone: null, company: null,
};

function clientFor(value: unknown) {
  return new VrBakerApiClient('a'.repeat(48), {
    maxAttempts: 1,
    fetchImpl: (async () => new Response(JSON.stringify({ success: true, data: [value] }))) as typeof fetch,
  });
}

test('same-name store resolves by source foreign key when joined company is missing', async () => {
  const stores = await clientFor({ ...store, client_company_id: company.id, client_company: null }).fetchStores();
  const resolved = resolveVrBakerEntities([company], stores);
  assert.equal(stores[0].companyId, company.id);
  assert.deepEqual(resolved.stores[0].company, company);
  assert.equal(resolved.stores[0].id, store.id);
});

test('joined company absent from catalog is imported once, by ID', () => {
  const resolved = resolveVrBakerEntities([], [{ ...store, company }, { ...store, id: 'other', company }]);
  assert.deepEqual(resolved.companies, [company]);
  assert.ok(resolved.stores.every(row => row.company?.id === company.id));
});

test('same name alone never assigns an unrelated store to a company', () => {
  assert.equal(resolveVrBakerEntities([company], [store]).stores[0].company, null);
});

test('missing referenced company aborts before database sync instead of unassigning a store', () => {
  assert.throws(() => resolveVrBakerEntities([], [{ ...store, companyId: company.id }]), /Sincronizarea a fost anulată/);
});

test('duplicate names do not override an explicit company identity', () => {
  const other = { ...company, id: '33333333-3333-4333-8333-333333333333' };
  const resolved = resolveVrBakerEntities([other, company], [{ ...store, companyId: company.id }]);
  assert.equal(resolved.stores[0].company?.id, company.id);
  assert.equal(resolved.companies.length, 2);
});

test('invalid or conflicting source company IDs are rejected', async () => {
  await assert.rejects(clientFor({ ...store, client_company_id: 'invalid' }).fetchStores(), /UUID/);
  await assert.rejects(clientFor({ ...store, client_company_id: store.id, client_company: company }).fetchStores(), /inconsistentă/);
  assert.throws(() => resolveVrBakerEntities([company], [{ ...store, company, companyId: store.id }]), /inconsistentă/);
});

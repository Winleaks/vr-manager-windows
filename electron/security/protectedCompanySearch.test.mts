import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesProtectedCompany } from '../../src/utils/protectedCompanySearch.ts';

const company = { name: 'Example Foods LTD', stores: [{ name: 'Băcănia Nord' }, { name: 'South Market' }] };
test('protected client search matches company and every store without case or accent sensitivity', () => {
  for (const query of ['', '  ', 'EXAMPLE', 'bacania', 'south market', 'foods nord']) assert.equal(matchesProtectedCompany(company, query), true, query);
  assert.equal(matchesProtectedCompany(company, 'missing'), false);
  assert.equal(matchesProtectedCompany(company, 'south missing'), false);
});
test('protected client filtering preserves all store names and handles empty stores', () => {
  const snapshot = JSON.stringify(company);
  assert.deepEqual([company].filter(item => matchesProtectedCompany(item, 'Nord'))[0].stores, company.stores);
  assert.equal(JSON.stringify(company), snapshot);
  assert.equal(matchesProtectedCompany({ name: 'Empty Company', stores: [] }, 'empty'), true);
  assert.equal(matchesProtectedCompany({ name: 'Empty Company', stores: [] }, 'Nord'), false);
});

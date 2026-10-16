import assert from 'node:assert/strict';
import test from 'node:test';
import { orderProtectedCompanies } from '../../src/utils/protectedCompanyOrder.ts';

test('assigned companies lead by outstanding balance; ties and unassigned companies are alphabetical', () => {
  const companies = [
    { companyKey: 'z', name: 'Zeta', assigned: true },
    { companyKey: 'other-z', name: 'Zebra', assigned: false },
    { companyKey: 'zero', name: 'Zero', assigned: true },
    { companyKey: 'a', name: 'Alfa', assigned: true },
    { companyKey: 'other-a', name: 'Altul', assigned: false },
  ];
  const invoices = [
    { companyKey: 'z', status: 'partial', outstanding: 20.1 },
    { companyKey: 'z', status: 'unpaid', outstanding: 30 },
    { companyKey: 'a', status: 'partial', outstanding: 50.1 },
    { companyKey: 'zero', status: 'cancelled', outstanding: 900 },
    { companyKey: 'other-z', status: 'unpaid', outstanding: 1000 },
  ];
  const original = structuredClone({ companies, invoices });
  const ordered = orderProtectedCompanies(companies, invoices);
  assert.deepEqual(ordered.map(row => [row.companyKey, row.outstanding]), [
    ['a', 50.1], ['z', 50.1], ['zero', 0], ['other-a', 0], ['other-z', 1000],
  ]);
  assert.deepEqual({ companies, invoices }, original, 'source records must not be mutated');
});

test('sum the provided remainder across stores and issuers without subtracting credit twice', () => {
  const companies = [{ companyKey: 'key', name: 'Client', assigned: true }];
  const invoices = [
    { companyKey: 'key', status: 'partial', outstanding: 0.1, storeId: 1, issuerCode: 'goodness', appliedCredit: 5 },
    { companyKey: 'key', status: 'partial', outstanding: 0.2, storeId: 2, issuerCode: 'vatra', appliedCredit: 3 },
    { companyKey: 'unrelated', status: 'unpaid', outstanding: 10 },
  ];
  assert.equal(orderProtectedCompanies(companies, invoices)[0].outstanding, 0.3);
});

test('invalid balances fail visibly instead of appearing as zero', () => {
  for (const outstanding of [NaN, Infinity, -1, undefined]) {
    assert.throws(() => orderProtectedCompanies([], [{ companyKey: 'key', status: 'partial', outstanding: outstanding as number }]), /Soldurile/);
  }
});

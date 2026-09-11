import assert from 'node:assert/strict';
import test from 'node:test';
import { billingDashboardRange } from '../../src/utils/billingDashboardPeriod.ts';

test('dashboard month includes the complete current month regardless of selected week', () => {
  assert.deepEqual(billingDashboardRange('month', new Date(2025, 0, 1), new Date(2026, 8, 11)), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(billingDashboardRange('month', new Date(), new Date(2024, 1, 15)), { from: '2024-02-01', to: '2024-02-29' });
});
test('dashboard week is Monday to Sunday across month and year boundaries', () => {
  assert.deepEqual(billingDashboardRange('week', new Date(2026, 8, 13)), { from: '2026-09-07', to: '2026-09-13' });
  assert.deepEqual(billingDashboardRange('week', new Date(2026, 0, 1)), { from: '2025-12-29', to: '2026-01-04' });
  assert.deepEqual(billingDashboardRange('week', new Date(2026, 2, 29)), { from: '2026-03-23', to: '2026-03-29' });
});
test('dashboard all history removes date filters', () => {
  assert.deepEqual(billingDashboardRange('all', new Date()), { from: undefined, to: undefined });
});

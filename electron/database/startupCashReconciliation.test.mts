import assert from 'node:assert/strict';
import test from 'node:test';
import { runStartupCashReconciliation } from '../startupCashReconciliation.ts';

test('startup reconciliation does no work when its marker already exists', async () => {
  let activeDayReads = 0;
  let backups = 0;
  let reconciliations = 0;

  const result = await runStartupCashReconciliation({
    markerKey: 'already-applied',
    targetBalance: 241.74,
    hasBalanceReconciliation: () => true,
    getActiveDay: () => {
      activeDayReads += 1;
      return { id: 1 };
    },
    backupDatabase: async () => {
      backups += 1;
      return { success: true };
    },
    reconcileBalanceOnce: () => {
      reconciliations += 1;
      return { applied: true };
    },
  });

  assert.deepEqual(result, { status: 'already-applied', applied: false });
  assert.equal(activeDayReads, 0);
  assert.equal(backups, 0);
  assert.equal(reconciliations, 0);
});

test('startup reconciliation treats a manually closed current day as a normal state', async () => {
  let backups = 0;
  let reconciliations = 0;

  const result = await runStartupCashReconciliation({
    markerKey: 'pending',
    targetBalance: 241.74,
    hasBalanceReconciliation: () => false,
    getActiveDay: () => null,
    backupDatabase: async () => {
      backups += 1;
      return { success: true };
    },
    reconcileBalanceOnce: () => {
      reconciliations += 1;
      return { applied: true };
    },
  });

  assert.deepEqual(result, { status: 'no-open-day', applied: false });
  assert.equal(backups, 0);
  assert.equal(reconciliations, 0);
});

test('startup reconciliation backs up before applying a pending adjustment', async () => {
  const calls: string[] = [];

  const result = await runStartupCashReconciliation({
    markerKey: 'pending',
    targetBalance: 241.74,
    hasBalanceReconciliation: () => false,
    getActiveDay: () => ({ id: 17 }),
    backupDatabase: async () => {
      calls.push('backup');
      return { success: true };
    },
    reconcileBalanceOnce: (dayId, targetBalance, markerKey) => {
      calls.push(`reconcile:${dayId}:${targetBalance}:${markerKey}`);
      return { applied: true };
    },
  });

  assert.deepEqual(result, { status: 'applied', applied: true });
  assert.deepEqual(calls, ['backup', 'reconcile:17:241.74:pending']);
});

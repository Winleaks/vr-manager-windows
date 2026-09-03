interface ActiveCashDay {
  id: number;
}

interface ReconciliationResult {
  applied: boolean;
}

interface StartupCashReconciliationDependencies {
  markerKey: string;
  targetBalance: number;
  hasBalanceReconciliation: (markerKey: string) => boolean;
  getActiveDay: () => ActiveCashDay | null;
  backupDatabase: () => Promise<{ success: boolean }>;
  reconcileBalanceOnce: (
    dayId: number,
    targetBalance: number,
    markerKey: string,
  ) => ReconciliationResult;
}

export async function runStartupCashReconciliation({
  markerKey,
  targetBalance,
  hasBalanceReconciliation,
  getActiveDay,
  backupDatabase,
  reconcileBalanceOnce,
}: StartupCashReconciliationDependencies) {
  if (hasBalanceReconciliation(markerKey)) {
    return { status: 'already-applied' as const, applied: false };
  }

  const activeDay = getActiveDay();
  if (!activeDay) {
    return { status: 'no-open-day' as const, applied: false };
  }

  const backup = await backupDatabase();
  if (!backup.success) {
    throw new Error('Backupul de siguranță nu a putut fi creat; soldul nu a fost modificat.');
  }

  const reconciliation = reconcileBalanceOnce(activeDay.id, targetBalance, markerKey);
  return {
    status: reconciliation.applied ? 'applied' as const : 'already-applied' as const,
    applied: reconciliation.applied,
  };
}

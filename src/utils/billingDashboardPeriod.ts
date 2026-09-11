import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';

export type BillingDashboardPeriod = 'month' | 'week' | 'all';

export function billingDashboardRange(period: BillingDashboardPeriod, selectedWeek: Date, now = new Date()) {
  if (period === 'all') return { from: undefined, to: undefined };
  const start = period === 'month' ? startOfMonth(now) : startOfWeek(selectedWeek, { weekStartsOn: 1 });
  const end = period === 'month' ? endOfMonth(now) : endOfWeek(selectedWeek, { weekStartsOn: 1 });
  return { from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') };
}

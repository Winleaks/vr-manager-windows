/** Calendar arithmetic is independent of the PC timezone and London's DST. */
export type InvoicePaymentTerms = { due_date: string | null; due_basis: 'weekly' | 'manual' | 'review'; period_start: string | null; period_end: string | null };
export function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
export function addCalendarDays(date: string, days: number): string {
  if (!calendarDate(date)) throw new Error('Invalid calendar date');
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function invoicePaymentTerms(invoiceDate: unknown, periodStart?: unknown, periodEnd?: unknown, imported = false): InvoicePaymentTerms {
  const start = calendarDate(periodStart), end = calendarDate(periodEnd);
  const review: InvoicePaymentTerms = { due_date: null, due_basis: 'review', period_start: start, period_end: end };
  if (imported || periodStart != null || periodEnd != null) {
    if (!start || !end || start > end) return review;
    const weekday = new Date(`${end}T12:00:00Z`).getUTCDay();
    return { due_date: addCalendarDays(end, (7 - weekday) % 7 + 4), due_basis: 'weekly', period_start: start, period_end: end };
  }
  const issued = calendarDate(invoiceDate);
  return issued ? { due_date: addCalendarDays(issued, 4), due_basis: 'manual', period_start: null, period_end: null } : review;
}
export function firstFridayAfter(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addCalendarDays(date, (5 - weekday + 7) % 7 || 7);
}

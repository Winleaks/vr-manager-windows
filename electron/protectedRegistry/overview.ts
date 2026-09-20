import { requireIsoDate } from '../database/businessValidation.ts';
import type { ProtectedIssuerCode, ProtectedRegistryVault } from './types.ts';

export type ProtectedOverview = ReturnType<typeof protectedRegistryOverview>;

/** Read-only aggregation over the unlocked vault; never reads normal billing. */
export function protectedRegistryOverview(vault: ProtectedRegistryVault, fromInput?: unknown, toInput?: unknown) {
  const from = fromInput === undefined ? undefined : requireIsoDate(fromInput, 'Data de început');
  const to = toInput === undefined ? undefined : requireIsoDate(toInput, 'Data de sfârșit');
  if ((from === undefined) !== (to === undefined) || (from && to && from > to)) {
    throw new Error('Perioada statisticilor este invalidă.');
  }
  const inPeriod = (date: string) => !from || (date >= from && date <= to!);
  const pennies = (amount: number) => Math.round(amount * 100);
  const sum = <T>(rows: T[], amount: (row: T) => number) => rows.reduce((total, row) => total + pennies(amount(row)), 0) / 100;
  const activeInvoices = vault.invoices.filter(invoice => invoice.status !== 'cancelled');
  const activeNotes = vault.creditNotes.filter(note => note.status === 'issued' && inPeriod(note.issueDate));
  const activePayments = vault.payments.filter(payment => !payment.reversedAt && inPeriod(payment.paymentDate));
  const applications = new Map<string, number>();
  for (const entry of vault.creditApplications) {
    if (!entry.reversedAt) applications.set(entry.invoiceId, (applications.get(entry.invoiceId) || 0) + pennies(entry.amount));
  }
  const financials = (issuer?: ProtectedIssuerCode) => {
    const invoices = activeInvoices.filter(invoice => !issuer || invoice.issuerCode === issuer);
    return {
      invoiced: sum(invoices.filter(invoice => inPeriod(invoice.invoiceDate)), invoice => invoice.totalAmount),
      credited: sum(activeNotes.filter(note => !issuer || note.issuerCode === issuer), note => note.totalAmount),
      paid: sum(activePayments.filter(payment => !issuer || payment.issuerCode === issuer), payment => payment.amount),
      availableCredit: sum(vault.creditEntries.filter(entry => !issuer || entry.issuerCode === issuer), entry => entry.availableAmount),
      outstanding: invoices.reduce((total, invoice) => total + Math.max(0, pennies(invoice.totalAmount) - pennies(invoice.paidAmount) - pennies(invoice.creditedAmount) - (applications.get(invoice.id) || 0)), 0) / 100,
    };
  };
  return {
    mode: vault.mode, liveStartedAt: vault.liveStartedAt, counters: vault.counters,
    assignedCompanies: vault.assignments.length,
    invoices: activeInvoices.filter(invoice => inPeriod(invoice.invoiceDate)).length,
    ...financials(),
    byIssuer: { goodness: financials('goodness'), vatra: financials('vatra') },
  };
}

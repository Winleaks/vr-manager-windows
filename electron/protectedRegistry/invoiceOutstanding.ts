import type { ProtectedInvoice, ProtectedRegistryVault } from './types.ts';

const pennies = (value: number) => Math.round(value * 100);

/** Only the authoritative private vault is accepted; no normal-registry lookup. */
export function protectedInvoiceOutstanding(vault: ProtectedRegistryVault, invoice: ProtectedInvoice) {
  const applications = new Map<string, number>();
  for (const entry of vault.creditApplications) {
    if (!entry.reversedAt) applications.set(entry.invoiceId, (applications.get(entry.invoiceId) || 0) + pennies(entry.amount));
  }
  const sameStore = (row: ProtectedInvoice) => {
    if (row.id === invoice.id) return true;
    if (row.storeExternalId && invoice.storeExternalId) return row.storeExternalId === invoice.storeExternalId;
    return row.storeId != null && invoice.storeId != null && row.storeId === invoice.storeId;
  };
  const rows = vault.invoices
    .filter(row => row.status !== 'cancelled' && row.companyKey === invoice.companyKey &&
      row.issuerCode === invoice.issuerCode && row.testDocument === invoice.testDocument && sameStore(row))
    .map(row => {
      const applied = applications.get(row.id) || 0;
      const outstanding = Math.max(0, pennies(row.totalAmount) - pennies(row.paidAmount) - pennies(row.creditedAmount) - applied);
      return { invoice_number: row.reference, invoice_date: row.invoiceDate, grossAmount: row.totalAmount,
        cashPaid: row.paidAmount, creditedAmount: row.creditedAmount, appliedCredit: applied / 100, outstanding: outstanding / 100 };
    })
    .filter(row => row.outstanding > 0)
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.invoice_number.localeCompare(b.invoice_number, 'en', { numeric: true }));
  return { total: rows.reduce((sum, row) => sum + pennies(row.outstanding), 0) / 100, rows };
}

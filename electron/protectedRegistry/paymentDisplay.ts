import type { ProtectedRegistryVault } from './types.ts';

// Resolve historical recipients from the protected vault, never the normal ledger.
export function protectedPaymentDisplay(vault: ProtectedRegistryVault) {
  return [...vault.payments].sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.createdAt.localeCompare(a.createdAt)).map(payment => {
    const invoice = vault.invoices.find(row => row.id === payment.invoiceId && row.companyKey === payment.companyKey && row.issuerCode === payment.issuerCode);
    const assignment = vault.assignments.find(row => row.companyKey === payment.companyKey);
    const historical = invoice || vault.invoices.find(row => row.companyKey === payment.companyKey);
    return { ...payment, companyId: assignment?.localCompanyId ?? historical?.companyId,
      companyName: invoice?.companyName || assignment?.companyName || historical?.companyName || 'Companie istorică neidentificată',
      invoiceReference: invoice?.reference || null, storeName: invoice?.storeName || null };
  });
}

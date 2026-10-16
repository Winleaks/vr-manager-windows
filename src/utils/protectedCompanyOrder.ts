interface RegistryCompany {
  companyKey: string;
  name: string;
  assigned: boolean;
}

interface RegistryInvoice {
  companyKey: string;
  status: string;
  outstanding: number;
}

const names = new Intl.Collator('ro-RO', { sensitivity: 'base', numeric: true });

/** Use the authoritative invoice remainder, including already applied credits. */
export function orderProtectedCompanies<T extends RegistryCompany>(companies: T[], invoices: RegistryInvoice[]) {
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    if (invoice.status === 'cancelled') continue;
    if (!Number.isFinite(invoice.outstanding) || invoice.outstanding < 0) {
      throw new Error('Soldurile clienților nu au putut fi citite. Reîncearcă încărcarea.');
    }
    totals.set(invoice.companyKey, (totals.get(invoice.companyKey) || 0) + Math.round(invoice.outstanding * 100));
  }
  return companies.map(company => ({ ...company, outstanding: (totals.get(company.companyKey) || 0) / 100 }))
    .sort((a, b) => Number(b.assigned) - Number(a.assigned)
      || (a.assigned ? b.outstanding - a.outstanding : 0)
      || names.compare(a.name, b.name)
      || a.companyKey.localeCompare(b.companyKey));
}

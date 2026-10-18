import { requireIsoDate, requireText } from '../database/businessValidation.ts';
import { statementStoreKey, type ProtectedStatementInput } from '../../src/shared/protectedStatement.ts';
import type { ProtectedRegistryVault } from './types.ts';

export function validateProtectedStatement(input: ProtectedStatementInput): ProtectedStatementInput {
  const companyKey = requireText(input?.companyKey, 'Compania', 200);
  if (input?.issuerCode !== 'goodness' && input?.issuerCode !== 'vatra') throw Error('Selectează emitentul.');
  if (!['open', 'print', 'share'].includes(input?.action)) throw Error('Acțiunea documentului este invalidă.');
  const from = requireIsoDate(input?.from, 'De la'), to = requireIsoDate(input?.to, 'Până la');
  if (from > to) throw Error('Perioada este inversată.');
  const storeInvoiceId = input.storeInvoiceId === null ? null : requireText(input.storeInvoiceId, 'Magazinul', 100);
  return { companyKey, issuerCode: input.issuerCode, storeInvoiceId, from, to, action: input.action };
}

/** Current active ledger, like the normal statement; no SQLite or mutations.
 * A store statement is an allocated invoice account. Excess settlements are
 * moved out to the company account, and applications move company credit in.
 * The company statement includes original cash/CNs, never these internal moves.
 */
export function protectedStatementReport(vault: ProtectedRegistryVault, input: ProtectedStatementInput) {
  const scope = validateProtectedStatement(input);
  const test = vault.mode === 'test';
  const belongs = (row: { companyKey: string; issuerCode: string }) => row.companyKey === scope.companyKey && row.issuerCode === scope.issuerCode;
  const all = vault.invoices.filter(row => belongs(row) && row.testDocument === test);
  const anchor = scope.storeInvoiceId === null ? undefined : all.find(row => row.id === scope.storeInvoiceId);
  if (scope.storeInvoiceId !== null && !anchor) throw Error('Magazinul nu aparține companiei și emitentului selectat.');
  const assignment = vault.assignments.find(row => row.companyKey === scope.companyKey);
  if (!assignment && !all.length) throw Error('Compania nu există în registrul separat.');
  const invoices = all.filter(row => row.status !== 'cancelled' && (!anchor || statementStoreKey(row) === statementStoreKey(anchor)));
  const byId = new Map(invoices.map(row => [row.id, row]));
  const pennies = (value: number) => {
    if (!Number.isFinite(value) || value < 0) throw Error('Valoare financiară invalidă în registru.');
    return Math.round(value * 100);
  };
  type Entry = { date: string; kind: string; reference: string; debit: number; credit: number; id: string; store_name: string; invoiceId?: string; order: number };
  const entries: Entry[] = [];
  for (const invoice of invoices) entries.push({ date: invoice.invoiceDate, kind: 'Invoice', reference: invoice.reference, debit: pennies(invoice.totalAmount), credit: 0, id: invoice.id, store_name: invoice.storeName, invoiceId: invoice.id, order: 0 });
  for (const note of vault.creditNotes.filter(row => belongs(row) && row.testDocument === test && row.status === 'issued')) {
    if (!anchor) entries.push({ date: note.issueDate, kind: 'Credit Note', reference: note.reference, debit: 0, credit: pennies(note.totalAmount), id: note.id, store_name: '', order: 1 });
    else for (const invoice of invoices) {
      const credit = note.items.filter(item => item.sourceInvoiceId === invoice.id).reduce((sum, item) => sum + pennies(item.totalPrice), 0);
      if (credit) entries.push({ date: note.issueDate, kind: 'Credit Note', reference: `${note.reference} / ${invoice.reference}`, debit: 0, credit, id: `${note.id}:${invoice.id}`, store_name: invoice.storeName, invoiceId: invoice.id, order: 1 });
    }
  }
  for (const payment of vault.payments.filter(row => belongs(row) && row.testEntry === test && !row.reversedAt)) {
    const invoice = payment.invoiceId ? byId.get(payment.invoiceId) : undefined;
    if (anchor && !invoice) continue;
    entries.push({ date: payment.paymentDate, kind: 'Payment', reference: `${invoice?.reference || (payment.invoiceId ? all.find(row => row.id === payment.invoiceId)?.reference || 'Invoice' : 'Advance')} / ${payment.method}`, debit: 0, credit: pennies(payment.amount), id: payment.id, store_name: invoice?.storeName || '', invoiceId: invoice?.id, order: 2 });
  }
  if (anchor) for (const application of vault.creditApplications.filter(row => belongs(row) && row.testEntry === test && !row.reversedAt)) {
    const invoice = byId.get(application.invoiceId);
    if (invoice) entries.push({ date: application.createdAt.slice(0, 10), kind: 'Credit applied', reference: invoice.reference, debit: 0, credit: pennies(application.amount), id: application.id, store_name: invoice.storeName, invoiceId: invoice.id, order: 3 });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id));
  const allocated: Entry[] = [];
  const invoiceBalances = new Map<string, number>();
  for (const entry of entries.filter(row => row.date <= scope.to)) {
    allocated.push(entry);
    if (anchor && entry.invoiceId) {
      const balance = (invoiceBalances.get(entry.invoiceId) || 0) + entry.debit - entry.credit;
      if (balance < 0) allocated.push({ ...entry, id: `${entry.id}:transfer`, kind: 'Excess to company account', debit: -balance, credit: 0 });
      invoiceBalances.set(entry.invoiceId, Math.max(0, balance));
    }
  }
  let balance = allocated.filter(row => row.date < scope.from).reduce((sum, row) => sum + row.debit - row.credit, 0);
  const opening = balance / 100;
  const rows = allocated.filter(row => row.date >= scope.from).map(row => {
    balance += row.debit - row.credit;
    return { ...row, debit: row.debit / 100, credit: row.credit / 100, balance: balance / 100 };
  });
  return {
    company: { name: all[0]?.companyName || assignment!.companyName },
    issuer: { legal_name: scope.issuerCode === 'goodness' ? 'THE GOODNESS BAKER LTD' : 'VATRA ROMANEASCA LTD' },
    from: scope.from, to: scope.to, opening, closing: balance / 100, rows, legacyCredit: 0,
    scopeLabel: `${test ? 'TEST / ' : ''}Separate register / ${anchor ? `Store: ${anchor.storeName}` : 'All stores'}`,
    accountNote: anchor ? 'Store account: includes applied credit. Unallocated advances and excess settlements belong to the company account.' : undefined,
  };
}

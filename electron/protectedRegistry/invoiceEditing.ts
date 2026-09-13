import { createHash, randomUUID } from 'node:crypto';
import type { ProtectedInvoiceEditInput } from '../../src/shared/protectedInvoiceEdit.ts';
import type { ProtectedInvoice, ProtectedInvoiceItem, ProtectedRegistryVault } from './types.ts';
import { requireText } from '../database/businessValidation.ts';

export function protectedInvoiceVersion(invoice: ProtectedInvoice) {
  return createHash('sha256').update(JSON.stringify(invoice)).digest('hex');
}

export function protectedInvoiceEditBlock(vault: ProtectedRegistryVault, invoice: ProtectedInvoice) {
  if (invoice.status === 'cancelled' || invoice.replacedByInvoiceId) return 'Factura anulată sau înlocuită nu poate fi editată.';
  if (invoice.creditedAmount > 0.005 || vault.creditNotes.some(note => note.status === 'issued' && note.sourceInvoiceIds.includes(invoice.id))) return 'Factura are Credit Notes emise și nu poate fi editată.';
  if (vault.creditApplications.some(entry => entry.invoiceId === invoice.id && !entry.reversedAt)) return 'Factura are credit aplicat. Reversează aplicarea înainte de editare.';
  return null;
}

export function validateProtectedInvoiceEdit(input: ProtectedInvoiceEditInput): ProtectedInvoiceEditInput {
  const invoiceId = requireText(input?.invoiceId, 'Factura', 100);
  const expectedVersion = requireText(input?.expectedVersion, 'Versiunea facturii', 64);
  if (!/^[a-f0-9]{64}$/.test(expectedVersion)) throw Error('Versiunea facturii este invalidă. Redeschide editorul.');
  const operationId = requireText(input?.operationId, 'Operația', 100);
  if (!/^[\w-]{16,100}$/.test(operationId)) throw Error('Operația este invalidă.');
  const invoiceDate = requireText(input?.invoiceDate, 'Data', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) || !Number.isFinite(Date.parse(invoiceDate)) || new Date(invoiceDate).toISOString().slice(0, 10) !== invoiceDate) throw Error('Data facturii este invalidă.');
  if (!Array.isArray(input?.items) || !input.items.length || input.items.length > 1000) throw Error('Factura trebuie să conțină între 1 și 1000 de poziții.');
  const seen = new Set<string>();
  const items = input.items.map(line => {
    const id = line.id === undefined ? undefined : requireText(line.id, 'Poziția', 100);
    if (id && seen.has(id)) throw Error('Poziție repetată.');
    if (id) seen.add(id);
    if (!id && (!Number.isSafeInteger(line.productId) || Number(line.productId) <= 0)) throw Error('Produsul este invalid.');
    const remove = line.remove === true;
    if (remove && (!id || line.quantity !== 0)) throw Error('Eliminarea poziției este invalidă.');
    if (typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity < 0 || (!remove && line.quantity === 0) || line.quantity > 1_000_000) throw Error('Cantitatea trebuie să fie mai mare decât zero.');
    if (typeof line.unitPrice !== 'number' || !Number.isFinite(line.unitPrice) || line.unitPrice < 0 || line.unitPrice > 1_000_000) throw Error('Prețul este invalid.');
    return { ...(id ? { id } : { productId: line.productId }), quantity: line.quantity, unitPrice: Math.round((line.unitPrice + Number.EPSILON) * 100) / 100,
      ...(line.productName !== undefined ? { productName: requireText(line.productName, 'Denumirea', 300) } : {}), ...(remove ? { remove: true } : {}) };
  });
  return { invoiceId, expectedVersion, operationId, invoiceDate, items };
}

const requestHash = (request: ProtectedInvoiceEditInput) => createHash('sha256').update(JSON.stringify(request)).digest('hex');
export function protectedInvoiceEditReplay(vault: ProtectedRegistryVault, request: ProtectedInvoiceEditInput) {
  const audit = vault.audit.find(entry => entry.operationId === request.operationId && entry.eventType === 'protected_invoice_edit_details');
  if (!audit) return false;
  if (audit.resourceId !== request.invoiceId || audit.details.requestHash !== requestHash(request)) throw Error('Identificatorul operației a fost utilizat cu alte date.');
  return true;
}

export function applyProtectedInvoiceEdit(vault: ProtectedRegistryVault, request: ProtectedInvoiceEditInput,
  resolveProduct: (id: number) => Omit<ProtectedInvoiceItem, 'id' | 'quantity' | 'unitPrice' | 'totalPrice'>) {
  const invoice = vault.invoices.find(row => row.id === request.invoiceId);
  if (!invoice) throw Error('Factura nu există în registrul separat.');
  if (protectedInvoiceEditReplay(vault, request)) return invoice;
  const blocked = protectedInvoiceEditBlock(vault, invoice);
  if (blocked) throw Error(blocked);
  if (protectedInvoiceVersion(invoice) !== request.expectedVersion) throw Error('Factura a fost modificată între timp. Redeschide editorul pentru datele actuale.');
  const imported = invoice.sourceOrderIds.length > 0;
  if (imported && invoice.items.some(item => !request.items.some(line => line.id === item.id))) throw Error('Pozițiile importate trebuie păstrate sau eliminate explicit cu cantitate zero.');
  const items = request.items.flatMap(line => {
    const existing = line.id ? invoice.items.find(item => item.id === line.id) : undefined;
    if (line.id && !existing) throw Error('Poziția nu aparține acestei facturi.');
    if (line.remove) return [];
    const base = existing || { ...resolveProduct(line.productId!), id: randomUUID() };
    return [{ ...base, productName: existing && !imported && line.productName ? line.productName : base.productName,
      quantity: line.quantity, unitPrice: line.unitPrice, totalPrice: Math.round(line.quantity * line.unitPrice * 100) / 100 }];
  });
  if (!items.length) throw Error('Factura trebuie să păstreze cel puțin o poziție.');
  const total = Math.round(items.reduce((sum, item) => sum + item.totalPrice, 0) * 100) / 100;
  if (!Number.isSafeInteger(Math.round(total * 100)) || total > 1_000_000_000) throw Error('Totalul facturii depășește limita permisă.');
  if (total + 0.005 < invoice.paidAmount) throw Error('Totalul nu poate fi mai mic decât încasările păstrate. Reversează întâi încasarea afectată.');
  const before = { invoiceDate: invoice.invoiceDate, items: invoice.items, totalAmount: invoice.totalAmount };
  invoice.invoiceDate = request.invoiceDate; invoice.items = items; invoice.totalAmount = total;
  invoice.status = invoice.paidAmount >= total - 0.005 ? 'paid' : invoice.paidAmount > 0.005 ? 'partial' : 'unpaid';
  vault.audit.push({ id: randomUUID(), eventType: 'protected_invoice_edit_details', resourceType: 'invoice', resourceId: invoice.id,
    operationId: request.operationId, details: { requestHash: requestHash(request), before, after: { invoiceDate: invoice.invoiceDate, items, totalAmount: total } }, createdAt: new Date().toISOString() });
  return invoice;
}

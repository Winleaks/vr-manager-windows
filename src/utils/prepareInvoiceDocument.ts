import { api } from '../shared/api';
import { generateInvoicePDF } from './pdfGenerator';

// Read SQLite again: an imported order can be older than a manual correction.
export function prepareInvoiceDocument(invoiceId: number, uploadCloud?: false): Promise<Uint8Array>;
export function prepareInvoiceDocument(invoiceId: number, uploadCloud: boolean): Promise<Uint8Array | boolean>;
export async function prepareInvoiceDocument(invoiceId: number, uploadCloud = false) {
  const [invoice, sharedSettings] = await Promise.all([
    api.billing.getInvoice(invoiceId), api.billing.getSettings(),
  ]);
  if (invoice.status === 'cancelled') throw new Error('Factura este anulată.');
  if (!invoice.issuer_settings) throw new Error('Snapshotul emitentului facturii lipsește.');
  const buffer = generateInvoicePDF(
    { ...invoice.issuer_settings, invoiceLogo: sharedSettings.invoiceLogo },
    {
      invoiceNumber: invoice.invoice_number, invoiceDate: invoice.invoice_date,
      client: {
        name: invoice.company_name || invoice.client_name || invoice.store_name,
        cui: invoice.company_cui, regCom: invoice.company_reg_com,
        address: invoice.company_address || invoice.store_address,
      },
      store: { name: invoice.store_name, address: invoice.store_address, postcode: invoice.store_postcode, phone: invoice.store_phone },
      items: invoice.items, totalAmount: invoice.total_amount,
    },
  );
  const local = await api.system.savePdfAuto({ invoiceId, buffer });
  if (!local.success) throw new Error(local.error || 'PDF-ul nu a putut fi salvat local.');
  if (uploadCloud) return (await api.system.uploadPdfToCloud(invoiceId, buffer)).success;
  return buffer;
}

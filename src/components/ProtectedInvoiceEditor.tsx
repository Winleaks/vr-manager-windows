import { useMemo, useRef } from 'react';
import { api } from '../shared/api';
import { InvoiceEditorModal, type InvoiceEditorAdapter } from './InvoiceEditorModal';

export function ProtectedInvoiceEditor({ invoiceId, run, onClose, onSaved }: {
  invoiceId: string;
  run: <T>(action: () => Promise<T>) => Promise<T>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const request = useRef<{ payload: string; operationId: string } | null>(null);
  const adapter = useMemo<InvoiceEditorAdapter>(() => ({
    getInvoice: async () => {
      const row = await api.protectedRegistry.getInvoiceForEdit(invoiceId);
      return { ...row, invoice_number: row.reference, invoice_date: row.invoiceDate, company_name: row.companyName,
        store_name: row.storeName, issuer_name: row.issuerSnapshot.issuerName, paid_amount: row.paidAmount,
        is_imported: row.sourceOrderIds.length > 0, items: row.items.map(item => ({ ...item, name_ro: item.productNameRo })) };
    },
    getProducts: verify => api.protectedRegistry.getInvoiceProducts(invoiceId, verify),
    save: async (data, current) => {
      const payload = JSON.stringify({ invoiceId, expectedVersion: current.expectedVersion, ...data });
      if (request.current?.payload !== payload) request.current = { payload, operationId: crypto.randomUUID() };
      const result = await run(() => api.protectedRegistry.updateInvoice({ invoiceId, expectedVersion: current.expectedVersion,
        ...data, operationId: request.current!.operationId }));
      return { invoice: result.invoice, message: result.pdf.pending ? 'Modificările sunt salvate temporar și criptat pe Writer. Factura și PDF-ul se sincronizează în fundal.' : result.pdf.success ? 'Factura și PDF-ul au fost actualizate în registrul separat, în Google Drive.' : result.pdf.error || 'Factura este salvată. Reîncearcă pregătirea PDF-ului.' };
    },
  }), [invoiceId, run]);
  return <InvoiceEditorModal invoiceId={invoiceId} adapter={adapter} onClose={onClose} onSaved={(_invoice, message) => onSaved(message)} />;
}

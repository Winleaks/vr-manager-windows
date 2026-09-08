// Synthetic renderer-only fixture. No Electron process, real DB or external API.
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FeedbackHost } from '../../src/components/FeedbackHost';
import { confirmAction, notify } from '../../src/utils/feedback';
import { NumericInput } from '../../src/components/NumericInput';
import '../../src/index.css';

const calls: unknown[] = [];
const role = new URLSearchParams(location.search).get('role') || 'writer';
const invoice = {
  id: 1, company_id: 1, issuer_id: 1, invoice_number: 'TEST-1', invoice_date: '2026-01-01',
  company_name: 'Fixture Company', store_name: 'Fixture Store', issuer_name: 'Fixture Issuer',
  grossAmount: 25, creditedAmount: 0, outstanding: 25, status: 'unpaid',
  items: [{ id: 1, productName: 'Fixture Product', quantity: 10, unitPrice: 2.5,
    remainingQuantity: 10, remainingValue: 25, canReturnToStock: true }],
};
const company = { id: 1, name: 'Fixture Company', stores: [{ id: 1, name: 'Fixture Store' }] };
const documentStatus={pending:1,blocked:1,running:false,workerError:null,canRetry:role==='writer',connected:true,
  items:[{kind:'invoice',document_id:1,state:'blocked',attempts:1,last_error:'Drive refuză accesul la documente.',reference:'TEST-1'}]};
const protectedInvoice = {
  id: 'fixture-invoice', reference: 'TEST-P1', companyKey: 'fixture-company', issuerCode: 'goodness',
  companyName: 'Fixture Company', storeName: 'Fixture Store',
  items: [{ id: 'fixture-line', productName: 'Fixture Product', quantity: 10, creditedQuantity: 0, unitPrice: 2.5, finishedProductId: 1 }],
};
window.desktopApi = {
  system: { getDeviceRole: async () => ({ role }),
    getDocumentSyncStatus:async()=>structuredClone(documentStatus),
    retryDocumentSync:async()=>{calls.push('retry-documents');return structuredClone(documentStatus)},
  },
  billing: {
    getCreditNotes: async () => [], getCreditNoteDraft: async () => [invoice],
    getIssuers: async () => [{ id: 1, legal_name: 'Fixture Issuer' }],
    getAllCompaniesAndStores: async () => [company],
    getInvoice: async () => invoice, getInvoiceProducts: async () => [],
    createCreditNote: async (payload: unknown) => { calls.push(payload); return { creditNoteId: 1, reference: 'TEST-CN1' }; },
    prepareCreditNotePdf: async () => ({ success: true }),
  },
  drivers: { getAll: async () => [] }, employees: { getAll: async () => [] },
  protectedRegistry: {
    status: async () => ({ unlocked: true }), getOverview: async () => ({ mode: 'test' }),
    lock: async () => {}, touch: async () => {}, getCreditNotes: async () => [],
    getCreditNoteDraft: async () => [protectedInvoice],
    createCreditNote: async (payload: unknown) => { calls.push(payload); return { creditNote: { reference: 'TEST-PCN1' }, pdf: { success: true } }; },
  },
} as any;

const [{ BillingCreditNotes }, { ProtectedRegistry }, { BillingClients }, { InvoiceEditorModal }, { SettingsEntities }, { DocumentSyncBanner }] = await Promise.all([
  import('../../src/pages/BillingCreditNotes'), import('../../src/pages/ProtectedRegistry'),
  import('../../src/pages/BillingClients'), import('../../src/components/InvoiceEditorModal'),
  import('../../src/pages/SettingsEntities'),
  import('../../src/components/DocumentSyncBanner'),
]);

export function Harness() {
  const [quantity, setQuantity] = useState('10');
  const [price, setPrice] = useState('2.50');
  const [confirmation, setConfirmation] = useState('none');
  const testCase = new URLSearchParams(location.search).get('case');
  return <>
    {testCase === 'sync' ? <DocumentSyncBanner /> : null}
    {testCase !== 'protected' && <>
      <FeedbackHost />
      <div className="flex gap-3 p-3">
        <button onClick={() => notify('Mesaj de test — fără dialog nativ')}>Notificare test</button>
        <button onClick={async () => setConfirmation(String(await confirmAction('Confirmare de test, fără modificări reale?')))}>Confirmare test</button>
        <output data-testid="confirmation-result">{confirmation}</output>
      </div>
    </>}
    {testCase === 'credit' ? <BillingCreditNotes />
      : testCase === 'protected' ? <ProtectedRegistry />
        : testCase === 'clients' ? <BillingClients />
          : testCase === 'editor' ? <InvoiceEditorModal invoiceId={1} onClose={() => {}} onSaved={() => {}} />
            : testCase === 'settings' ? <SettingsEntities />
              : <div className="p-6 flex gap-4">
                <NumericInput aria-label="Cantitate test" decimalScale={3} value={quantity} onValueChange={setQuantity} />
                <NumericInput aria-label="Preț test" value={price} onValueChange={setPrice} />
              </div>}
  </>;
}
(window as any).__inputTest = { calls, notify, confirmAction, setDocumentStatus:(value:unknown)=>Object.assign(documentStatus,value) };
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);

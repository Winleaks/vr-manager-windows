// Synthetic renderer-only fixture. No Electron process, real DB or external API.
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { FeedbackHost } from '../../src/components/FeedbackHost';
import { confirmAction, notify } from '../../src/utils/feedback';
import { NumericInput } from '../../src/components/NumericInput';
import '../../src/index.css';

const calls: unknown[] = [];
let recoveryFailure = false;
const role = new URLSearchParams(location.search).get('role') || 'writer';
let protectedUnlocked = !new URLSearchParams(location.search).has('activation');
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
  id: 'fixture-invoice', reference: 'TEST-P1', companyId: 1, storeId: 1, companyKey: 'fixture-company', issuerCode: 'goodness',
  invoiceDate: '2026-09-13', totalAmount: 25, outstanding: 15, paidAmount: 10, creditedAmount: 0, status: 'partial',
  companyName: 'Fixture Company', storeName: 'Fixture Store',
  items: [{ id: 'fixture-line', productName: 'Fixture Product', quantity: 10, creditedQuantity: 0, unitPrice: 2.5, finishedProductId: 1 }],
};
window.desktopApi = {
  system: { getDeviceRole: async () => ({ role }),
    getDocumentSyncStatus:async()=>structuredClone(documentStatus),
    retryDocumentSync:async()=>{calls.push('retry-documents');return structuredClone(documentStatus)},
  },
  billing: {
    getSettings: async () => ({}),
    getCreditNotes: async () => [], getCreditNoteDraft: async () => [invoice],
    getIssuers: async () => [{ id: 1, legal_name: 'Fixture Issuer' }],
    getAllCompaniesAndStores: async () => [company],
    getInvoice: async () => invoice, getInvoiceProducts: async () => [],
    createCreditNote: async (payload: unknown) => { calls.push(payload); return { creditNoteId: 1, reference: 'TEST-CN1' }; },
    prepareCreditNotePdf: async () => ({ success: true }),
  },
  drivers: { getAll: async () => [] }, employees: { getAll: async () => [] },
  protectedRegistry: {
    rotateRecoveryKey: async (pin: string, confirmed: boolean) => {
      calls.push('rotate-recovery');
      await new Promise(resolve => setTimeout(resolve, 250));
      if (pin !== '482719' || !confirmed) throw new Error('PIN-ul actual este incorect.');
      if (recoveryFailure) throw new Error('Confirmarea Drive a eșuat (test sintetic).');
      return { success: true, recoveryKey: 'SYNTHETIC-RECOVERY-TEST-ONLY' };
    },
    status: async () => ({ unlocked: protectedUnlocked, readOnly: role === 'viewer', configured: true, needsRecovery: !protectedUnlocked, secureStorageAvailable: true }), getOverview: async () => ({ mode: 'test' }),
    activateViewer: async () => { calls.push('activate-viewer'); protectedUnlocked = true; },
    refreshViewer: async () => ({ success: true, revision: 1 }),
    openDocument: async () => { calls.push('protected-open'); return { success: true }; },
    shareDocument: async () => { calls.push('protected-share'); return { success: true }; },
    printDocument: async () => { calls.push('protected-print'); return { success: true }; },
    lock: async () => {}, touch: async () => {}, getCreditNotes: async () => [],
    getCreditNoteDraft: async () => [protectedInvoice],
    getCompanies: async () => [{ ...company, assigned: true, companyKey: 'fixture-company' }, { id: 2, name: 'Other Company', stores: [], assigned: true, companyKey: 'other' }],
    getInvoices: async () => [protectedInvoice, { ...protectedInvoice, id: 'other-invoice', reference: 'OTHER-2', companyId: 2, companyKey: 'other', companyName: 'Other Company' }],
    getPayments: async () => [{ id: 'p1', companyId: 1, companyKey: 'fixture-company', companyName: 'Fixture Company', invoiceId: protectedInvoice.id, invoiceReference: 'TEST-P1', storeName: 'Fixture Store', issuerCode: 'goodness', method: 'cash', paymentDate: '2026-09-13', amount: 10 }],
    getCreditBalances: async () => [{ companyId: 1, companyKey: 'fixture-company', issuerCode: 'goodness', available: 5 }],
    getCreditApplications: async () => [],
    getInvoiceForEdit: async () => ({ ...protectedInvoice, issuerSnapshot: { issuerName: 'THE GOODNESS BAKER LTD' }, sourceOrderIds: [], expectedVersion: 'fixture-version' }),
    getInvoiceProducts: async () => [],
    createCreditNote: async (payload: unknown) => { calls.push(payload); return { creditNote: { reference: 'TEST-PCN1' }, pdf: { success: true } }; },
  },
} as any;

if (new URLSearchParams(location.search).has('navigation')) {
  const companies = Array.from({ length: 80 }, (_, index) => ({ ...company, id: index + 1,
    name: `Fixture Company ${String(index + 1).padStart(2, '0')}`, assigned: true, companyKey: `company-${index + 1}` }));
  const invoices = Array.from({ length: 80 }, (_, index) => ({ ...invoice, id: index + 1,
    invoice_number: `TEST-${index + 1}`, total_amount: 25, paid_amount: 0 }));
  const protectedInvoices = invoices.map(row => ({ ...protectedInvoice, id: String(row.id),
    reference: row.invoice_number, companyId: 40, companyKey: 'company-40', companyName: companies[39].name }));
  const delayed = async <T,>(value: T) => { await new Promise(resolve => setTimeout(resolve, 150)); return structuredClone(value); };
  Object.assign(window.desktopApi.billing, {
    getAllCompaniesAndStores: () => delayed(companies), getInvoices: () => delayed(invoices),
    getTestMode: async () => ({ enabled: false }),
    getCompanyProfile: (id: number) => delayed({ company: companies[id - 1], stores: company.stores,
      invoices, payments: [], issuers: [{ id: 1, legal_name: 'Fixture Issuer' }] }),
    getInvoice: (id: number) => delayed(invoices[id - 1]), getSettings: async () => ({}),
    updateInvoice: async (input: { id: number }) => ({ invoice: invoices[input.id - 1] }),
  });
  Object.assign(window.desktopApi.protectedRegistry, {
    unlock: async () => {},
    getCompanies: () => delayed(companies), getInvoices: () => delayed(protectedInvoices),
  });
  if (new URLSearchParams(location.search).get('case') === 'navigation') location.hash = '/facturare/clienti';
}

const [{ BillingCreditNotes }, { ProtectedRegistry }, { BillingClients }, { InvoiceEditorModal }, { SettingsEntities }, { DocumentSyncBanner }, { BillingLayout }] = await Promise.all([
  import('../../src/pages/BillingCreditNotes'), import('../../src/pages/ProtectedRegistry'),
  import('../../src/pages/BillingClients'), import('../../src/components/InvoiceEditorModal'),
  import('../../src/pages/SettingsEntities'),
  import('../../src/components/DocumentSyncBanner'),
  import('../../src/pages/BillingLayout'),
]);

export function Harness() {
  const [quantity, setQuantity] = useState('10');
  const [price, setPrice] = useState('2.50');
  const [confirmation, setConfirmation] = useState('none');
  const testCase = new URLSearchParams(location.search).get('case');
  if (testCase === 'navigation') return <HashRouter><Routes><Route path="/facturare/*" element={<BillingLayout />} /></Routes></HashRouter>;
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
(window as any).__inputTest = { calls, notify, confirmAction, setDocumentStatus:(value:unknown)=>Object.assign(documentStatus,value), setRecoveryFailure:(value:boolean)=>{recoveryFailure=value;} };
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);

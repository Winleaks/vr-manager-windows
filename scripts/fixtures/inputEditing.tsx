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
const overviewCalls: { from?: string; to?: string }[] = [];
let overviewFailure = false;
async function dashboardOverview(from?: string, to?: string) {
  if (arguments.length === 2) overviewCalls.push({ from, to });
  const fail = overviewFailure;
  await new Promise(resolve => setTimeout(resolve, from ? 30 : 250));
  if (fail) throw new Error('Statistici indisponibile (test sintetic).');
  const invoiced = !from ? 999 : (Date.parse(to!) - Date.parse(from)) / 86400000 === 6 ? 70 : 120;
  const values = { invoiced: invoiced / 2, credited: 2, paid: 4, availableCredit: 3, outstanding: 400 };
  return { mode: 'test', counters: {}, assignedCompanies: 1, invoices: 2, invoiced, credited: 4, paid: 8, availableCredit: 6, outstanding: 800,
    byIssuer: { goodness: values, vatra: values } };
}
const role = new URLSearchParams(location.search).get('role') || 'writer';
let protectedUnlocked = !new URLSearchParams(location.search).has('activation');
const protectedSync = { state: 'synced', pending: 0, error: null as string | null };
const invoice = {
  id: 1, company_id: 1, store_id: 1, issuer_id: 1, invoice_number: 'TEST-1', invoice_date: '2026-01-01',
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
    getManualInvoiceCompanies: async () => [{ ...company, issuer_id: 1 }],
    getProducts: async () => [{ id: 1, name: 'Fixture Product', price_standard: 1.95, available: true }],
    getCompanyProfile: async () => ({ company, stores: [...company.stores, { id: 2, name: 'Second Store' }], invoices: [invoice, { ...invoice, id: 2, store_id: 2, invoice_number: 'SECOND-2' }], payments: [], issuers: [] }),
    getInvoice: async () => invoice, getInvoiceProducts: async () => [],
    createCreditNote: async (payload: unknown) => { calls.push(payload); return { creditNoteId: 1, reference: 'TEST-CN1' }; },
    prepareCreditNotePdf: async () => ({ success: true }),
  },
  drivers: { getAll: async () => [] }, employees: { getAll: async () => [] },
  protectedRegistry: {
    syncStatus: async () => structuredClone(protectedSync),
    retrySync: async () => { calls.push('retry-protected-sync'); protectedSync.state = 'syncing'; protectedSync.error = null; return structuredClone(protectedSync); },
    rotateRecoveryKey: async (pin: string, confirmed: boolean) => {
      calls.push('rotate-recovery');
      await new Promise(resolve => setTimeout(resolve, 250));
      if (pin !== '482719' || !confirmed) throw new Error('PIN-ul actual este incorect.');
      if (recoveryFailure) throw new Error('Confirmarea Drive a eșuat (test sintetic).');
      return { success: true, recoveryKey: 'SYNTHETIC-RECOVERY-TEST-ONLY' };
    },
    status: async () => ({ unlocked: protectedUnlocked, readOnly: role === 'viewer', configured: true, needsRecovery: !protectedUnlocked, secureStorageAvailable: true }), getOverview: dashboardOverview,
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

if (new URLSearchParams(location.search).has('payment-edit')) {
  let saved = false;
  let attempt = 0;
  const payment = { id: 1, invoice_id: 1, company_id: 1, issuer_id: 1, invoice_number: 'TEST-1',
    payment_date: '2026-09-21', amount: 82.75, method: 'transfer', bank_name: 'Barclays', edit_revision: 12 };
  const amounts = [200.25, 300.25, 320.25];
  Object.assign(window.desktopApi.billing, {
    getCompanyProfile: async () => ({ company, stores: company.stores, issuers: [{ id: 1, legal_name: 'Fixture Issuer' }],
      invoices: amounts.map((amount, index) => ({ ...invoice, id: index + 1, invoice_number: `TEST-${index + 1}`,
        total_amount: amount, grossAmount: amount, netAmount: amount, paid_amount: saved ? amount : index ? 0 : 82.75,
        outstanding: saved ? 0 : amount - (index ? 0 : 82.75), status: saved ? 'paid' : 'partial' })),
      payments: saved ? amounts.map((amount, index) => ({ ...payment, id: index + 1, invoice_number: `TEST-${index + 1}`, amount, edit_revision: 13 })) : [payment],
    }),
    updatePayment: async (input: unknown) => {
      calls.push(input); saved = true;
      await new Promise(resolve => setTimeout(resolve, 250));
      if (++attempt === 1) throw new Error('Răspuns întrerupt (test sintetic).');
      return { allocations: amounts.map((amount, index) => ({ invoiceId: index + 1, amount })) };
    },
  });
}

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

const [{ BillingCreditNotes }, { ProtectedRegistry }, { BillingClients }, { InvoiceEditorModal }, { SettingsEntities }, { DocumentSyncBanner }, { BillingLayout }, { BillingManualInvoice }] = await Promise.all([
  import('../../src/pages/BillingCreditNotes'), import('../../src/pages/ProtectedRegistry'),
  import('../../src/pages/BillingClients'), import('../../src/components/InvoiceEditorModal'),
  import('../../src/pages/SettingsEntities'),
  import('../../src/components/DocumentSyncBanner'),
  import('../../src/pages/BillingLayout'),
  import('../../src/pages/BillingManualInvoice'),
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
    {testCase === 'manual' ? <BillingManualInvoice /> : testCase === 'credit' ? <BillingCreditNotes />
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
(window as any).__inputTest = { calls, overviewCalls, setProtectedSync:(value:unknown)=>Object.assign(protectedSync,value), setOverviewFailure:(value:boolean)=>{overviewFailure=value;}, notify, confirmAction, setDocumentStatus:(value:unknown)=>Object.assign(documentStatus,value), setRecoveryFailure:(value:boolean)=>{recoveryFailure=value;} };
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);

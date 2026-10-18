import { useRef, useState } from 'react';
import { FileText, Loader2, Printer, Send } from 'lucide-react';
import { api } from '../shared/api';
import { statementStoreKey, type ProtectedStatementInput } from '../shared/protectedStatement';
import type { ProtectedInvoice } from '../../electron/protectedRegistry/types';

export function ProtectedStatementActions({ companyKey, invoices }: { companyKey: string; invoices: ProtectedInvoice[] }) {
  const [issuer, setIssuer] = useState('');
  const [store, setStore] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const stores = new Map<string, ProtectedInvoice>();
  for (const invoice of invoices.filter(row => row.companyKey === companyKey && row.issuerCode === issuer)) {
    const key = statementStoreKey(invoice);
    if (!stores.has(key)) stores.set(key, invoice);
  }
  const options = [...stores.values()].sort((a, b) => a.storeName.localeCompare(b.storeName));
  const selected = options.find(row => statementStoreKey(row) === store);
  const valid = !!issuer && !!from && !!to && from <= to && (!store || !!selected);
  async function run(action: ProtectedStatementInput['action']) {
    if (pending.current || !valid) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await api.protectedRegistry.statementDocument({ companyKey, issuerCode: issuer as ProtectedStatementInput['issuerCode'], storeInvoiceId: selected?.id || null, from, to, action });
      if (!result.success && !result.cancelled) setError(result.error || 'Documentul nu a putut fi pregătit.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Generarea a eșuat.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section aria-label="Statement registru separat" className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
    <h2 className="font-bold">Statement de cont</h2>
    <fieldset disabled={busy} className="flex flex-wrap gap-3 items-end">
      <legend className="sr-only">Alege emitentul, magazinul și perioada</legend>
      <label className="text-sm">Emitent<select aria-label="Emitent" className="block mt-1" value={issuer} onChange={event => { setIssuer(event.target.value); setStore(''); setError(''); }}><option value="">Selectează emitentul</option><option value="goodness">THE GOODNESS BAKER LTD</option><option value="vatra">VATRA ROMANEASCA LTD</option></select></label>
      <label className="text-sm">Magazin<select aria-label="Magazin" className="block mt-1" disabled={!issuer || busy} value={store} onChange={event => setStore(event.target.value)}><option value="">Toate magazinele</option>{options.map(row => <option key={statementStoreKey(row)} value={statementStoreKey(row)}>{row.storeName}</option>)}</select></label>
      <label className="text-sm">De la<input className="block mt-1" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label className="text-sm">Până la<input className="block mt-1" type="date" min={from} value={to} onChange={event => setTo(event.target.value)} /></label>
      {([['open', 'Deschide Statement', FileText], ['print', 'Printează Statement', Printer], ['share', 'Trimite Statement pe WhatsApp', Send]] as const).map(([action, label, Icon]) => <button key={action} type="button" title={label} aria-label={label} disabled={busy || !valid} onClick={() => void run(action)} className="p-3 rounded-lg text-indigo-700 hover:bg-indigo-50 disabled:opacity-40">{busy ? <Loader2 size={19} className="animate-spin" /> : <Icon size={19} />}</button>)}
    </fieldset>
    <p className="text-xs text-slate-500">Sold inițial, facturi, Credit Notes, încasări și sold final. Poți selecta un magazin cu facturi la emitentul ales. Avansurile nealocate apar numai la „Toate magazinele”; raportul pe magazin include creditul aplicat facturilor sale.</p>
    {busy && <p role="status" className="text-sm text-indigo-700">Se pregătește Statement-ul…</p>}
    {error && <p role="alert" className="text-rose-700">{error}</p>}
  </section>;
}

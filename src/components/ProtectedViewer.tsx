import { useCallback, useEffect, useRef, useState } from 'react';
import { Banknote, FileMinus2, LogOut, Receipt, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { api } from '../shared/api';
import { ProtectedInvoiceList } from './ProtectedInvoiceList';
import { ProtectedDocumentActions } from './ProtectedDocumentActions';

const money = (value: number) => `£${Number(value || 0).toFixed(2)}`;
const denied = () => { throw new Error('Viewer — operațiune de modificare indisponibilă.'); };
const navigation = [['invoices', 'Facturi', Receipt], ['payments', 'Istoric Plăți', Banknote], ['notes', 'Credit Notes', FileMinus2], ['clients', 'Clienți & Entități', Users]] as const;

/** Read-only composition: it never mounts Writer forms, settings, or import/catalog flows. */
export function ProtectedViewer({ onLocked }: { onLocked: () => void }) {
  const [tab, setTab] = useState('invoices');
  const [companyKey, setCompanyKey] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ companies: any[]; invoices: any[]; payments: any[]; notes: any[]; balances: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');
  const epoch = useRef(0);
  const unmountLock = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const locked = useRef(onLocked);
  locked.current = onLocked;
  const reload = useCallback(async () => {
    const request = ++epoch.current;
    setLoading(true); setError('');
    try {
      await api.protectedRegistry.refreshViewer();
      const [companies, invoices, payments, notes, balances] = await Promise.all([
        api.protectedRegistry.getCompanies(), api.protectedRegistry.getInvoices(), api.protectedRegistry.getPayments(),
        api.protectedRegistry.getCreditNotes(), api.protectedRegistry.getCreditBalances(),
      ]);
      if (request === epoch.current) { setData({ companies, invoices, payments, notes, balances }); setUpdated(new Date().toLocaleTimeString('ro-RO')); }
    } catch (failure) {
      if (request === epoch.current) { setData(null); setError(failure instanceof Error ? failure.message : 'Registrul nu a putut fi actualizat.'); }
    } finally { if (request === epoch.current) setLoading(false); }
  }, []);
  useEffect(() => {
    clearTimeout(unmountLock.current);
    void reload();
    let lastTouch = 0;
    const touch = () => { if (Date.now() - lastTouch < 30000) return; lastTouch = Date.now(); void api.protectedRegistry.touch().catch(() => locked.current()); };
    const timer = setInterval(() => { void api.protectedRegistry.status().then(status => { if (!status.unlocked || !status.readOnly) locked.current(); }).catch(() => locked.current()); }, 15000);
    window.addEventListener('pointerdown', touch); window.addEventListener('keydown', touch);
    return () => {
      // This counter invalidates pending reads; it is not a DOM reference.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      unmountLock.current = setTimeout(() => { void api.protectedRegistry.lock(); }, 0);
      clearInterval(timer); window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch);
    };
  }, [reload]);
  const exit = async () => { epoch.current++; setData(null); await api.protectedRegistry.lock(); locked.current(); };
  const belongs = (row: any) => !companyKey || row.companyKey === companyKey;
  const invoices = (data?.invoices || []).filter(belongs);
  const sum = (rows: any[], field: string) => rows.reduce((total, row) => total + Math.round(Number(row[field] || 0) * 100), 0) / 100;
  return <div className="protected-workspace h-screen flex bg-slate-50 overflow-hidden">
    <aside className="protected-sidebar w-64 bg-slate-900 text-white flex flex-col"><header className="p-5"><ShieldCheck className="text-indigo-400 mb-2" />Registru separat<p className="text-sm text-slate-300 mt-2">Viewer · Doar citire</p></header><nav className="flex-1 p-3">{navigation.map(([id, label, Icon]) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)} className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 mb-1 ${tab === id ? 'bg-indigo-600' : 'hover:bg-slate-800'}`}><Icon size={18} />{label}</button>)}</nav><button type="button" onClick={() => void exit()} className="m-3 p-3 rounded-xl bg-slate-800 flex gap-2"><LogOut size={18} />Blochează registrul</button><button type="button" onClick={async () => { await exit(); window.location.hash = '/'; }} className="p-3 mb-3">Înapoi la Hub</button></aside>
    <main className="protected-main flex-1 overflow-y-auto p-8"><div className="protected-content space-y-5">
      <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 text-sm text-indigo-800">Doar consultare, deschidere, printare și trimitere. Baza registrului rămâne în Drive; PDF-urile se pregătesc temporar și sunt șterse la blocare. Nu se fac modificări în Drive.</div>
      <div className="flex flex-wrap items-end gap-3"><label className="flex-1 min-w-0 text-sm font-semibold">Companie<select className="block mt-2 w-full" value={companyKey} onChange={event => setCompanyKey(event.target.value)}><option value="">Toate companiile</option>{data?.companies.map(company => <option key={company.companyKey} value={company.companyKey}>{company.name}</option>)}</select></label><button type="button" disabled={loading} onClick={() => void reload()} title="Actualizează din Drive" aria-label="Actualizează din Drive" className="p-3 rounded-xl bg-indigo-600 text-white"><RefreshCw size={20} className={loading ? 'animate-spin' : ''} /></button></div>
      {updated && <p className="text-xs text-slate-500">Ultima citire verificată: {updated}. Actualizează pentru modificările recente. Documentele sunt reverificate la deschidere.</p>}
      {message && <p role="status" className="rounded-xl bg-slate-100 p-4">{message}<button type="button" onClick={() => setMessage('')} className="ml-3 underline">Închide</button></p>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p>}
      {loading && <p role="status">Se citește registrul din Drive…</p>}
      {data && <>
        <div className="grid sm:grid-cols-3 gap-4">{[['Facturat', sum(invoices.filter(row => row.status !== 'cancelled'), 'totalAmount')], ['Rest de plată', sum(invoices.filter(row => row.status !== 'cancelled'), 'outstanding')], ['Credit disponibil', sum(data.balances.filter(belongs), 'available')]].map(([label, value]) => <div key={label} className="bg-white rounded-2xl border p-5"><p className="text-sm text-slate-500">{label}</p><b className="block text-2xl mt-2">{money(Number(value))}</b></div>)}</div>
        {tab === 'invoices' && <ProtectedInvoiceList invoices={invoices} readOnly loading={loading} error="" reload={() => void reload()} notify={setMessage} onEdit={denied} onIssuerChange={denied} onCancel={denied} onRemove={denied} onReissue={denied} onCreditNote={denied} onPayment={denied} />}
        {tab === 'payments' && <section className="bg-white rounded-2xl border divide-y"><h1 className="p-5 font-bold text-xl">Istoric Plăți</h1>{data.payments.filter(belongs).map(row => <div key={row.id} className="p-5 flex flex-wrap justify-between gap-3"><div><b>{row.companyName}</b><p>{row.invoiceReference || 'Avans / Credit'}{row.storeName && ` · ${row.storeName}`}</p><small>{row.paymentDate} · {row.method} · {row.issuerCode}{row.reversedAt && ' · REVERSATĂ'}</small></div><b>{money(row.amount)}</b></div>)}{!data.payments.some(belongs) && <p className="p-5">Nu există încasări.</p>}</section>}
        {tab === 'notes' && <section className="bg-white rounded-2xl border divide-y"><h1 className="p-5 font-bold text-xl">Credit Notes</h1>{data.notes.filter(belongs).map(row => <div key={row.id} className="p-5 flex flex-wrap items-center gap-4"><div className="flex-1"><b>{row.reference} · {row.companyName}</b><p className="text-sm text-slate-500">{row.issueDate} · {row.reason}{row.status === 'cancelled' && ' · ANULAT'}</p></div><b>{money(row.totalAmount)}</b><ProtectedDocumentActions type="credit-note" id={row.id} status={row.status} notify={setMessage} /></div>)}{!data.notes.some(belongs) && <p className="p-5">Nu există Credit Notes.</p>}</section>}
        {tab === 'clients' && <section className="bg-white rounded-2xl border divide-y"><div className="p-5"><h1 className="font-bold text-xl mb-3">Clienți & Entități</h1><label>Caută companie sau magazin<input className="block mt-2 w-full" type="search" value={search} onChange={event => setSearch(event.target.value)} /></label></div>{data.companies.filter(belongs).filter(row => [row.name, ...row.stores.map((store: any) => store.name)].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(row => <div key={row.companyKey} className="p-5"><button type="button" className="text-indigo-600 font-bold hover:underline" onClick={() => { setCompanyKey(row.companyKey); setTab('invoices'); }}>{row.name}</button><p className="text-sm text-slate-500">{row.address}</p><p className="mt-2">{row.stores.map((store: any) => store.name).join(' · ') || 'Fără magazine facturate în acest registru'}</p></div>)}</section>}
      </>}
    </div></main>
  </div>;
}

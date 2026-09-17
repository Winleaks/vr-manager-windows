import { createFeedbackController } from '../utils/feedback';
import { FeedbackHost } from '../components/FeedbackHost';
import { ProtectedInvoiceEditor } from '../components/ProtectedInvoiceEditor';
import { ProtectedInvoiceList } from '../components/ProtectedInvoiceList';
import { ProtectedDocumentActions } from '../components/ProtectedDocumentActions';
import { ProtectedViewer } from '../components/ProtectedViewer';
import { NavigationMemory, NavigationView } from '../components/NavigationMemory';
import { useNavigationState, useRememberedScroll } from '../hooks/navigationMemory';
import { BillingSettings } from './BillingSettings';
import { InvoiceIssuerChangeModal } from '../components/InvoiceIssuerChangeModal';
import { createContext, useContext, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import './ProtectedRegistry.css';
import {
  ArrowLeft,
  Banknote,
  Ban,
  FileMinus2,
  FilePlus2,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  LogOut,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  Users,
} from 'lucide-react';
import { api } from '../shared/api';
import { NumericInput } from '../components/NumericInput';
import { PinInput } from '../components/PinInput';
import { BilingualProductName } from '../components/BilingualProductName';
import { registerProtectedRegistryAccessClick } from '../utils/protectedRegistryAccess';
import { matchesProtectedCompany } from '../utils/protectedCompanySearch';

const protectedFeedback = createFeedbackController();
const { notify, confirmAction } = protectedFeedback;

type CloudAction = <T>(action: () => Promise<T>) => Promise<T>;
const CloudActionContext = createContext<CloudAction>(async action => action());

function PanelHeading({ title, description, icon: Icon }: { title: string; description?: string; icon: typeof Receipt }) {
  return <header className="space-y-2"><h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900"><span className="rounded-xl bg-indigo-100 p-2 text-indigo-600"><Icon size={23} aria-hidden="true" /></span>{title}</h1>{description && <p className="text-sm text-slate-500">{description}</p>}</header>;
}

function operationId() {
  return crypto.randomUUID().replaceAll('-', '');
}

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function mondayAndSunday() {
  const date = new Date();
  const day = date.getDay();
  const distance = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + distance);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const iso = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return { startDate: iso(monday), endDate: iso(sunday) };
}

function money(value: unknown) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Operațiunea nu a putut fi finalizată.';
}

interface DialogField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea';
  initialValue?: string;
  placeholder?: string;
}

function InputDialog({ title, message, fields, onClose }: { title: string; message?: string; fields: DialogField[]; onClose: (value: Record<string, string> | null) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialogRef.current!;
    element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.name, field.initialValue || ''])));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (fields.some((field) => !values[field.name]?.trim())) return;
    onClose(values);
  };
  return <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(null); }} className="m-auto w-full max-w-lg border-0 bg-transparent p-4 backdrop:bg-slate-950/60">
    <form onSubmit={submit} className="protected-input-dialog w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
      <div><h2 id={titleId} className="text-xl font-bold">{title}</h2>{message && <p className="text-sm text-slate-500 mt-1">{message}</p>}</div>
      {fields.map((field, index) => <label key={field.name} className="block text-sm font-semibold">{field.label}{field.type === 'textarea'
        ? <textarea autoFocus={index === 0} value={values[field.name]} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} className="mt-1 w-full min-h-24 rounded-xl border p-3 font-normal" />
        : field.type === 'number'
          ? <NumericInput autoFocus={index === 0} value={values[field.name]} placeholder={field.placeholder} onValueChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} className="mt-1 w-full rounded-xl border p-3 font-normal" />
          : <input autoFocus={index === 0} value={values[field.name]} type={field.type || 'text'} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} className="mt-1 w-full rounded-xl border p-3 font-normal" />}</label>)}
      <div className="flex justify-end gap-3"><button type="button" onClick={() => onClose(null)} className="rounded-xl border px-4 py-2">Renunță</button><button type="submit" className="rounded-xl bg-indigo-600 text-white px-4 py-2 font-bold">Confirmă</button></div>
    </form>
  </dialog>;
}

function useInputDialog() {
  const [request, setRequest] = useState<({ title: string; message?: string; fields: DialogField[]; resolve: (value: Record<string, string> | null) => void }) | null>(null);
  const ask = useCallback((input: { title: string; message?: string; fields: DialogField[] }) => new Promise<Record<string, string> | null>((resolve) => setRequest({ ...input, resolve })), []);
  const close = useCallback((value: Record<string, string> | null) => {
    setRequest((current) => { current?.resolve(value); return null; });
  }, []);
  return { ask, dialog: request ? <InputDialog title={request.title} message={request.message} fields={request.fields} onClose={close} /> : null };
}

export function ProtectedRegistryHotspot() {
  const clicks = useRef<number[]>([]);
  const trigger = () => {
    const result = registerProtectedRegistryAccessClick(clicks.current, Date.now());
    clicks.current = result.history;
    if (result.triggered) {
      window.location.hash = '/registru-separat';
    }
  };
  return <div onClick={trigger} className="fixed bottom-0 right-0 z-[100] h-8 w-8 cursor-default opacity-0" aria-hidden="true" />;
}

interface AccessProps {
  onUnlocked: () => void;
  status: any;
}

function ProtectedAccess({ onUnlocked, status }: AccessProps) {
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(Boolean(status.needsRecovery));
  const [oneTimeKey, setOneTimeKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true); setError('');
    try {
      if (!status.configured && !status.readOnly) {
        const result = await api.protectedRegistry.configure(pin, confirmation);
        setOneTimeKey(result.recoveryKey);
        return;
      }
      if (recoveryMode && status.readOnly) await api.protectedRegistry.activateViewer(recoveryKey, pin, confirmation);
      else if (recoveryMode) await api.protectedRegistry.recover(recoveryKey, pin, confirmation);
      else await api.protectedRegistry.unlock(pin);
      setRecoveryKey(''); setPin(''); setConfirmation('');
      onUnlocked();
    } catch (nextError) { setError(errorMessage(nextError)); }
    finally { setBusy(false); }
  };

  if (oneTimeKey) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6"><div className="max-w-xl w-full rounded-3xl bg-white p-8 shadow-2xl space-y-5">
      <ShieldCheck className="text-emerald-600" size={42} />
      <h1 className="text-2xl font-bold">Cheie de recuperare creată</h1>
      <p className="text-slate-600">Aceasta este singura afișare. Păstreaz-o offline, într-un loc sigur. Nu o trimite prin mesaje și nu o salva în folderul Duplicat.</p>
      <div className="rounded-xl bg-slate-100 border border-slate-200 p-4 font-mono font-bold break-all select-all">{oneTimeKey}</div>
      <button onClick={onUnlocked} className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white">Am salvat cheia. Intră în registru</button>
    </div></div>;
  }

  return <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
    <div className="max-w-md w-full rounded-3xl bg-white p-8 shadow-2xl space-y-5">
      <div className="h-12 w-12 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center"><Lock /></div>
      <div><h1 className="text-2xl font-bold text-slate-900">Registru separat</h1><p className="text-sm text-slate-500 mt-1">{status.readOnly ? 'Viewer — doar consultare și documente. La prima activare introdu cheia de recuperare și alege PIN-ul acestui calculator. PIN-ul Writer-ului nu se modifică.' : 'Acces administrativ Writer, protejat de PIN și Google Drive.'}</p></div>
      {!status.secureStorageAvailable && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Stocarea securizată a sistemului nu este disponibilă.</p>}
      {status.lockedUntil && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Acces blocat până la {new Date(status.lockedUntil).toLocaleTimeString('ro-RO')}.</p>}
      {recoveryMode && <label className="block text-sm font-semibold text-slate-700">Cheie de recuperare<input type="password" value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono" autoComplete="off" /></label>}
      <label className="block text-sm font-semibold text-slate-700">{recoveryMode ? 'PIN nou' : status.configured ? 'PIN' : 'PIN nou'}<PinInput value={pin} onValueChange={setPin} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-xl tracking-[.5em]" autoFocus /></label>
      {(!status.configured || recoveryMode) && <label className="block text-sm font-semibold text-slate-700">Confirmă PIN-ul<PinInput value={confirmation} onValueChange={setConfirmation} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-xl tracking-[.5em]" /></label>}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy || Boolean(status.lockedUntil)} onClick={submit} className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Se verifică…' : !status.configured ? 'Configurează registrul' : recoveryMode ? (status.readOnly ? 'Activează accesul Viewer' : 'Recuperează accesul') : 'Deblochează'}</button>
      {status.configured && <button onClick={() => setRecoveryMode((value) => !value)} className="w-full text-sm text-indigo-700">{recoveryMode ? 'Înapoi la PIN' : 'Folosește cheia de recuperare'}</button>}
      <button onClick={() => { window.location.hash = '/'; }} className="w-full text-sm text-slate-500">Înapoi la Hub</button>
    </div>
  </div>;
}

const tabs = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['orders', 'Comenzi', ShoppingBag],
  ['invoices', 'Facturi', Receipt],
  ['payments', 'Istoric Plăți', Banknote],
  ['manual', 'Factură manuală', FilePlus2],
  ['credit-notes', 'Credit Notes', FileMinus2],
  ['clients', 'Clienți & Entități', Users],
  ['exports', 'Exporturi', FileSpreadsheet],
  ['settings', 'Setări', Settings],
] as const;

function DashboardPanel() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.protectedRegistry.getOverview().then(setData).catch((error) => notify(errorMessage(error))); }, []);
  if (!data) return <p className="text-slate-500">Se încarcă…</p>;
  const cards = [['Clienți atribuiți', data.assignedCompanies], ['Facturi', data.invoices], ['Facturat', money(data.invoiced)], ['Creditat', money(data.credited)], ['Încasat', money(data.paid)], ['Credit disponibil', money(data.availableCredit)], ['Rest de plată', money(data.outstanding)]];
  return <div className="space-y-6"><PanelHeading title="Dashboard registru separat" description="Evidență oficială independentă de registrul normal." icon={LayoutDashboard} /><div className="grid md:grid-cols-4 gap-4">{cards.map(([label, value], index) => <div key={String(label)} className="rounded-2xl bg-white border border-slate-200 p-5"><div className="flex items-center justify-between gap-3"><p className="text-sm text-slate-500">{label}</p><span className="rounded-lg bg-indigo-50 text-indigo-600 p-2">{index === 0 ? <Users size={20} /> : index === 1 ? <Receipt size={20} /> : index === 3 ? <FileMinus2 size={20} /> : <Banknote size={20} />}</span></div><p className="text-2xl font-bold mt-2">{value}</p></div>)}</div><div className="grid md:grid-cols-2 gap-4">{([['THE GOODNESS BAKER LTD', data.byIssuer?.goodness], ['VATRA ROMANEASCA LTD', data.byIssuer?.vatra]] as const).map(([name, values]) => <section key={name} className="rounded-2xl bg-white border p-5"><h2 className="font-bold mb-3">{name}</h2><div className="grid grid-cols-2 gap-2 text-sm"><span>Facturat</span><b className="text-right">{money(values?.invoiced)}</b><span>Creditat</span><b className="text-right">{money(values?.credited)}</b><span>Încasat</span><b className="text-right">{money(values?.paid)}</b><span>Credit disponibil</span><b className="text-right">{money(values?.availableCredit)}</b><span>Rest de plată</span><b className="text-right">{money(values?.outstanding)}</b></div></section>)}</div></div>;
}

function ClientsPanel() {
  const run = useContext(CloudActionContext);
  const [companies, setCompanies] = useState<any[]>([]);
  const [search, setSearch] = useNavigationState('search', '');
  const [busy, setBusy] = useState<number | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useNavigationState<number | null>('company', null);
  const selectedCompany = companies.find(company => company.id === selectedCompanyId);
  const scrollRef = useRememberedScroll('list', undefined, !selectedCompanyId);
  const reload = useCallback(() => api.protectedRegistry.getCompanies().then(setCompanies), []);
  useEffect(() => { void reload(); }, [reload]);
  const toggle = async (company: any) => {
    setBusy(company.id);
    try { await run(() => api.protectedRegistry.setAssignment(company.id, !company.assigned, operationId())); await reload(); }
    catch (error) { notify(errorMessage(error)); } finally { setBusy(null); }
  };
  const filtered = companies.filter(company => matchesProtectedCompany(company, search));
  if (selectedCompany) return <NavigationView name={`company-${selectedCompany.id}`} restore={false}><ClientProfile key={selectedCompany.id} company={selectedCompany} onBack={() => setSelectedCompanyId(null)} /></NavigationView>;
  return <div ref={scrollRef} className="space-y-5">
    <PanelHeading title="Clienți atribuiți" description="Atribuirea include toate magazinele companiei și exclude comenzile din facturarea normală." icon={Users} />
    <div className="rounded-2xl bg-white border border-slate-200 p-4">
      <label className="block text-xs font-semibold uppercase text-slate-500" htmlFor="protected-client-search">Caută companie sau magazin</label>
      <div className="relative mt-2"><Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" /><input id="protected-client-search" type="search" value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" placeholder="Numele companiei sau al magazinului..." className="w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
    </div>
    <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
      {filtered.map(company => <div key={company.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0"><button type="button" onClick={() => setSelectedCompanyId(company.id)} className="font-bold break-words text-indigo-600 hover:underline" aria-label={`Deschide profilul ${company.name}`}>{company.name}</button><p className="text-sm text-slate-500">{company.issuerName || 'Emitent implicit'} · {company.stores.length} {company.stores.length === 1 ? 'magazin' : 'magazine'}</p>
          <ul aria-label={`Magazinele companiei ${company.name}`} className="mt-2 flex flex-wrap gap-2">{company.stores.map((store: { id: number; name: string }) => <li key={store.id} className="inline-flex items-start gap-1.5 min-w-0 max-w-full rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1 text-sm text-slate-600"><Store size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-indigo-500" /><span className="break-words">{store.name || 'Magazin fără nume'}</span></li>)}</ul>
        </div>
        <button disabled={busy === company.id} onClick={() => toggle(company)} className={`shrink-0 self-start sm:self-auto rounded-xl px-4 py-2 font-semibold ${company.assigned ? 'bg-red-50 text-red-700' : 'bg-indigo-600 text-white'}`}>{company.assigned ? 'Elimină din registru' : 'Adaugă în registru'}</button>
      </div>)}
      {!filtered.length && <p role="status" className="p-8 text-center text-slate-500">{search.trim() ? 'Nu există companii sau magazine pentru această căutare.' : 'Nu există companii disponibile.'}</p>}
    </div>
  </div>;
}

function ClientProfile({ company, onBack }: { company: any; onBack: () => void }) {
  const [tab, setTab] = useNavigationState('tab', 'invoices');
  const [issuer, setIssuer] = useNavigationState('issuer', 'all');
  const scrollRef = useRememberedScroll(tab);
  const [data, setData] = useState<{ invoices: any[]; payments: any[]; balances: any[]; notes: any[] } | null>(null);
  const [error, setError] = useState('');
  const [paymentInvoice, setPaymentInvoice] = useState<any>();
  const [creditInvoiceId, setCreditInvoiceId] = useState<string>();
  const request = useRef(0);
  const reload = useCallback(async () => {
    const version = ++request.current;
    try {
      const [invoices, payments, balances, notes] = await Promise.all([
        api.protectedRegistry.getInvoices(), api.protectedRegistry.getPayments(),
        api.protectedRegistry.getCreditBalances(), api.protectedRegistry.getCreditNotes(),
      ]);
      if (version !== request.current) return;
      const belongs = (row: any) => row.companyId === company.id;
      setData({ invoices: invoices.filter(belongs), payments: payments.filter(belongs), balances: balances.filter(belongs), notes: notes.filter(belongs) });
      setError('');
    } catch (failure) { if (version === request.current) setError(errorMessage(failure)); }
  }, [company.id]);
  useEffect(() => { void reload(); return () => {
    // Invalidate pending reads, not a DOM ref captured by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    request.current++;
  }; }, [reload]);
  const changed = useCallback(() => { void reload(); }, [reload]);
  const scoped = (rows: any[]) => rows.filter(row => issuer === 'all' || row.issuerCode === issuer);
  const sum = (rows: any[], field: string) => rows.reduce((total, row) => total + Math.round(Number(row[field] || 0) * 100), 0) / 100;
  const invoices = scoped(data?.invoices || []);
  const active = invoices.filter(row => row.status !== 'cancelled');
  const payments = scoped(data?.payments || []);
  const notes = scoped(data?.notes || []);
  const balances = scoped(data?.balances || []);
  const profileTabs = [['invoices', 'Facturi', Receipt], ['payments', 'Istoric încasări', Banknote], ['notes', 'Credit Notes', FileMinus2], ['credits', 'Registru Credit', ShieldCheck], ['stores', 'Magazine & detalii', Store]] as const;
  return <div ref={scrollRef} className="space-y-6">
    <button type="button" onClick={onBack} className="flex items-center gap-2 text-indigo-600 text-sm font-semibold"><ArrowLeft size={16} />Înapoi la lista de clienți</button>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><PanelHeading title={company.name} icon={Users} /><p className="text-sm text-slate-500 mt-2">{company.address}</p><p className="text-sm text-slate-500">{company.cui && `VAT No: ${company.cui} · `}{company.reg_com && `CRN: ${company.reg_com} · `}{company.stores.length} magazine · {company.issuerName || 'Emitent implicit'}</p></div><label className="text-sm font-semibold">Societate emitentă<select className="block mt-2" value={issuer} onChange={event => { setIssuer(event.target.value); setPaymentInvoice(undefined); setCreditInvoiceId(undefined); }}><option value="all">Toate societățile</option><option value="goodness">THE GOODNESS BAKER LTD</option><option value="vatra">VATRA ROMANEASCA LTD</option></select></label></header>
    {error && <div role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}<button type="button" onClick={() => void reload()} className="ml-3 underline">Reîncearcă</button></div>}
    {!data ? <p role="status">Se încarcă profilul clientului...</p> : <>
      <section aria-label="Situație financiară client" className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">{[
        ['Total facturat', sum(active, 'totalAmount'), Receipt],
        ['Încasări active', sum(payments.filter(row => !row.reversedAt), 'amount'), Banknote],
        ['Rest de plată', sum(active, 'outstanding'), FileSpreadsheet],
        ['Sold Credit / Avans', sum(balances, 'available'), ShieldCheck],
      ].map(([label, amount, Icon]: any) => <div key={label} className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-500">{label}</span><Icon size={20} className="text-indigo-600" /></div><p className="text-2xl font-bold mt-3">{money(amount)}</p></div>)}</section>
      <p className="text-sm text-slate-500">Credit Notes active: {money(sum(notes.filter(row => row.status !== 'cancelled'), 'totalAmount'))}. Soldurile sunt separate pe societate; creditul disponibil se aplică din Istoric încasări.</p>
      <nav aria-label="Secțiuni profil client" className="flex flex-wrap gap-x-6 border-b border-slate-200">{profileTabs.map(([id, label, Icon]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setPaymentInvoice(undefined); setCreditInvoiceId(undefined); }} className={`flex items-center gap-2 py-4 border-b-2 text-sm font-semibold ${tab === id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}><Icon size={18} />{label}</button>)}</nav>
      {tab === 'invoices' && <InvoicesPanel key={issuer} companyId={company.id} issuer={issuer} onChanged={changed} onPayment={invoice => { setPaymentInvoice(invoice); setTab('payments'); }} onCreditNote={id => { setCreditInvoiceId(id); setTab('notes'); }} />}
      {tab === 'payments' && <PaymentsPanel key={issuer + (paymentInvoice?.id || '')} profileCompany={company} profileIssuer={issuer} initialInvoice={paymentInvoice} onChanged={changed} />}
      {tab === 'notes' && <CreditNotesPanel key={issuer + (creditInvoiceId || '')} companyId={company.id} issuer={issuer} invoiceId={creditInvoiceId} onChanged={changed} />}
      {tab === 'credits' && <div className="space-y-5"><section className="rounded-2xl bg-white border border-slate-200 overflow-x-auto"><h2 className="font-bold p-4">Surse de credit</h2><table className="w-full text-sm text-left"><thead className="bg-slate-50"><tr>{['Sursă', 'Emitent', 'Data', 'Inițial', 'Disponibil'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{balances.flatMap(balance => (balance.entries || []).map((entry: any) => <tr key={entry.id} className="border-t"><td className="p-3">{entry.sourceType === 'payment_overpayment' ? 'Avans / Supraîncasare' : 'Credit Note'}</td><td className="p-3">{balance.issuerCode === 'goodness' ? 'THE GOODNESS BAKER LTD' : 'VATRA ROMANEASCA LTD'}</td><td className="p-3">{entry.createdAt.slice(0, 10)}</td><td className="p-3">{money(entry.originalAmount)}</td><td className="p-3 font-bold">{money(entry.availableAmount)}</td></tr>))}</tbody></table>{!balances.some(row => row.entries?.length) && <p className="p-5 text-slate-500">Nu există surse de credit.</p>}</section><PaymentsPanel key={issuer} profileCompany={company} profileIssuer={issuer} onChanged={changed} creditOnly /></div>}
      {tab === 'stores' && <section className="rounded-2xl bg-white border border-slate-200 divide-y">{company.stores.map((store: any) => <div key={store.id} className="p-5 flex flex-wrap justify-between gap-3"><div><h2 className="font-bold flex items-center gap-2"><Store size={18} className="text-indigo-600" />{store.name}</h2><p className="text-sm text-slate-500 mt-1">{store.address}</p></div><div className="text-right text-sm"><p>{invoices.filter(row => row.storeId === store.id).length} facturi</p><b>Rest {money(sum(active.filter(row => row.storeId === store.id), 'outstanding'))}</b></div></div>)}</section>}
    </>}
  </div>;
}

function OrdersPanel() {
  const run = useContext(CloudActionContext);
  const initial = mondayAndSunday();
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [preview, setPreview] = useState<any>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { const value = await api.protectedRegistry.previewWeekly(startDate, endDate); setPreview(value); setSelected(value.ordersByStore.filter((row: any) => row.billingState === 'ready').map((row: any) => row.store.id)); }
    catch (error) { notify(errorMessage(error)); } finally { setBusy(false); }
  };
  const issue = async () => {
    if (!selected.length || !(await confirmAction(`Emiți ${selected.length} facturi în registrul separat?`))) return;
    setBusy(true);
    try { const result = await run(() => api.protectedRegistry.createWeekly(startDate, endDate, selected, operationId())); const failed = result.pdfResults.filter((row: any) => !row.success); notify(failed.length ? `Facturile au fost emise. ${failed.length} PDF-uri trebuie regenerate.` : `${result.invoices.length} facturi au fost emise și verificate în Drive.`); await load(); }
    catch (error) { notify(errorMessage(error)); } finally { setBusy(false); }
  };
  const issueZone = async (zoneId: string, rows: any[]) => {
    const ready = rows.filter((row) => row.billingState === 'ready');
    const zoneName = rows[0]?.store.zone?.name || 'FĂRĂ ZONĂ ALOCATĂ';
    if (!ready.length || !(await confirmAction(`Emiți ${ready.length} facturi pentru zona ${zoneName}?`))) return;
    setBusy(true);
    try {
      const result = await run(() => api.protectedRegistry.createWeeklyByZone(startDate, endDate, zoneId === 'none' ? null : zoneId, operationId()));
      const failed = result.pdfResults.filter((row: any) => !row.success);
      notify(failed.length ? `Lotul a fost emis. ${failed.length} PDF-uri trebuie regenerate.` : `${result.invoices.length} facturi au fost emise pentru ${zoneName}.`);
      await load();
    } catch (error) { notify(errorMessage(error)); } finally { setBusy(false); }
  };
  const issueAll = async () => {
    const ready = (preview?.ordersByStore || []).filter((row: any) => row.billingState === 'ready');
    if (!ready.length || !(await confirmAction(`Emiți toate cele ${ready.length} facturi pregătite din registrul separat?`))) return;
    setBusy(true);
    try {
      const result = await run(() => api.protectedRegistry.createAllWeekly(startDate, endDate, operationId()));
      const failed = result.pdfResults.filter((row: any) => !row.success);
      notify(failed.length ? `Lotul a fost emis. ${failed.length} PDF-uri trebuie regenerate.` : `${result.invoices.length} facturi au fost emise.`);
      await load();
    } catch (error) { notify(errorMessage(error)); } finally { setBusy(false); }
  };
  const byZone = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const row of preview?.ordersByStore || []) { const key = row.store.zone?.id || 'none'; map.set(key, [...(map.get(key) || []), row]); }
    return map;
  }, [preview]);
  return <div className="space-y-5"><PanelHeading title="Comenzi protejate" description="Comenzi deschise, blocate sau livrate ale clienților atribuiți." icon={ShoppingBag} /><div className="rounded-2xl bg-white border p-4 flex flex-wrap gap-3 items-end"><label className="text-sm">Luni<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="block border rounded-lg p-2" /></label><label className="text-sm">Duminică<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="block border rounded-lg p-2" /></label><button onClick={load} disabled={busy} className="rounded-xl bg-slate-900 text-white px-4 py-2.5 flex gap-2"><RefreshCw size={18} />Actualizează</button><button onClick={issue} disabled={busy || !selected.length} className="rounded-xl bg-indigo-600 text-white px-4 py-2.5 disabled:opacity-50">Generează selectate</button><button onClick={issueAll} disabled={busy || !preview?.ordersByStore?.some((row: any) => row.billingState === 'ready')} className="rounded-xl bg-emerald-600 text-white px-4 py-2.5 disabled:opacity-50">Generează toate</button></div>{[...byZone.entries()].map(([zoneId, rows]) => { const readyCount = rows.filter((row) => row.billingState === 'ready').length; const total = rows.filter((row) => row.billingState === 'ready').reduce((sum, row) => sum + row.items.reduce((itemSum: number, item: any) => itemSum + item.totalPrice, 0), 0); return <section key={zoneId} className="rounded-2xl bg-white border overflow-hidden"><header className="p-4 bg-slate-50 font-bold flex items-center gap-3"><span className="flex-1">{rows[0]?.store.zone?.name || 'FĂRĂ ZONĂ ALOCATĂ'} · {rows[0]?.store.zone?.driver?.name || 'Fără șofer'}<small className="block text-slate-500 font-normal">{readyCount} pregătite · {money(total)}</small></span><button onClick={() => issueZone(zoneId, rows)} disabled={busy || !readyCount} className="rounded-lg bg-indigo-600 text-white px-3 py-2 text-sm disabled:opacity-50">Generează zona</button></header>{rows.map((row: any) => <label key={row.store.id} className="p-4 border-t flex gap-3 items-center"><input type="checkbox" disabled={row.billingState !== 'ready'} checked={selected.includes(row.store.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.store.id] : current.filter((id) => id !== row.store.id))} /><span className="flex-1"><b>{row.store.name}</b><small className="block text-slate-500">{row.store.company?.name} · {row.issuer?.issuerName}</small></span><span className="font-bold">{money(row.items.reduce((sum: number, item: any) => sum + item.totalPrice, 0))}</span></label>)}</section>; })}</div>;
}

function InvoicesPanel({ onCreditNote, onPayment, companyId, issuer = 'all', onChanged }: { onCreditNote: (id: string) => void; onPayment: (invoice: any) => void; companyId?: number; issuer?: string; onChanged?: () => void }) {
  const run = useContext(CloudActionContext);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [issuerInvoiceId, setIssuerInvoiceId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const { ask, dialog } = useInputDialog();
  const reload = useCallback(async () => { setLoading(true); setLoadError(''); try { const rows = await api.protectedRegistry.getInvoices(); setInvoices(rows.filter((row: any) => (companyId === undefined || row.companyId === companyId) && (issuer === 'all' || row.issuerCode === issuer))); onChanged?.(); } catch (error) { setLoadError(errorMessage(error)); } finally { setLoading(false); } }, [companyId, issuer, onChanged]);
  useEffect(() => { void reload(); }, [reload]);
  const cancel = async (invoice: any) => { const values = await ask({ title: `Anulează ${invoice.reference}`, fields: [{ name: 'reason', label: 'Motivul anulării', type: 'textarea' }] }); if (!values) return; try { await run(() => api.protectedRegistry.cancelInvoice(invoice.id, values.reason, operationId())); await reload(); } catch (error) { notify(errorMessage(error)); } };
  const remove = async (invoice: any) => { const values = await ask({ title: `Șterge definitiv ${invoice.reference}`, message: `Scrie exact STERGE ${invoice.reference}`, fields: [{ name: 'confirmation', label: 'Confirmare' }] }); if (!values) return; try { await run(() => api.protectedRegistry.deleteTestInvoice(invoice.id, values.confirmation, operationId())); await reload(); } catch (error) { notify(errorMessage(error)); } };
  const reissue = async (invoice: any) => { if (!(await confirmAction(`Reemiți ${invoice.reference} cu un număr nou și emitentul actual al clientului?`))) return; try { const result = await run(() => api.protectedRegistry.reissueInvoice(invoice.id, operationId())); notify(result.pdf.success ? `Factura ${result.invoice.reference} a fost reemisă.` : `Factura ${result.invoice.reference} a fost reemisă, dar PDF-ul trebuie regenerat.`); await reload(); } catch (error) { notify(errorMessage(error)); } };
  return <><ProtectedInvoiceList invoices={invoices} loading={loading} error={loadError} reload={() => void reload()} notify={notify}
    onEdit={invoice => setEditingId(invoice.id)} onIssuerChange={invoice => setIssuerInvoiceId(invoice.id)}
    onCancel={cancel} onRemove={remove} onReissue={reissue} onCreditNote={invoice => onCreditNote(invoice.id)} onPayment={onPayment} />
    {dialog}{editingId && <ProtectedInvoiceEditor key={editingId} invoiceId={editingId} run={run} onClose={() => setEditingId(null)} onSaved={message => { setEditingId(null); notify(message); void reload(); }} />}
    {issuerInvoiceId && <InvoiceIssuerChangeModal registry="protected" invoiceId={issuerInvoiceId} onClose={() => setIssuerInvoiceId(null)} onComplete={message => { setIssuerInvoiceId(null); notify(message); void reload(); }} />}
  </>;
}

function ManualInvoicePanel() {
  const run = useContext(CloudActionContext);
  const [data, setData] = useState<any>({ companies: [], products: [] });
  const [companyId, setCompanyId] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [date, setDate] = useState(localToday());
  const [lines, setLines] = useState<any[]>([]);
  const [issued, setIssued] = useState<any>(null);
  useEffect(() => { api.protectedRegistry.getManualData().then(setData).catch(error => notify(errorMessage(error))); }, []);
  const company = data.companies.find((row: any) => String(row.id) === companyId);
  const chooseCompany = (row: any) => { setCompanyId(String(row.id)); setStoreId(row.stores?.[0] ? String(row.stores[0].id) : ''); setCompanySearch(''); };
  const products = data.products.filter((row: any) => row.available && !lines.some(line => line.productId === row.id) && (row.name + ' ' + (row.name_ro || '')).toLocaleLowerCase().includes(productSearch.toLocaleLowerCase()));
  const add = () => {
    const product = products.find((row: any) => String(row.id) === productId);
    if (!product) return;
    setLines(current => [...current, { productId: product.id, quantity: '1', unitPrice: Number(product.price_standard || 0).toFixed(2) }]); setProductId('');
  };
  const pending = useRef<{ signature: string; operationId: string } | null>(null);
  const issue = async () => {
    if (!storeId || !lines.length || lines.some(line => !line.quantity.trim() || !line.unitPrice.trim() || Number(line.quantity) <= 0 || Number(line.unitPrice) < 0)) return notify('Completează cantitatea și prețul fiecărui produs.');
    const signature = JSON.stringify({ storeId, date, lines });
    if (pending.current?.signature !== signature) pending.current = { signature, operationId: operationId() };
    try {
      const result = await run(() => api.protectedRegistry.createManualInvoice({ storeId: Number(storeId), invoiceDate: date, items: lines, operationId: pending.current!.operationId }));
      setIssued(result.invoice); setLines([]); pending.current = null;
      notify(result.pdf.success ? `Factura ${result.invoice.reference} a fost emisă și salvată în Drive.` : `Factura ${result.invoice.reference} a fost emisă, dar PDF-ul trebuie reîncercat.`);
    } catch (error) { notify(errorMessage(error)); }
  };
  return <div className="space-y-6">
    <PanelHeading title="Factură manuală" description="Emite o factură fără comandă importată, folosind produsele din catalog." icon={FilePlus2} />
    {issued && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex flex-wrap items-center justify-between gap-3"><span className="font-semibold text-emerald-800">Factura {issued.reference} a fost emisă.</span><ProtectedDocumentActions id={issued.id} status={issued.status} notify={notify} /></section>}
    <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 space-y-4">
      <label className="block text-sm font-semibold">Caută companie sau magazin<input type="search" value={companySearch} onChange={e => setCompanySearch(e.target.value)} placeholder="Caută și selectează clientul..." className="block w-full mt-2" /></label>
      {companySearch.trim() && <div className="max-h-56 overflow-y-auto divide-y border border-slate-200 rounded-xl">{data.companies.filter((row: any) => matchesProtectedCompany(row, companySearch)).map((row: any) => <button type="button" key={row.id} onClick={() => chooseCompany(row)} className="block w-full p-3 text-left hover:bg-indigo-50"><b>{row.name}</b><small className="block text-slate-500">{row.stores.map((store: any) => store.name).join(' · ')}</small></button>)}{!data.companies.some((row: any) => matchesProtectedCompany(row, companySearch)) && <p className="p-4 text-slate-500">Niciun client atribuit nu corespunde căutării.</p>}</div>}
      <div className="grid md:grid-cols-2 gap-4"><label>Magazin / punct de livrare<select value={storeId} onChange={event => setStoreId(event.target.value)} disabled={!company} className="block w-full mt-1"><option value="">Selectează magazinul</option>{(company?.stores || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Data facturii<input type="date" value={date} onChange={event => setDate(event.target.value)} className="block w-full mt-1" /></label></div>
      {company ? <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 flex items-center gap-3"><Store size={20} className="text-indigo-600" /><div><b>{company.name}</b><small className="block text-slate-500">{company.address}</small></div></div> : <p className="text-sm text-slate-500">Caută compania sau magazinul pentru a selecta clientul.</p>}
    </section>
    <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 space-y-4"><h2 className="font-bold flex items-center gap-2"><ShoppingBag size={22} className="text-indigo-600" />Produsele facturii</h2><p className="text-sm text-slate-500">Prețul standard este completat automat și poate fi modificat pe această factură.</p>
        <label className="block">Caută produs<input type="search" value={productSearch} onChange={e => { setProductSearch(e.target.value); setProductId(''); }} className="block w-full mt-1" /></label>
        <div className="flex items-end gap-2"><label className="flex-1 min-w-0">Adaugă produs din catalog<select value={productId} onChange={e => setProductId(e.target.value)} className="block w-full mt-1"><option value="">{products.length ? 'Alege un produs...' : 'Nu există produse pentru această căutare'}</option>{products.map((row: any) => <option key={row.id} value={row.id}>{row.name} / {row.name_ro} — {money(row.price_standard)}</option>)}</select></label><button type="button" title="Adaugă produs" aria-label="Adaugă produs" disabled={!productId} onClick={add} className="rounded-lg p-3 text-indigo-600 hover:bg-indigo-50"><Plus size={20} /></button></div>
      </div>
      <div className="divide-y border-t border-slate-100">{lines.map((line, index) => { const product = data.products.find((row: any) => row.id === line.productId); return <div key={line.productId} className="protected-invoice-line p-4 gap-3 items-center">
        <BilingualProductName name={product?.name} nameRo={product?.name_ro} />
        <label className="text-xs font-semibold text-slate-500">Cantitate<NumericInput className="mt-1 w-full" aria-label={`Cantitate · ${product?.name}`} value={line.quantity} onValueChange={value => setLines(current => current.map((row, i) => i === index ? { ...row, quantity: value } : row))} /></label>
        <label className="text-xs font-semibold text-slate-500">Preț unitar (£)<NumericInput className="mt-1 w-full" aria-label={`Preț unitar · ${product?.name}`} value={line.unitPrice} onValueChange={value => setLines(current => current.map((row, i) => i === index ? { ...row, unitPrice: value } : row))} /></label>
        <button title="Elimină produsul" aria-label={`Elimină ${product?.name}`} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" onClick={() => setLines(current => current.filter((_, i) => i !== index))}><Trash2 size={18} /></button>
      </div>; })}{!lines.length && <p className="p-12 text-center text-slate-400">Nu ai adăugat încă produse.</p>}</div>
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 bg-slate-50 p-5"><span className="text-sm text-slate-500">{lines.length} produse</span><div className="flex items-center gap-4"><p className="text-right text-xs uppercase text-slate-500">Total factură<b className="block text-xl text-indigo-600">{money(lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0))}</b></p><button disabled={!storeId || !lines.length} onClick={issue} className="rounded-xl bg-indigo-600 text-white px-5 py-3 font-bold">Emite factura</button></div></footer>
    </section>
  </div>;
}

function PaymentsPanel({ initialInvoice, profileCompany, profileIssuer = 'all', onChanged, creditOnly = false }: { initialInvoice?: any; profileCompany?: any; profileIssuer?: string; onChanged?: () => void; creditOnly?: boolean }) {
  const run = useContext(CloudActionContext);
  const { ask, dialog } = useInputDialog();
  const [companies, setCompanies] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState(initialInvoice ? String(initialInvoice.companyId) : profileCompany ? String(profileCompany.id) : '');
  const [issuerCode, setIssuerCode] = useState<'goodness' | 'vatra'>(initialInvoice?.issuerCode || (profileIssuer !== 'all' ? profileIssuer : 'goodness'));
  const [amount, setAmount] = useState(initialInvoice ? Number(initialInvoice.outstanding).toFixed(2) : '');
  const [method, setMethod] = useState('transfer');
  const [balances, setBalances] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [creditApplications, setCreditApplications] = useState<any[]>([]);
  const [creditInvoiceId, setCreditInvoiceId] = useState('');
  const reload = useCallback(async () => { const [nextCompanies, nextPayments, nextBalances, nextInvoices, nextApplications] = await Promise.all([api.protectedRegistry.getCompanies(), api.protectedRegistry.getPayments(), api.protectedRegistry.getCreditBalances(), api.protectedRegistry.getInvoices(), api.protectedRegistry.getCreditApplications()]); const assigned = nextCompanies.filter((row: any) => row.assigned); setCompanies(assigned); setPayments(nextPayments.filter((row: any) => (!profileCompany || row.companyId === profileCompany.id) && (profileIssuer === 'all' || row.issuerCode === profileIssuer))); setBalances(nextBalances); setInvoices(nextInvoices); setCreditApplications(nextApplications.filter((row: any) => (!profileCompany || row.companyKey === profileCompany.companyKey) && (profileIssuer === 'all' || row.issuerCode === profileIssuer))); setCompanyId(current => current || (assigned[0] ? String(assigned[0].id) : '')); onChanged?.(); }, [profileCompany, profileIssuer, onChanged]);
  useEffect(() => { void reload().catch(error => notify(errorMessage(error))); }, [reload]);
  const save = async () => { try { await run(() => api.protectedRegistry.recordPayment({ invoiceId: initialInvoice && String(initialInvoice.companyId) === companyId && initialInvoice.issuerCode === issuerCode ? initialInvoice.id : undefined, companyId: Number(companyId), issuerCode, amount: Number(amount), paymentDate: localToday(), method, operationId: operationId() })); setAmount(''); await reload(); } catch (error) { notify(errorMessage(error)); } };
  const reverse = async (payment: any) => { const values = await ask({ title: 'Reversează încasarea', fields: [{ name: 'reason', label: 'Motivul reversării', type: 'textarea' }] }); if (!values) return; try { await run(() => api.protectedRegistry.reversePayment(payment.id, values.reason, operationId())); await reload(); } catch (error) { notify(errorMessage(error)); } };
  const selectedCompany = companies.find((row) => String(row.id) === companyId);
  const credit = balances.find((row) => row.companyId === selectedCompany?.id && row.issuerCode === issuerCode)?.available || 0;
  const appliedCredit = (invoiceId: string) => creditApplications.filter((application) => application.invoiceId === invoiceId && !application.reversedAt).reduce((sum, application) => sum + Number(application.amount), 0);
  const eligibleInvoices = invoices.filter((invoice) => String(invoice.companyId) === companyId && invoice.issuerCode === issuerCode && invoice.status !== 'cancelled' && invoice.totalAmount - invoice.paidAmount - invoice.creditedAmount - appliedCredit(invoice.id) > 0.005);
  const applyCredit = async () => { if (!creditInvoiceId) return; const values = await ask({ title: 'Aplică credit', message: `Credit disponibil: ${money(credit)}`, fields: [{ name: 'amount', label: 'Suma', type: 'number' }, { name: 'reason', label: 'Motivul aplicării', type: 'textarea' }] }); if (!values) return; try { await run(() => api.protectedRegistry.applyCredit({ invoiceId: creditInvoiceId, amount: Number(values.amount), reason: values.reason, operationId: operationId() })); await reload(); } catch (error) { notify(errorMessage(error)); } };
  const reverseCredit = async (application: any) => { const values = await ask({ title: `Reversează creditul aplicat pe ${application.invoiceReference}`, fields: [{ name: 'reason', label: 'Motivul reversării', type: 'textarea' }] }); if (!values) return; try { await run(() => api.protectedRegistry.reverseCredit(application.id, values.reason, operationId())); await reload(); } catch (error) { notify(errorMessage(error)); } };
  return <div className="space-y-5"><PanelHeading title={creditOnly ? "Aplicări de credit" : "Istoric Plăți"} icon={Banknote} />{!creditOnly && <>{initialInvoice && <p className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-800">Plată pentru {initialInvoice.reference} · {initialInvoice.companyName} · {initialInvoice.storeName}. Factura este prioritară; orice surplus se repartizează către celelalte facturi sau credit disponibil.</p>}<div className="rounded-2xl bg-white border p-5 grid sm:grid-cols-2 xl:grid-cols-5 gap-3"><select aria-label="Companie" disabled={Boolean(profileCompany)} value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="border rounded-xl p-2">{(profileCompany ? [profileCompany] : companies).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><select aria-label="Societate emitentă" disabled={profileIssuer !== "all"} value={issuerCode} onChange={(event) => setIssuerCode(event.target.value as any)} className="border rounded-xl p-2"><option value="goodness">THE GOODNESS BAKER LTD</option><option value="vatra">VATRA ROMANEASCA LTD</option></select><select aria-label="Metoda încasării" value={method} onChange={(event) => setMethod(event.target.value)} className="border rounded-xl p-2"><option value="transfer">Transfer bancar</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Altă metodă</option></select><NumericInput aria-label="Suma încasării în GBP" value={amount} onValueChange={setAmount} min={0.01} placeholder="Suma GBP" /><button onClick={save} className="rounded-xl bg-indigo-600 text-white font-bold">Înregistrează</button><p className="md:col-span-5 text-xs text-slate-500">Încasările cash din acest registru nu modifică automat Daily Cash.</p></div></>}{creditOnly && profileIssuer === 'all' && <label className="block text-sm font-semibold">Emitentul creditului<select className="block mt-2" value={issuerCode} onChange={event => { setIssuerCode(event.target.value as any); setCreditInvoiceId(''); }}><option value="goodness">THE GOODNESS BAKER LTD</option><option value="vatra">VATRA ROMANEASCA LTD</option></select></label>}<div className="protected-payment-credit rounded-2xl bg-white border p-5 flex gap-3 items-center"><b>Credit disponibil: {money(credit)}</b><select value={creditInvoiceId} onChange={(event) => setCreditInvoiceId(event.target.value)} className="border rounded-xl p-2 flex-1"><option value="">Factura pe care aplici creditul</option>{eligibleInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.reference} · rest {money(invoice.totalAmount - invoice.paidAmount - invoice.creditedAmount - appliedCredit(invoice.id))}</option>)}</select><button disabled={credit <= 0.005 || !creditInvoiceId} onClick={applyCredit} className="bg-emerald-600 text-white rounded-xl px-4 py-2 disabled:opacity-50">Aplică credit</button></div>{!creditOnly && <div className="rounded-2xl bg-white border divide-y"><h2 className="p-4 font-bold">Istoric încasări</h2>{payments.map((payment) => <div key={payment.id} className={`p-4 flex justify-between gap-4 ${payment.reversedAt ? 'opacity-50' : ''}`}><div className="min-w-0"><p className="font-semibold text-slate-900 break-words">{payment.companyName}</p><p className="text-sm text-slate-600">{payment.invoiceReference ? payment.invoiceReference + (payment.storeName ? ' · ' + payment.storeName : '') : payment.invoiceId ? 'Factură istorică indisponibilă' : 'Avans / Credit disponibil'}</p><small className="text-slate-500">{payment.paymentDate} · {({ cash: 'Cash', transfer: 'Transfer bancar', card: 'Card', other: 'Altă metodă' } as Record<string, string>)[payment.method] || payment.method} · {payment.issuerCode === 'goodness' ? 'THE GOODNESS BAKER LTD' : 'VATRA ROMANEASCA LTD'}{payment.reversedAt && ' · REVERSATĂ'}</small>{payment.notes && <p className="text-sm text-slate-500">{payment.notes}</p>}</div><div className="flex gap-3"><b>{money(payment.amount)}</b>{!payment.reversedAt && <button onClick={() => reverse(payment)} className="text-red-700">Reversează</button>}</div></div>)}{!payments.length && <p className="p-5 text-slate-500">Nu există încasări pentru selecția curentă.</p>}</div>}<div className="rounded-2xl bg-white border divide-y"><h2 className="p-4 font-bold">Aplicări de credit</h2>{creditApplications.map((application) => <div key={application.id} className={`p-4 flex justify-between gap-4 ${application.reversedAt ? 'opacity-50' : ''}`}><span>{application.createdAt.slice(0, 10)} · {application.companyName} · {application.invoiceReference} · {application.issuerCode.toUpperCase()}{application.reversedAt && ' · REVERSAT'}</span><div className="flex gap-3"><b>{money(application.amount)}</b>{!application.reversedAt && <button onClick={() => reverseCredit(application)} className="text-red-700">Reversează</button>}</div></div>)}{!creditApplications.length && <p className="p-5 text-slate-500">Nu există aplicări de credit.</p>}</div>{dialog}</div>;
}

function CreditNotesPanel({ invoiceId, companyId, issuer = 'all', onChanged }: { invoiceId?: string; companyId?: number; issuer?: string; onChanged?: () => void }) {
  const run = useContext(CloudActionContext);
  const { ask, dialog } = useInputDialog();
  const [draft, setDraft] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<string, { quantity: string; unitAmount: string; returnToStock: boolean }>>({});
  const [reason, setReason] = useState('');
  const [issueDate, setIssueDate] = useState(localToday());
  const reload = useCallback(async () => {
    const [nextDraft, nextNotes] = await Promise.all([api.protectedRegistry.getCreditNoteDraft(), api.protectedRegistry.getCreditNotes()]);
    const belongs = (row: any) => (companyId === undefined || row.companyId === companyId) && (issuer === 'all' || row.issuerCode === issuer);
    setDraft(nextDraft.filter(belongs)); setNotes(nextNotes.filter(belongs)); onChanged?.();
  }, [companyId, issuer, onChanged]);
  useEffect(() => { void reload().catch(error => notify(errorMessage(error))); }, [reload]);
  const selectedSource = Object.keys(selected)[0];
  const anchor = draft.find((invoice) => invoice.items.some((item: any) => item.id === selectedSource));
  const toggle = (invoice: any, item: any) => {
    if (!selected[item.id] && anchor && (anchor.companyKey !== invoice.companyKey || anchor.issuerCode !== invoice.issuerCode)) {
      notify('Un Credit Note poate reuni numai facturi ale aceleiași companii și aceluiași emitent.');
      return;
    }
    setSelected((current) => {
      if (current[item.id]) { const next = { ...current }; delete next[item.id]; return next; }
      return { ...current, [item.id]: { quantity: String(Math.max(0, item.quantity - item.creditedQuantity)), unitAmount: String(item.unitPrice), returnToStock: false } };
    });
  };
  const issue = async () => {
    if (!reason.trim() || !Object.keys(selected).length) return notify('Selectează pozițiile și completează motivul.');
    if (Object.values(selected).some((value) => !value.quantity.trim() || !value.unitAmount.trim() || !Number.isFinite(Number(value.quantity)) || Number(value.quantity) <= 0 || !Number.isFinite(Number(value.unitAmount)) || Number(value.unitAmount) <= 0)) {
      return notify('Completează cantitatea și prețul fiecărei poziții bifate cu valori mai mari decât zero.');
    }
    const backdateValues = issueDate < localToday() ? await ask({ title: 'Credit Note antedatat', fields: [{ name: 'reason', label: 'Motivul antedatării', type: 'textarea' }] }) : null;
    if (issueDate < localToday() && !backdateValues) return;
    const backdateReason = backdateValues?.reason;
    try {
      const result = await run(() => api.protectedRegistry.createCreditNote({
        issueDate, reason, backdateReason, operationId: operationId(),
        items: Object.entries(selected).map(([invoiceItemId, value]) => ({ invoiceItemId, quantity: Number(value.quantity), unitAmount: Number(value.unitAmount), returnToStock: value.returnToStock })),
      }));
      notify(result.pdf.success ? `Credit Note ${result.creditNote.reference} a fost emis și salvat în Drive.` : `Credit Note-ul a fost emis, dar PDF-ul trebuie regenerat: ${result.pdf.error}`);
      setSelected({}); setReason(''); await reload();
    } catch (error) { notify(errorMessage(error)); }
  };
  const cancel = async (note: any) => {
    const values = await ask({ title: `Anulează ${note.reference}`, message: 'Anularea internă nu înlocuiește documentul corectiv cerut contabil.', fields: [{ name: 'reason', label: 'Motivul anulării', type: 'textarea' }, { name: 'acknowledge', label: 'Scrie CONFIRM pentru a continua' }] });
    if (!values || values.acknowledge.trim().toUpperCase() !== 'CONFIRM') return;
    try { await run(() => api.protectedRegistry.cancelCreditNote(note.id, values.reason, true, operationId())); await reload(); } catch (error) { notify(errorMessage(error)); }
  };
  const remove = async (note: any) => { const values = await ask({ title: `Șterge definitiv ${note.reference}`, message: `Scrie exact STERGE ${note.reference}`, fields: [{ name: 'confirmation', label: 'Confirmare' }] }); if (!values) return; try { await run(() => api.protectedRegistry.deleteTestCreditNote(note.id, values.confirmation, operationId())); await reload(); } catch (error) { notify(errorMessage(error)); } };
  return <div className="space-y-6"><PanelHeading title="Credit Notes" description="Credit integral sau parțial, cu retur opțional în stocul normal." icon={FileMinus2} /><section className="rounded-2xl bg-white border p-5 space-y-4"><div className="grid md:grid-cols-[180px_1fr_auto] gap-3"><input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} className="border rounded-xl p-2" /><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motiv obligatoriu" className="border rounded-xl p-2" /><button onClick={issue} className="rounded-xl bg-indigo-600 text-white px-4 font-bold">Emite Credit Note</button></div>{draft.filter(invoice => !invoiceId || invoice.id === invoiceId).map((invoice) => <div key={invoice.id} className="border rounded-xl overflow-hidden"><header className="bg-slate-50 p-3 font-bold">{invoice.reference} · {invoice.companyName} · {invoice.storeName}</header>{invoice.items.map((item: any) => { const value = selected[item.id]; const remaining = Math.max(0, item.quantity - item.creditedQuantity); return <div key={item.id} className="protected-credit-line p-3 border-t gap-3 items-center"><input type="checkbox" aria-label={`Selectează ${item.productName} din ${invoice.reference}`} checked={Boolean(value)} disabled={remaining <= 0.005} onChange={() => toggle(invoice, item)} /><BilingualProductName name={item.productName} nameRo={item.productNameRo} /><label className="text-xs font-semibold text-slate-500">Cantitate<NumericInput className="mt-1" decimalScale={3} aria-label={`Cantitate creditată · ${invoice.reference} · ${item.productName}`} value={value?.quantity ?? String(remaining)} disabled={!value} onValueChange={(next) => setSelected((current) => ({ ...current, [item.id]: { ...current[item.id], quantity: next } }))} /></label><label className="text-xs font-semibold text-slate-500">Preț creditat (£)<NumericInput className="mt-1" aria-label={`Preț creditat · ${invoice.reference} · ${item.productName}`} value={value?.unitAmount ?? String(item.unitPrice)} disabled={!value} onValueChange={(next) => setSelected((current) => ({ ...current, [item.id]: { ...current[item.id], unitAmount: next } }))} /></label><label className="text-xs"><input type="checkbox" disabled={!value || !item.finishedProductId} checked={value?.returnToStock || false} onChange={(event) => setSelected((current) => ({ ...current, [item.id]: { ...current[item.id], returnToStock: event.target.checked } }))} /> Retur stoc</label></div>; })}</div>)}</section><section className="rounded-2xl bg-white border divide-y"><h2 className="p-4 font-bold">Documente emise</h2>{notes.map((note) => <div key={note.id} className="p-4 flex items-center gap-4"><div className="flex-1"><b>{note.reference}</b><small className="block text-slate-500">{note.issueDate} · {note.companyName} · {note.issuerCode.toUpperCase()}</small></div><b>{money(note.totalAmount)}</b><ProtectedDocumentActions type="credit-note" id={note.id} status={note.status} notify={notify} />{note.status !== 'cancelled' && <button title="Anulează Credit Note" aria-label="Anulează Credit Note" onClick={() => cancel(note)} className="rounded-lg p-2 text-amber-700 hover:bg-amber-50"><Ban size={17} /></button>}{note.testDocument && note.status === 'cancelled' && <button title="Șterge documentul de test" aria-label="Șterge documentul de test" onClick={() => remove(note)} className="text-red-700"><Trash2 size={17} /></button>}</div>)}</section>{dialog}</div>;
}

function ExportsPanel() {
  const cloudAction = useContext(CloudActionContext);
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const result = await cloudAction(() => api.protectedRegistry.exportMonth(month)); notify(`Export verificat în Drive: ${result.excelName}, ${result.pdfCount} PDF-uri.`); }
    catch (error) { notify(errorMessage(error)); } finally { setBusy(false); }
  };
  return <div className="space-y-5"><PanelHeading title="Exporturi lunare" description="Excel contabil și copii ale PDF-urilor, separate de registrul normal." icon={FileSpreadsheet} /><section className="rounded-2xl bg-white border p-6 flex gap-3 items-end"><label className="text-sm font-semibold">Luna<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="block border rounded-xl p-2 mt-1" /></label><button disabled={busy} onClick={run} className="rounded-xl bg-indigo-600 text-white px-5 py-2.5 font-bold disabled:opacity-50">{busy ? 'Se exportă…' : 'Generează exportul'}</button></section></div>;
}

function SettingsPanel({ overview, reloadOverview }: { overview: any; reloadOverview: () => Promise<void> }) {
  const run = useContext(CloudActionContext);
  const { ask, dialog } = useInputDialog();
  const [currentPin, setCurrentPin] = useState(''); const [newPin, setNewPin] = useState(''); const [confirm, setConfirm] = useState('');
  const goLive = async () => { const values = await ask({ title: 'Activează registrul LIVE', message: 'După prima emitere live, Modul test nu mai poate fi reactivat. Scrie exact ACTIVEAZA LIVE.', fields: [{ name: 'confirmation', label: 'Confirmare' }] }); if (!values) return; try { await run(() => api.protectedRegistry.setMode('live', values.confirmation, operationId())); await reloadOverview(); } catch (error) { notify(errorMessage(error)); } };
  const clearTestData = async () => { const values = await ask({ title: 'Curăță datele financiare de test', message: 'Mai întâi șterge facturile și Credit Notes de test. Se creează automat un backup criptat. Scrie exact CURATA TEST.', fields: [{ name: 'confirmation', label: 'Confirmare' }] }); if (!values) return; try { await run(() => api.protectedRegistry.clearTestFinancialData(values.confirmation, operationId())); notify('Încasările și creditele de test au fost eliminate.'); await reloadOverview(); } catch (error) { notify(errorMessage(error)); } };
  const changePin = async () => { try { await run(() => api.protectedRegistry.changePin(currentPin, newPin, confirm)); setCurrentPin(''); setNewPin(''); setConfirm(''); notify('PIN-ul a fost schimbat.'); } catch (error) { notify(errorMessage(error)); } };
  return <div className="space-y-5"><PanelHeading title="Setări registru" icon={Settings} /><section className="rounded-2xl bg-white border p-5 space-y-3"><h2 className="font-bold">Mod și contoare</h2><p>Mod curent: <b className={overview?.mode === 'test' ? 'text-amber-700' : 'text-emerald-700'}>{overview?.mode?.toUpperCase()}</b></p><div className="grid grid-cols-2 xl:grid-cols-4 gap-3">{Object.entries(overview?.counters || {}).map(([key, value]) => <div key={key} className="bg-slate-50 rounded-xl p-3"><small>{key}</small><b className="block text-xl">{String(value)}</b></div>)}</div>{overview?.mode === 'test' && <div className="flex gap-3"><button onClick={clearTestData} className="rounded-xl bg-amber-600 text-white px-4 py-2 font-bold">Curăță datele de test</button><button onClick={goLive} className="rounded-xl bg-emerald-600 text-white px-4 py-2 font-bold">Treci registrul LIVE</button></div>}</section><BillingSettings scope="shared" runAction={run} /><section className="rounded-2xl bg-white border p-5 space-y-3"><h2 className="font-bold">Schimbă PIN</h2><div className="grid md:grid-cols-3 gap-3"><PinInput placeholder="PIN actual" value={currentPin} onValueChange={setCurrentPin} className="border rounded-xl p-2" /><PinInput placeholder="PIN nou" value={newPin} onValueChange={setNewPin} className="border rounded-xl p-2" /><PinInput placeholder="Confirmă PIN" value={confirm} onValueChange={setConfirm} className="border rounded-xl p-2" /></div><button onClick={changePin} className="rounded-xl bg-slate-900 text-white px-4 py-2">Schimbă PIN</button></section>{dialog}</div>;
}

function ProtectedWorkspace({ onLocked }: { onLocked: () => void }) {
  const [active, setActive] = useState<(typeof tabs)[number][0]>('dashboard');
  const [creditInvoiceId, setCreditInvoiceId] = useState<string>();
  const [paymentInvoice, setPaymentInvoice] = useState<any>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = useCallback<CloudAction>(async action => {
    if (savingRef.current) throw new Error('O operațiune este deja în curs. Așteaptă confirmarea din Drive.');
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await action();
      if (!mounted.current) throw new Error('Registrul a fost blocat. Deblochează-l pentru a verifica rezultatul operațiunii.');
      return result;
    }
    finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  }, []);
  const [overview, setOverview] = useState<any>(null);
  const reloadOverview = useCallback(async () => setOverview(await api.protectedRegistry.getOverview()), []);
  useEffect(() => { void reloadOverview(); }, [reloadOverview]);
  useEffect(() => () => { void api.protectedRegistry.lock(); }, []);
  useEffect(() => {
    let lastTouch = 0;
    const touch = () => { if (Date.now() - lastTouch < 30_000) return; lastTouch = Date.now(); void api.protectedRegistry.touch().catch(onLocked); };
    window.addEventListener('pointerdown', touch); window.addEventListener('keydown', touch);
    return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); };
  }, [onLocked]);
  const exit = async () => { await api.protectedRegistry.lock().catch(() => undefined); onLocked(); window.location.hash = '/'; };
  return <CloudActionContext.Provider value={run}><div className="protected-workspace h-screen flex bg-slate-50 overflow-hidden"><aside className="protected-sidebar w-64 bg-slate-900 text-white flex flex-col shadow-xl"><header className="p-5 border-b border-slate-800"><div className="flex gap-3 items-center"><ShieldCheck className="text-indigo-400" /><b>Registru separat</b></div><span className={`inline-block mt-3 rounded-full px-2 py-1 text-xs font-bold ${overview?.mode === 'live' ? 'bg-emerald-600' : 'bg-amber-500'}`}>{overview?.mode?.toUpperCase() || '…'}</span></header><nav className="flex-1 p-3 overflow-y-auto">{tabs.map(([id, label, Icon]) => <button key={id} disabled={saving} aria-current={active === id ? "page" : undefined} onClick={() => { setCreditInvoiceId(undefined); setPaymentInvoice(undefined); setActive(id); }} className={`w-full rounded-xl px-3 py-2.5 flex gap-3 items-center text-sm mb-1 ${active === id ? 'bg-indigo-600' : 'text-slate-300 hover:bg-slate-800'}`}><Icon size={18} />{label}</button>)}</nav><button onClick={exit} className="m-3 rounded-xl bg-slate-800 p-3 flex gap-2 justify-center"><LogOut size={18} />Blochează și ieși</button></aside><FeedbackHost controller={protectedFeedback} /><main data-navigation-scroll className="protected-main flex-1 overflow-y-auto p-8">{saving && <div role="status" className="sticky top-0 z-20 mb-4 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800"><RefreshCw size={18} className="animate-spin motion-reduce:animate-none" />Se salvează și se verifică în Google Drive. Nu închide aplicația.<span className="sr-only">Datele nu se salvează local.</span></div>}<fieldset disabled={saving} aria-busy={saving} className="protected-content"><NavigationView name={active} restore={active !== 'clients'}>{active === 'dashboard' && <DashboardPanel />}{active === 'clients' && <ClientsPanel />}{active === 'orders' && <OrdersPanel />}{active === 'invoices' && <InvoicesPanel onCreditNote={id => { setCreditInvoiceId(id); setActive('credit-notes'); }} onPayment={invoice => { setPaymentInvoice(invoice); setActive('payments'); }} />}{active === 'manual' && <ManualInvoicePanel />}{active === 'payments' && <PaymentsPanel initialInvoice={paymentInvoice} />}{active === 'settings' && <SettingsPanel overview={overview} reloadOverview={reloadOverview} />}{active === 'credit-notes' && <CreditNotesPanel invoiceId={creditInvoiceId} />}{active === 'exports' && <ExportsPanel />}</NavigationView></fieldset></main></div></CloudActionContext.Provider>;
}

export function ProtectedRegistry() {
  const [status, setStatus] = useState<any>(null);
  const [denied, setDenied] = useState('');
  const reload = useCallback(async () => { try { setStatus(await api.protectedRegistry.status()); setDenied(''); } catch (error) { setDenied(errorMessage(error)); } }, []);
  useEffect(() => { void reload(); }, [reload]);
  if (denied) return <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6"><div className="rounded-2xl bg-white p-8 max-w-md"><Lock className="text-red-600 mb-4" /><h1 className="text-2xl font-bold">Acces indisponibil</h1><p className="text-slate-600 mt-2">{denied}</p><button onClick={() => { window.location.hash = '/'; }} className="mt-5 flex gap-2 text-indigo-700"><ArrowLeft size={18} />Înapoi la Hub</button></div></div>;
  if (!status) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center"><RefreshCw className="animate-spin" /></div>;
  if (!status.unlocked) return <ProtectedAccess status={status} onUnlocked={reload} />;
  if (status.readOnly) return <NavigationMemory key="viewer"><ProtectedViewer onLocked={() => setStatus((current: any) => ({ ...current, unlocked: false }))} /></NavigationMemory>;
  return <NavigationMemory key="writer"><ProtectedWorkspace onLocked={() => setStatus((current: any) => ({ ...current, unlocked: false }))} /></NavigationMemory>;
}

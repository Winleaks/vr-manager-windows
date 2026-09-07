import { createFeedbackController } from '../utils/feedback';
import { FeedbackHost } from '../components/FeedbackHost';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Banknote,
  FileMinus2,
  FilePlus2,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  LogOut,
  Receipt,
  RefreshCw,
  RotateCw,
  ExternalLink,
  Share2,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Users,
} from 'lucide-react';
import { api } from '../shared/api';
import { NumericInput } from '../components/NumericInput';
import { PinInput } from '../components/PinInput';
import { BilingualProductName } from '../components/BilingualProductName';
import { registerProtectedRegistryAccessClick } from '../utils/protectedRegistryAccess';

const protectedFeedback = createFeedbackController();
const { notify, confirmAction } = protectedFeedback;

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
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.name, field.initialValue || ''])));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (fields.some((field) => !values[field.name]?.trim())) return;
    onClose(values);
  };
  return <div className="fixed inset-0 z-[300] bg-slate-950/70 flex items-center justify-center p-5" role="dialog" aria-modal="true">
    <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
      <div><h2 className="text-xl font-bold">{title}</h2>{message && <p className="text-sm text-slate-500 mt-1">{message}</p>}</div>
      {fields.map((field, index) => <label key={field.name} className="block text-sm font-semibold">{field.label}{field.type === 'textarea'
        ? <textarea autoFocus={index === 0} value={values[field.name]} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} className="mt-1 w-full min-h-24 rounded-xl border p-3 font-normal" />
        : field.type === 'number'
          ? <NumericInput autoFocus={index === 0} value={values[field.name]} placeholder={field.placeholder} onValueChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} className="mt-1 w-full rounded-xl border p-3 font-normal" />
          : <input autoFocus={index === 0} value={values[field.name]} type={field.type || 'text'} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} className="mt-1 w-full rounded-xl border p-3 font-normal" />}</label>)}
      <div className="flex justify-end gap-3"><button type="button" onClick={() => onClose(null)} className="rounded-xl border px-4 py-2">Renunță</button><button type="submit" className="rounded-xl bg-indigo-600 text-white px-4 py-2 font-bold">Confirmă</button></div>
    </form>
  </div>;
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
      if (!status.configured) {
        const result = await api.protectedRegistry.configure(pin, confirmation);
        setOneTimeKey(result.recoveryKey);
        return;
      }
      if (recoveryMode) await api.protectedRegistry.recover(recoveryKey, pin, confirmation);
      else await api.protectedRegistry.unlock(pin);
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
      <div><h1 className="text-2xl font-bold text-slate-900">Registru separat</h1><p className="text-sm text-slate-500 mt-1">Acces administrativ Writer, protejat de PIN și Google Drive.</p></div>
      {!status.secureStorageAvailable && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Stocarea securizată a sistemului nu este disponibilă.</p>}
      {status.lockedUntil && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Acces blocat până la {new Date(status.lockedUntil).toLocaleTimeString('ro-RO')}.</p>}
      {recoveryMode && <label className="block text-sm font-semibold text-slate-700">Cheie de recuperare<input value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono" autoComplete="off" /></label>}
      <label className="block text-sm font-semibold text-slate-700">{recoveryMode ? 'PIN nou' : status.configured ? 'PIN' : 'PIN nou'}<PinInput value={pin} onValueChange={setPin} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-xl tracking-[.5em]" autoFocus /></label>
      {(!status.configured || recoveryMode) && <label className="block text-sm font-semibold text-slate-700">Confirmă PIN-ul<PinInput value={confirmation} onValueChange={setConfirmation} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-xl tracking-[.5em]" /></label>}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy || Boolean(status.lockedUntil)} onClick={submit} className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Se verifică…' : !status.configured ? 'Configurează registrul' : recoveryMode ? 'Recuperează accesul' : 'Deblochează'}</button>
      {status.configured && <button onClick={() => setRecoveryMode((value) => !value)} className="w-full text-sm text-indigo-700">{recoveryMode ? 'Înapoi la PIN' : 'Folosește cheia de recuperare'}</button>}
      <button onClick={() => { window.location.hash = '/'; }} className="w-full text-sm text-slate-500">Înapoi la Hub</button>
    </div>
  </div>;
}

const tabs = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['orders', 'Comenzi', ShoppingBag],
  ['invoices', 'Facturi', Receipt],
  ['manual', 'Factură manuală', FilePlus2],
  ['clients', 'Clienți', Users],
  ['payments', 'Încasări', Banknote],
  ['credit-notes', 'Credit Notes', FileMinus2],
  ['exports', 'Exporturi', FileSpreadsheet],
  ['settings', 'Setări', Settings],
] as const;

function DashboardPanel() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.protectedRegistry.getOverview().then(setData).catch((error) => notify(errorMessage(error))); }, []);
  if (!data) return <p className="text-slate-500">Se încarcă…</p>;
  const cards = [['Clienți atribuiți', data.assignedCompanies], ['Facturi', data.invoices], ['Facturat', money(data.invoiced)], ['Creditat', money(data.credited)], ['Încasat', money(data.paid)], ['Credit disponibil', money(data.availableCredit)], ['Rest de plată', money(data.outstanding)]];
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Dashboard registru separat</h1><p className="text-slate-500">Evidență oficială independentă de registrul normal.</p></div><div className="grid md:grid-cols-4 gap-4">{cards.map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-white border border-slate-200 p-5"><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold mt-2">{value}</p></div>)}</div><div className="grid md:grid-cols-2 gap-4">{([['THE GOODNESS BAKER LTD', data.byIssuer?.goodness], ['VATRA ROMANEASCA LTD', data.byIssuer?.vatra]] as const).map(([name, values]) => <section key={name} className="rounded-2xl bg-white border p-5"><h2 className="font-bold mb-3">{name}</h2><div className="grid grid-cols-2 gap-2 text-sm"><span>Facturat</span><b className="text-right">{money(values?.invoiced)}</b><span>Creditat</span><b className="text-right">{money(values?.credited)}</b><span>Încasat</span><b className="text-right">{money(values?.paid)}</b><span>Credit disponibil</span><b className="text-right">{money(values?.availableCredit)}</b><span>Rest de plată</span><b className="text-right">{money(values?.outstanding)}</b></div></section>)}</div></div>;
}

function ClientsPanel() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const reload = useCallback(() => api.protectedRegistry.getCompanies().then(setCompanies), []);
  useEffect(() => { void reload(); }, [reload]);
  const toggle = async (company: any) => {
    setBusy(company.id);
    try { await api.protectedRegistry.setAssignment(company.id, !company.assigned, operationId()); await reload(); }
    catch (error) { notify(errorMessage(error)); } finally { setBusy(null); }
  };
  return <div className="space-y-5"><div><h1 className="text-3xl font-bold">Clienți atribuiți</h1><p className="text-slate-500">Atribuirea include toate magazinele companiei și exclude comenzile din facturarea normală.</p></div><div className="rounded-2xl bg-white border border-slate-200 divide-y">{companies.map((company) => <div key={company.id} className="p-4 flex items-center justify-between gap-4"><div><p className="font-bold">{company.name}</p><p className="text-sm text-slate-500">{company.issuerName || 'Emitent implicit'} · {company.stores.length} magazine</p></div><button disabled={busy === company.id} onClick={() => toggle(company)} className={`rounded-xl px-4 py-2 font-semibold ${company.assigned ? 'bg-red-50 text-red-700' : 'bg-indigo-600 text-white'}`}>{company.assigned ? 'Elimină din registru' : 'Adaugă în registru'}</button></div>)}</div></div>;
}

function OrdersPanel() {
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
    try { const result = await api.protectedRegistry.createWeekly(startDate, endDate, selected, operationId()); const failed = result.pdfResults.filter((row: any) => !row.success); notify(failed.length ? `Facturile au fost emise. ${failed.length} PDF-uri trebuie regenerate.` : `${result.invoices.length} facturi au fost emise și verificate în Drive.`); await load(); }
    catch (error) { notify(errorMessage(error)); } finally { setBusy(false); }
  };
  const issueZone = async (zoneId: string, rows: any[]) => {
    const ready = rows.filter((row) => row.billingState === 'ready');
    const zoneName = rows[0]?.store.zone?.name || 'FĂRĂ ZONĂ ALOCATĂ';
    if (!ready.length || !(await confirmAction(`Emiți ${ready.length} facturi pentru zona ${zoneName}?`))) return;
    setBusy(true);
    try {
      const result = await api.protectedRegistry.createWeeklyByZone(startDate, endDate, zoneId === 'none' ? null : zoneId, operationId());
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
      const result = await api.protectedRegistry.createAllWeekly(startDate, endDate, operationId());
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
  return <div className="space-y-5"><div><h1 className="text-3xl font-bold">Comenzi protejate</h1><p className="text-slate-500">Numai comenzile open/locked ale clienților atribuiți.</p></div><div className="rounded-2xl bg-white border p-4 flex flex-wrap gap-3 items-end"><label className="text-sm">Luni<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="block border rounded-lg p-2" /></label><label className="text-sm">Duminică<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="block border rounded-lg p-2" /></label><button onClick={load} disabled={busy} className="rounded-xl bg-slate-900 text-white px-4 py-2.5 flex gap-2"><RefreshCw size={18} />Actualizează</button><button onClick={issue} disabled={busy || !selected.length} className="rounded-xl bg-indigo-600 text-white px-4 py-2.5 disabled:opacity-50">Generează selectate</button><button onClick={issueAll} disabled={busy || !preview?.ordersByStore?.some((row: any) => row.billingState === 'ready')} className="rounded-xl bg-emerald-600 text-white px-4 py-2.5 disabled:opacity-50">Generează toate</button></div>{[...byZone.entries()].map(([zoneId, rows]) => { const readyCount = rows.filter((row) => row.billingState === 'ready').length; const total = rows.filter((row) => row.billingState === 'ready').reduce((sum, row) => sum + row.items.reduce((itemSum: number, item: any) => itemSum + item.totalPrice, 0), 0); return <section key={zoneId} className="rounded-2xl bg-white border overflow-hidden"><header className="p-4 bg-slate-50 font-bold flex items-center gap-3"><span className="flex-1">{rows[0]?.store.zone?.name || 'FĂRĂ ZONĂ ALOCATĂ'} · {rows[0]?.store.zone?.driver?.name || 'Fără șofer'}<small className="block text-slate-500 font-normal">{readyCount} pregătite · {money(total)}</small></span><button onClick={() => issueZone(zoneId, rows)} disabled={busy || !readyCount} className="rounded-lg bg-indigo-600 text-white px-3 py-2 text-sm disabled:opacity-50">Generează zona</button></header>{rows.map((row: any) => <label key={row.store.id} className="p-4 border-t flex gap-3 items-center"><input type="checkbox" disabled={row.billingState !== 'ready'} checked={selected.includes(row.store.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.store.id] : current.filter((id) => id !== row.store.id))} /><span className="flex-1"><b>{row.store.name}</b><small className="block text-slate-500">{row.store.company?.name} · {row.issuer?.issuerName}</small></span><span className="font-bold">{money(row.items.reduce((sum: number, item: any) => sum + item.totalPrice, 0))}</span></label>)}</section>; })}</div>;
}

function InvoicesPanel() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const { ask, dialog } = useInputDialog();
  const reload = useCallback(() => api.protectedRegistry.getInvoices().then(setInvoices), []);
  useEffect(() => { void reload(); }, [reload]);
  const cancel = async (invoice: any) => { const values = await ask({ title: `Anulează ${invoice.reference}`, fields: [{ name: 'reason', label: 'Motivul anulării', type: 'textarea' }] }); if (!values) return; try { await api.protectedRegistry.cancelInvoice(invoice.id, values.reason, operationId()); await reload(); } catch (error) { notify(errorMessage(error)); } };
  const remove = async (invoice: any) => { const values = await ask({ title: `Șterge definitiv ${invoice.reference}`, message: `Scrie exact STERGE ${invoice.reference}`, fields: [{ name: 'confirmation', label: 'Confirmare' }] }); if (!values) return; try { await api.protectedRegistry.deleteTestInvoice(invoice.id, values.confirmation, operationId()); await reload(); } catch (error) { notify(errorMessage(error)); } };
  const open = async (invoice: any) => { try { await api.protectedRegistry.openDocument('invoice', invoice.id); } catch (error) { notify(errorMessage(error)); } };
  const share = async (invoice: any) => { try { await api.protectedRegistry.shareDocument('invoice', invoice.id); } catch (error) { notify(errorMessage(error)); } };
  const reissue = async (invoice: any) => { if (!(await confirmAction(`Reemiți ${invoice.reference} cu un număr nou și emitentul actual al clientului?`))) return; try { const result = await api.protectedRegistry.reissueInvoice(invoice.id, operationId()); notify(result.pdf.success ? `Factura ${result.invoice.reference} a fost reemisă.` : `Factura ${result.invoice.reference} a fost reemisă, dar PDF-ul trebuie regenerat.`); await reload(); } catch (error) { notify(errorMessage(error)); } };
  return <div className="space-y-5"><h1 className="text-3xl font-bold">Facturi</h1><div className="rounded-2xl bg-white border overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{['Factură','Data','Client / Magazin','Emitent','Total','Status','Acțiuni'].map((value) => <th key={value} className="p-3 text-left">{value}</th>)}</tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-t"><td className="p-3 font-bold">#{invoice.reference}{invoice.testDocument && <small className="block text-red-600">TEST</small>}{invoice.replacesInvoiceId && <small className="block text-indigo-600">REEMISĂ</small>}</td><td className="p-3">{invoice.invoiceDate}</td><td className="p-3">{invoice.companyName}<small className="block text-slate-500">{invoice.storeName}</small></td><td className="p-3 uppercase">{invoice.issuerCode}</td><td className="p-3 font-bold">{money(invoice.totalAmount)}</td><td className="p-3">{invoice.status}</td><td className="p-3 flex gap-2"><button title="Deschide PDF" onClick={() => open(invoice)}><ExternalLink size={17} /></button><button title="Trimite prin Windows Share" onClick={() => share(invoice)}><Share2 size={17} /></button>{invoice.status !== 'cancelled' && <button onClick={() => cancel(invoice)} className="text-amber-700">Anulează</button>}{invoice.status === 'cancelled' && !invoice.replacedByInvoiceId && <button title="Reemite cu număr nou" onClick={() => reissue(invoice)} className="text-indigo-700"><RotateCw size={17} /></button>}{invoice.testDocument && <button onClick={() => remove(invoice)} className="text-red-700"><Trash2 size={17} /></button>}</td></tr>)}</tbody></table></div>{dialog}</div>;
}

function ManualInvoicePanel() {
  const [data, setData] = useState<any>({ companies: [], products: [] });
  const [companyId, setCompanyId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [date, setDate] = useState(localToday());
  const [lines, setLines] = useState<any[]>([]);
  useEffect(() => { api.protectedRegistry.getManualData().then((value) => { setData(value); if (value.companies[0]) setCompanyId(String(value.companies[0].id)); }); }, []);
  const company = data.companies.find((row: any) => String(row.id) === companyId);
  useEffect(() => { setStoreId(company?.stores?.[0] ? String(company.stores[0].id) : ''); }, [company]);
  const add = (productId: string) => { const product = data.products.find((row: any) => String(row.id) === productId); if (!product || lines.some((row) => row.productId === product.id)) return; setLines((current) => [...current, { productId: product.id, quantity: '1', unitPrice: Number(product.price_standard || 0).toFixed(2) }]); };
  const issue = async () => { if (!storeId || !lines.length) return; try { const result = await api.protectedRegistry.createManualInvoice({ storeId: Number(storeId), invoiceDate: date, items: lines, operationId: operationId() }); notify(result.pdf.success ? `Factura ${result.invoice.reference} a fost emisă și salvată în Drive.` : `Factura ${result.invoice.reference} a fost emisă, dar PDF-ul a eșuat: ${result.pdf.error}`); setLines([]); } catch (error) { notify(errorMessage(error)); } };
  return <div className="space-y-5"><h1 className="text-3xl font-bold">Factură manuală</h1><div className="rounded-2xl bg-white border p-5 grid md:grid-cols-3 gap-4"><label>Companie<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="block w-full border rounded-xl p-2"><option value="">Selectează</option>{data.companies.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Magazin<select value={storeId} onChange={(event) => setStoreId(event.target.value)} className="block w-full border rounded-xl p-2">{(company?.stores || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Data<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="block w-full border rounded-xl p-2" /></label><label className="md:col-span-3">Adaugă produs<select value="" onChange={(event) => add(event.target.value)} className="block w-full border rounded-xl p-2"><option value="">Selectează produs</option>{data.products.filter((product: any) => product.available).map((product: any) => <option key={product.id} value={product.id}>{product.name} / {product.name_ro}</option>)}</select></label></div><div className="rounded-2xl bg-white border divide-y">{lines.map((line, index) => { const product = data.products.find((row: any) => row.id === line.productId); return <div key={line.productId} className="p-4 grid grid-cols-[1fr_120px_140px_40px] gap-3 items-center"><BilingualProductName name={product?.name} nameRo={product?.name_ro} /><NumericInput value={line.quantity} onValueChange={(value: string) => setLines((current) => current.map((row, i) => i === index ? { ...row, quantity: value } : row))} min={0.01} /><NumericInput value={line.unitPrice} onValueChange={(value: string) => setLines((current) => current.map((row, i) => i === index ? { ...row, unitPrice: value } : row))} min={0} /><button onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><Trash2 size={18} /></button></div>; })}</div><button onClick={issue} className="rounded-xl bg-indigo-600 text-white px-5 py-3 font-bold">Emite factura</button></div>;
}

function PaymentsPanel() {
  const { ask, dialog } = useInputDialog();
  const [companies, setCompanies] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [issuerCode, setIssuerCode] = useState<'goodness' | 'vatra'>('goodness');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('transfer');
  const [balances, setBalances] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [creditApplications, setCreditApplications] = useState<any[]>([]);
  const [creditInvoiceId, setCreditInvoiceId] = useState('');
  const reload = useCallback(async () => { const [nextCompanies, nextPayments, nextBalances, nextInvoices, nextApplications] = await Promise.all([api.protectedRegistry.getCompanies(), api.protectedRegistry.getPayments(), api.protectedRegistry.getCreditBalances(), api.protectedRegistry.getInvoices(), api.protectedRegistry.getCreditApplications()]); const assigned = nextCompanies.filter((row: any) => row.assigned); setCompanies(assigned); setPayments(nextPayments); setBalances(nextBalances); setInvoices(nextInvoices); setCreditApplications(nextApplications); if (!companyId && assigned[0]) setCompanyId(String(assigned[0].id)); }, [companyId]);
  useEffect(() => { void reload(); }, [reload]);
  const save = async () => { try { await api.protectedRegistry.recordPayment({ companyId: Number(companyId), issuerCode, amount: Number(amount), paymentDate: localToday(), method, operationId: operationId() }); setAmount(''); await reload(); } catch (error) { notify(errorMessage(error)); } };
  const reverse = async (payment: any) => { const values = await ask({ title: 'Reversează încasarea', fields: [{ name: 'reason', label: 'Motivul reversării', type: 'textarea' }] }); if (!values) return; try { await api.protectedRegistry.reversePayment(payment.id, values.reason, operationId()); await reload(); } catch (error) { notify(errorMessage(error)); } };
  const selectedCompany = companies.find((row) => String(row.id) === companyId);
  const credit = balances.find((row) => row.companyId === selectedCompany?.id && row.issuerCode === issuerCode)?.available || 0;
  const appliedCredit = (invoiceId: string) => creditApplications.filter((application) => application.invoiceId === invoiceId && !application.reversedAt).reduce((sum, application) => sum + Number(application.amount), 0);
  const eligibleInvoices = invoices.filter((invoice) => String(invoice.companyId) === companyId && invoice.issuerCode === issuerCode && invoice.status !== 'cancelled' && invoice.totalAmount - invoice.paidAmount - invoice.creditedAmount - appliedCredit(invoice.id) > 0.005);
  const applyCredit = async () => { if (!creditInvoiceId) return; const values = await ask({ title: 'Aplică credit', message: `Credit disponibil: ${money(credit)}`, fields: [{ name: 'amount', label: 'Suma', type: 'number' }, { name: 'reason', label: 'Motivul aplicării', type: 'textarea' }] }); if (!values) return; try { await api.protectedRegistry.applyCredit({ invoiceId: creditInvoiceId, amount: Number(values.amount), reason: values.reason, operationId: operationId() }); await reload(); } catch (error) { notify(errorMessage(error)); } };
  const reverseCredit = async (application: any) => { const values = await ask({ title: `Reversează creditul aplicat pe ${application.invoiceReference}`, fields: [{ name: 'reason', label: 'Motivul reversării', type: 'textarea' }] }); if (!values) return; try { await api.protectedRegistry.reverseCredit(application.id, values.reason, operationId()); await reload(); } catch (error) { notify(errorMessage(error)); } };
  return <div className="space-y-5"><h1 className="text-3xl font-bold">Încasări</h1><div className="rounded-2xl bg-white border p-5 grid md:grid-cols-5 gap-3"><select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="border rounded-xl p-2">{companies.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><select value={issuerCode} onChange={(event) => setIssuerCode(event.target.value as any)} className="border rounded-xl p-2"><option value="goodness">THE GOODNESS BAKER LTD</option><option value="vatra">VATRA ROMANEASCA LTD</option></select><select value={method} onChange={(event) => setMethod(event.target.value)} className="border rounded-xl p-2"><option value="transfer">Transfer bancar</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Altă metodă</option></select><NumericInput value={amount} onValueChange={setAmount} min={0.01} placeholder="Suma GBP" /><button onClick={save} className="rounded-xl bg-indigo-600 text-white font-bold">Înregistrează</button><p className="md:col-span-5 text-xs text-slate-500">Încasările cash din acest registru nu modifică automat Daily Cash.</p></div><div className="rounded-2xl bg-white border p-5 flex gap-3 items-center"><b>Credit disponibil: {money(credit)}</b><select value={creditInvoiceId} onChange={(event) => setCreditInvoiceId(event.target.value)} className="border rounded-xl p-2 flex-1"><option value="">Factura pe care aplici creditul</option>{eligibleInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.reference} · rest {money(invoice.totalAmount - invoice.paidAmount - invoice.creditedAmount - appliedCredit(invoice.id))}</option>)}</select><button disabled={credit <= 0.005 || !creditInvoiceId} onClick={applyCredit} className="bg-emerald-600 text-white rounded-xl px-4 py-2 disabled:opacity-50">Aplică credit</button></div><div className="rounded-2xl bg-white border divide-y"><h2 className="p-4 font-bold">Istoric încasări</h2>{payments.map((payment) => <div key={payment.id} className={`p-4 flex justify-between gap-4 ${payment.reversedAt ? 'opacity-50' : ''}`}><span>{payment.paymentDate} · {payment.method} · {payment.issuerCode.toUpperCase()}{payment.reversedAt && ' · REVERSATĂ'}</span><div className="flex gap-3"><b>{money(payment.amount)}</b>{!payment.reversedAt && <button onClick={() => reverse(payment)} className="text-red-700">Reversează</button>}</div></div>)}</div><div className="rounded-2xl bg-white border divide-y"><h2 className="p-4 font-bold">Aplicări de credit</h2>{creditApplications.map((application) => <div key={application.id} className={`p-4 flex justify-between gap-4 ${application.reversedAt ? 'opacity-50' : ''}`}><span>{application.createdAt.slice(0, 10)} · {application.companyName} · {application.invoiceReference} · {application.issuerCode.toUpperCase()}{application.reversedAt && ' · REVERSAT'}</span><div className="flex gap-3"><b>{money(application.amount)}</b>{!application.reversedAt && <button onClick={() => reverseCredit(application)} className="text-red-700">Reversează</button>}</div></div>)}</div>{dialog}</div>;
}

function CreditNotesPanel() {
  const { ask, dialog } = useInputDialog();
  const [draft, setDraft] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<string, { quantity: string; unitAmount: string; returnToStock: boolean }>>({});
  const [reason, setReason] = useState('');
  const [issueDate, setIssueDate] = useState(localToday());
  const reload = useCallback(async () => {
    const [nextDraft, nextNotes] = await Promise.all([api.protectedRegistry.getCreditNoteDraft(), api.protectedRegistry.getCreditNotes()]);
    setDraft(nextDraft); setNotes(nextNotes);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
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
      const result = await api.protectedRegistry.createCreditNote({
        issueDate, reason, backdateReason, operationId: operationId(),
        items: Object.entries(selected).map(([invoiceItemId, value]) => ({ invoiceItemId, quantity: Number(value.quantity), unitAmount: Number(value.unitAmount), returnToStock: value.returnToStock })),
      });
      notify(result.pdf.success ? `Credit Note ${result.creditNote.reference} a fost emis și salvat în Drive.` : `Credit Note-ul a fost emis, dar PDF-ul trebuie regenerat: ${result.pdf.error}`);
      setSelected({}); setReason(''); await reload();
    } catch (error) { notify(errorMessage(error)); }
  };
  const cancel = async (note: any) => {
    const values = await ask({ title: `Anulează ${note.reference}`, message: 'Anularea internă nu înlocuiește documentul corectiv cerut contabil.', fields: [{ name: 'reason', label: 'Motivul anulării', type: 'textarea' }, { name: 'acknowledge', label: 'Scrie CONFIRM pentru a continua' }] });
    if (!values || values.acknowledge.trim().toUpperCase() !== 'CONFIRM') return;
    try { await api.protectedRegistry.cancelCreditNote(note.id, values.reason, true, operationId()); await reload(); } catch (error) { notify(errorMessage(error)); }
  };
  const remove = async (note: any) => { const values = await ask({ title: `Șterge definitiv ${note.reference}`, message: `Scrie exact STERGE ${note.reference}`, fields: [{ name: 'confirmation', label: 'Confirmare' }] }); if (!values) return; try { await api.protectedRegistry.deleteTestCreditNote(note.id, values.confirmation, operationId()); await reload(); } catch (error) { notify(errorMessage(error)); } };
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Credit Notes</h1><p className="text-slate-500">Credit integral sau parțial, cu retur opțional în stocul normal.</p></div><section className="rounded-2xl bg-white border p-5 space-y-4"><div className="grid md:grid-cols-[180px_1fr_auto] gap-3"><input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} className="border rounded-xl p-2" /><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motiv obligatoriu" className="border rounded-xl p-2" /><button onClick={issue} className="rounded-xl bg-indigo-600 text-white px-4 font-bold">Emite Credit Note</button></div>{draft.map((invoice) => <div key={invoice.id} className="border rounded-xl overflow-hidden"><header className="bg-slate-50 p-3 font-bold">{invoice.reference} · {invoice.companyName} · {invoice.storeName}</header>{invoice.items.map((item: any) => { const value = selected[item.id]; const remaining = Math.max(0, item.quantity - item.creditedQuantity); return <div key={item.id} className="p-3 border-t grid grid-cols-[28px_1fr_100px_120px_110px] gap-3 items-center"><input type="checkbox" checked={Boolean(value)} disabled={remaining <= 0.005} onChange={() => toggle(invoice, item)} /><BilingualProductName name={item.productName} nameRo={item.productNameRo} /><NumericInput decimalScale={3} aria-label={`Cantitate creditată · ${invoice.reference} · ${item.productName}`} value={value?.quantity ?? String(remaining)} disabled={!value} onValueChange={(next) => setSelected((current) => ({ ...current, [item.id]: { ...current[item.id], quantity: next } }))} /><NumericInput aria-label={`Preț creditat · ${invoice.reference} · ${item.productName}`} value={value?.unitAmount ?? String(item.unitPrice)} disabled={!value} onValueChange={(next) => setSelected((current) => ({ ...current, [item.id]: { ...current[item.id], unitAmount: next } }))} /><label className="text-xs"><input type="checkbox" disabled={!value || !item.finishedProductId} checked={value?.returnToStock || false} onChange={(event) => setSelected((current) => ({ ...current, [item.id]: { ...current[item.id], returnToStock: event.target.checked } }))} /> Retur stoc</label></div>; })}</div>)}</section><section className="rounded-2xl bg-white border divide-y"><h2 className="p-4 font-bold">Documente emise</h2>{notes.map((note) => <div key={note.id} className="p-4 flex items-center gap-4"><div className="flex-1"><b>{note.reference}</b><small className="block text-slate-500">{note.issueDate} · {note.companyName} · {note.issuerCode.toUpperCase()}</small></div><b>{money(note.totalAmount)}</b><button onClick={() => api.protectedRegistry.openDocument('credit-note', note.id).catch((error) => notify(errorMessage(error)))}><ExternalLink size={17} /></button><button onClick={() => api.protectedRegistry.shareDocument('credit-note', note.id).catch((error) => notify(errorMessage(error)))}><Share2 size={17} /></button>{note.status !== 'cancelled' && <button onClick={() => cancel(note)} className="text-amber-700">Anulează</button>}{note.testDocument && note.status === 'cancelled' && <button onClick={() => remove(note)} className="text-red-700"><Trash2 size={17} /></button>}</div>)}</section>{dialog}</div>;
}

function ExportsPanel() {
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const result = await api.protectedRegistry.exportMonth(month); notify(`Export verificat în Drive: ${result.excelName}, ${result.pdfCount} PDF-uri.`); }
    catch (error) { notify(errorMessage(error)); } finally { setBusy(false); }
  };
  return <div className="space-y-5"><div><h1 className="text-3xl font-bold">Exporturi lunare</h1><p className="text-slate-500">Excel contabil și copii ale PDF-urilor, separate de registrul normal.</p></div><section className="rounded-2xl bg-white border p-6 flex gap-3 items-end"><label className="text-sm font-semibold">Luna<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="block border rounded-xl p-2 mt-1" /></label><button disabled={busy} onClick={run} className="rounded-xl bg-indigo-600 text-white px-5 py-2.5 font-bold disabled:opacity-50">{busy ? 'Se exportă…' : 'Generează exportul'}</button></section></div>;
}

function SettingsPanel({ overview, reloadOverview }: { overview: any; reloadOverview: () => Promise<void> }) {
  const { ask, dialog } = useInputDialog();
  const [currentPin, setCurrentPin] = useState(''); const [newPin, setNewPin] = useState(''); const [confirm, setConfirm] = useState('');
  const goLive = async () => { const values = await ask({ title: 'Activează registrul LIVE', message: 'După prima emitere live, Modul test nu mai poate fi reactivat. Scrie exact ACTIVEAZA LIVE.', fields: [{ name: 'confirmation', label: 'Confirmare' }] }); if (!values) return; try { await api.protectedRegistry.setMode('live', values.confirmation, operationId()); await reloadOverview(); } catch (error) { notify(errorMessage(error)); } };
  const clearTestData = async () => { const values = await ask({ title: 'Curăță datele financiare de test', message: 'Mai întâi șterge facturile și Credit Notes de test. Se creează automat un backup criptat. Scrie exact CURATA TEST.', fields: [{ name: 'confirmation', label: 'Confirmare' }] }); if (!values) return; try { await api.protectedRegistry.clearTestFinancialData(values.confirmation, operationId()); notify('Încasările și creditele de test au fost eliminate.'); await reloadOverview(); } catch (error) { notify(errorMessage(error)); } };
  const changePin = async () => { try { await api.protectedRegistry.changePin(currentPin, newPin, confirm); setCurrentPin(''); setNewPin(''); setConfirm(''); notify('PIN-ul a fost schimbat.'); } catch (error) { notify(errorMessage(error)); } };
  return <div className="space-y-5"><h1 className="text-3xl font-bold">Setări registru</h1><section className="rounded-2xl bg-white border p-5 space-y-3"><h2 className="font-bold">Mod și contoare</h2><p>Mod curent: <b className={overview?.mode === 'test' ? 'text-amber-700' : 'text-emerald-700'}>{overview?.mode?.toUpperCase()}</b></p><div className="grid grid-cols-4 gap-3">{Object.entries(overview?.counters || {}).map(([key, value]) => <div key={key} className="bg-slate-50 rounded-xl p-3"><small>{key}</small><b className="block text-xl">{String(value)}</b></div>)}</div>{overview?.mode === 'test' && <div className="flex gap-3"><button onClick={clearTestData} className="rounded-xl bg-amber-600 text-white px-4 py-2 font-bold">Curăță datele de test</button><button onClick={goLive} className="rounded-xl bg-emerald-600 text-white px-4 py-2 font-bold">Treci registrul LIVE</button></div>}</section><section className="rounded-2xl bg-white border p-5 space-y-3"><h2 className="font-bold">Schimbă PIN</h2><div className="grid md:grid-cols-3 gap-3"><PinInput placeholder="PIN actual" value={currentPin} onValueChange={setCurrentPin} className="border rounded-xl p-2" /><PinInput placeholder="PIN nou" value={newPin} onValueChange={setNewPin} className="border rounded-xl p-2" /><PinInput placeholder="Confirmă PIN" value={confirm} onValueChange={setConfirm} className="border rounded-xl p-2" /></div><button onClick={changePin} className="rounded-xl bg-slate-900 text-white px-4 py-2">Schimbă PIN</button></section>{dialog}</div>;
}

function ProtectedWorkspace({ onLocked }: { onLocked: () => void }) {
  const [active, setActive] = useState<(typeof tabs)[number][0]>('dashboard');
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
  return <div className="h-screen flex bg-slate-50 overflow-hidden"><aside className="w-64 bg-slate-950 text-white flex flex-col"><header className="p-5 border-b border-slate-800"><div className="flex gap-3 items-center"><ShieldCheck className="text-indigo-400" /><b>Registru separat</b></div><span className={`inline-block mt-3 rounded-full px-2 py-1 text-xs font-bold ${overview?.mode === 'live' ? 'bg-emerald-600' : 'bg-amber-500'}`}>{overview?.mode?.toUpperCase() || '…'}</span></header><nav className="flex-1 p-3 overflow-y-auto">{tabs.map(([id, label, Icon]) => <button key={id} onClick={() => setActive(id)} className={`w-full rounded-xl px-3 py-2.5 flex gap-3 items-center text-sm mb-1 ${active === id ? 'bg-indigo-600' : 'text-slate-300 hover:bg-slate-800'}`}><Icon size={18} />{label}</button>)}</nav><button onClick={exit} className="m-3 rounded-xl bg-slate-800 p-3 flex gap-2 justify-center"><LogOut size={18} />Blochează și ieși</button></aside><FeedbackHost controller={protectedFeedback} /><main className="flex-1 overflow-y-auto p-8">{active === 'dashboard' && <DashboardPanel />}{active === 'clients' && <ClientsPanel />}{active === 'orders' && <OrdersPanel />}{active === 'invoices' && <InvoicesPanel />}{active === 'manual' && <ManualInvoicePanel />}{active === 'payments' && <PaymentsPanel />}{active === 'settings' && <SettingsPanel overview={overview} reloadOverview={reloadOverview} />}{active === 'credit-notes' && <CreditNotesPanel />}{active === 'exports' && <ExportsPanel />}</main></div>;
}

export function ProtectedRegistry() {
  const [status, setStatus] = useState<any>(null);
  const [denied, setDenied] = useState('');
  const reload = useCallback(async () => { try { setStatus(await api.protectedRegistry.status()); setDenied(''); } catch (error) { setDenied(errorMessage(error)); } }, []);
  useEffect(() => { void reload(); }, [reload]);
  if (denied) return <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6"><div className="rounded-2xl bg-white p-8 max-w-md"><Lock className="text-red-600 mb-4" /><h1 className="text-2xl font-bold">Acces indisponibil</h1><p className="text-slate-600 mt-2">{denied}</p><button onClick={() => { window.location.hash = '/'; }} className="mt-5 flex gap-2 text-indigo-700"><ArrowLeft size={18} />Înapoi la Hub</button></div></div>;
  if (!status) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center"><RefreshCw className="animate-spin" /></div>;
  if (!status.unlocked) return <ProtectedAccess status={status} onUnlocked={reload} />;
  return <ProtectedWorkspace onLocked={() => setStatus((current: any) => ({ ...current, unlocked: false }))} />;
}

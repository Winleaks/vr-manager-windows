import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileMinus2, FileText, Loader2, Plus, Printer, Search, XCircle } from 'lucide-react';
import { api } from '../shared/api';
import { NumericInput } from '../components/NumericInput';

type DraftLine = {
  id: number; productName: string; nameRo?: string; variantLabel?: string; unit?: string;
  remainingQuantity: number; remainingValue: number; unitPrice: number; canReturnToStock: boolean;
};

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function BillingCreditNotes() {
  const [notes, setNotes] = useState<any[]>([]);
  const [draft, setDraft] = useState<any[]>([]);
  const [issuers, setIssuers] = useState<any[]>([]);
  const [isWriter, setIsWriter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [issuerFilter, setIssuerFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [scope, setScope] = useState('');
  const [selected, setSelected] = useState<Record<number, { checked: boolean; quantity: string; unitAmount: string; returnToStock: boolean }>>({});
  const [issueDate, setIssueDate] = useState(today());
  const [reason, setReason] = useState('');
  const [backdateReason, setBackdateReason] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [nextNotes, nextDraft, nextIssuers, device] = await Promise.all([
        api.billing.getCreditNotes(), api.billing.getCreditNoteDraft(), api.billing.getIssuers(), api.system.getDeviceRole(),
      ]);
      setNotes(nextNotes || []); setDraft(nextDraft || []); setIssuers(nextIssuers || []); setIsWriter(device.role === 'writer');
      const invoiceFromUrl = Number(new URLSearchParams(window.location.hash.split('?')[1] || '').get('invoice'));
      const initial = nextDraft.find((invoice: any) => invoice.id === invoiceFromUrl) || nextDraft[0];
      if (initial) setScope(`${initial.company_id}:${initial.issuer_id}`);
      if (invoiceFromUrl && initial) setShowCreate(true);
    } catch (cause: any) { setError(cause.message || 'Credit Notes nu au putut fi încărcate.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const scopes = useMemo(() => [...new Map(draft.map((invoice) => [`${invoice.company_id}:${invoice.issuer_id}`, invoice])).entries()], [draft]);
  const companies = useMemo(() => [...new Map(notes.map((note) => [String(note.company_id), note.company_name])).entries()], [notes]);
  const scopedInvoices = draft.filter((invoice) => `${invoice.company_id}:${invoice.issuer_id}` === scope);
  const chosenItems = Object.entries(selected).filter(([, value]) => value.checked).map(([id, value]) => ({ invoiceItemId: Number(id), quantity: Number(value.quantity), unitAmount: Number(value.unitAmount), returnToStock: value.returnToStock }));
  const previewTotal = chosenItems.reduce((sum, item) => sum + (Number.isFinite(item.quantity * item.unitAmount) ? item.quantity * item.unitAmount : 0), 0);
  const filteredNotes = notes.filter((note) => {
    const query = search.trim().toLowerCase();
    return (issuerFilter === 'all' || String(note.issuer_id) === issuerFilter)
      && (companyFilter === 'all' || String(note.company_id) === companyFilter)
      && (statusFilter === 'all' || note.status === statusFilter)
      && (!dateFrom || note.issue_date >= dateFrom)
      && (!dateTo || note.issue_date <= dateTo)
      && (!query || `${note.reference} ${note.company_name} ${note.invoice_references}`.toLowerCase().includes(query));
  });
  const issuedNotes = filteredNotes.filter((note) => note.status === 'issued');
  const visibleTotal = issuedNotes.reduce((sum, note) => sum + Number(note.total_amount || 0), 0);

  const toggleLine = (line: DraftLine, checked: boolean) => setSelected((current) => ({ ...current, [line.id]: {
    checked, quantity: current[line.id]?.quantity || String(line.remainingQuantity),
    unitAmount: current[line.id]?.unitAmount || String(Math.min(line.unitPrice, line.remainingValue / Math.max(line.remainingQuantity, 1))),
    returnToStock: current[line.id]?.returnToStock || false,
  } }));
  const updateLine = (id: number, patch: Partial<{ quantity: string; unitAmount: string; returnToStock: boolean }>) => setSelected((current) => ({ ...current, [id]: { ...(current[id] || { checked: true, quantity: '', unitAmount: '', returnToStock: false }), ...patch } }));

  const issue = async () => {
    setError('');
    if (!chosenItems.length) return setError('Selectează cel puțin o poziție.');
    setBusy(true);
    try {
      const created = await api.billing.createCreditNote({ issueDate, reason, backdateReason, items: chosenItems });
      const pdf = await api.billing.prepareCreditNotePdf(created.creditNoteId);
      setShowCreate(false); setSelected({}); setReason(''); setBackdateReason('');
      await load();
      alert(pdf.success
        ? `Credit Note ${created.reference} a fost emis. PDF-ul este salvat${pdf.cloud?.success ? ' și încărcat în Google Drive' : '; încărcarea în Drive poate fi reîncercată'}.`
        : `Credit Note ${created.reference} a fost emis financiar, dar PDF-ul nu a putut fi generat: ${pdf.message}`);
    } catch (cause: any) { setError(cause.message || 'Credit Note-ul nu a putut fi emis.'); }
    finally { setBusy(false); }
  };

  const openPdf = async (note: any) => {
    setBusy(true);
    try {
      let result = await api.billing.openCreditNotePdf(note.id);
      if (result.notFound && isWriter) { result = await api.billing.prepareCreditNotePdf(note.id); if (result.success) result = await api.billing.openCreditNotePdf(note.id); }
      if (!result.success) alert(result.message || 'PDF-ul nu există pe acest calculator. Regenerarea este disponibilă numai pe Writer.');
    } finally { setBusy(false); }
  };

  const cancel = async (note: any) => {
    const warning = `Anulezi intern ${note.reference}? Aplicările creditului și retururile de stoc vor fi inversate automat.\n\nAceastă operație NU înlocuiește documentul corectiv contabil (de exemplu Debit Note) dacă documentul a fost deja trimis sau contabilizat.`;
    if (!window.confirm(warning)) return;
    const cancellationReason = window.prompt('Motivul obligatoriu al anulării:');
    if (!cancellationReason?.trim()) return;
    try { await api.billing.cancelCreditNote(note.id, cancellationReason.trim(), true); await load(); }
    catch (cause: any) { alert(cause.message || 'Credit Note-ul nu a putut fi anulat.'); }
  };

  return <div className="p-8 max-w-7xl mx-auto space-y-7">
    <header className="flex items-center justify-between gap-4"><div><div className="flex items-center gap-3"><div className="p-2.5 rounded-xl bg-indigo-100 text-indigo-700"><FileMinus2 /></div><h1 className="text-3xl font-bold text-slate-900">Credit Notes</h1></div><p className="mt-2 text-slate-500">Corecții integrale sau parțiale, credit client și retur opțional în stoc.</p></div><button disabled={!isWriter} onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 disabled:opacity-50 text-white font-bold"><Plus size={18} />Creează Credit Note</button></header>
    {error && <div role="alert" className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 font-medium">{error}</div>}
    {!isWriter && <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 text-blue-800">Mod consultare: numai Writer-ul poate emite, aplica sau anula Credit Notes.</div>}
    <section className="grid sm:grid-cols-3 gap-4"><div className="bg-white border rounded-2xl p-4"><div className="text-xs uppercase text-slate-500 font-semibold">Documente afișate</div><div className="text-2xl font-bold mt-1">{filteredNotes.length}</div></div><div className="bg-white border rounded-2xl p-4"><div className="text-xs uppercase text-slate-500 font-semibold">Credit Notes active</div><div className="text-2xl font-bold mt-1 text-indigo-700">{issuedNotes.length}</div></div><div className="bg-white border rounded-2xl p-4"><div className="text-xs uppercase text-slate-500 font-semibold">Total creditat activ</div><div className="text-2xl font-bold mt-1 text-amber-700">£{visibleTotal.toFixed(2)}</div></div></section>
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-wrap gap-3"><div className="relative flex-1 min-w-72"><Search size={17} className="absolute left-3 top-3 text-slate-400" /><input className="w-full pl-10 pr-3 py-2.5 border rounded-xl" placeholder="Caută referință, client sau factură..." value={search} onChange={(e) => setSearch(e.target.value)} /></div><select className="border rounded-xl px-3" value={issuerFilter} onChange={(e) => setIssuerFilter(e.target.value)}><option value="all">Toți emitenții</option>{issuers.map((issuer) => <option key={issuer.id} value={issuer.id}>{issuer.legal_name}</option>)}</select><select className="border rounded-xl px-3" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}><option value="all">Toți clienții</option>{companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select className="border rounded-xl px-3" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Toate statusurile</option><option value="issued">Emise</option><option value="cancelled">Anulate</option></select><label className="text-xs text-slate-500">De la<input type="date" className="block border rounded-xl px-3 py-2 mt-0.5" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label><label className="text-xs text-slate-500">Până la<input type="date" className="block border rounded-xl px-3 py-2 mt-0.5" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label></section>
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">{loading ? <div className="p-12 flex justify-center text-slate-500"><Loader2 className="animate-spin mr-2" />Se încarcă...</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="text-left p-4">Credit Note</th><th className="text-left p-4">Data / Client</th><th className="text-left p-4">Facturi originale</th><th className="text-right p-4">Total</th><th className="text-left p-4">Status</th><th className="text-right p-4">Acțiuni</th></tr></thead><tbody className="divide-y">{filteredNotes.map((note) => <tr key={note.id}><td className="p-4 font-bold">{note.reference}<div className="text-[10px] mt-1 text-white px-2 py-0.5 rounded-full inline-block" style={{ backgroundColor: note.issuer_color }}>{note.issuer_name}</div></td><td className="p-4">{note.issue_date}<div className="font-semibold text-slate-700">{note.company_name}</div></td><td className="p-4 text-slate-600">{note.invoice_references}</td><td className="p-4 text-right font-bold">£{Number(note.total_amount).toFixed(2)}</td><td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-semibold ${note.status === 'issued' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{note.status === 'issued' ? 'Emis' : 'Anulat intern'}</span></td><td className="p-4"><div className="flex justify-end gap-2"><button onClick={() => openPdf(note)} className="p-2 rounded-lg hover:bg-indigo-50 text-indigo-700" title="Deschide PDF"><Printer size={17} /></button>{note.status === 'issued' && isWriter && <button onClick={() => cancel(note)} className="p-2 rounded-lg hover:bg-rose-50 text-rose-700" title="Anulează intern"><XCircle size={17} /></button>}</div></td></tr>)}{!filteredNotes.length && <tr><td colSpan={6} className="p-12 text-center text-slate-500"><FileText className="mx-auto mb-3 text-slate-300" size={40} />Nu există Credit Notes pentru filtrele selectate.</td></tr>}</tbody></table></div>}</section>

    {showCreate && <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto"><div className="sticky top-0 bg-white border-b p-5 flex justify-between items-center z-10"><div><h2 className="text-xl font-bold">Creează Credit Note</h2><p className="text-sm text-slate-500">Backend-ul verifică emitentul, clientul, limitele și numărul.</p></div><button onClick={() => setShowCreate(false)}><XCircle /></button></div><div className="p-6 space-y-5">
      <div className="grid md:grid-cols-2 gap-4"><label className="text-sm font-semibold">Companie și emitent<select className="block w-full mt-1 border rounded-xl px-3 py-2.5" value={scope} onChange={(e) => { setScope(e.target.value); setSelected({}); }}><option value="">Selectează...</option>{scopes.map(([key, invoice]) => <option key={key} value={key}>{invoice.company_name} — {invoice.issuer_name}</option>)}</select></label><label className="text-sm font-semibold">Data documentului<input type="date" max={today()} className="block w-full mt-1 border rounded-xl px-3 py-2.5" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></label></div>
      {issueDate < today() && <label className="block text-sm font-semibold">Motivul antedatării<textarea className="block w-full mt-1 border rounded-xl p-3" value={backdateReason} onChange={(e) => setBackdateReason(e.target.value)} /></label>}
      <label className="block text-sm font-semibold">Motivul Credit Note-ului<textarea rows={2} className="block w-full mt-1 border rounded-xl p-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motiv real și suficient pentru audit" /></label>
      <div className="space-y-4">{scopedInvoices.map((invoice) => <div key={invoice.id} className="border rounded-xl overflow-hidden"><div className="bg-slate-50 px-4 py-3 flex justify-between"><div className="font-bold">Factura {invoice.invoice_number} · {invoice.store_name}</div><div className="text-sm">Brut £{invoice.grossAmount.toFixed(2)} · Creditat £{invoice.creditedAmount.toFixed(2)} · Rest £{invoice.outstanding.toFixed(2)}</div></div><div className="divide-y">{invoice.items.filter((line: DraftLine) => line.remainingQuantity > 0 && line.remainingValue > 0).map((line: DraftLine) => { const state = selected[line.id]; return <div key={line.id} className="p-4 grid grid-cols-[auto_1fr_120px_130px_150px] gap-3 items-center"><input type="checkbox" checked={state?.checked || false} onChange={(e) => toggleLine(line, e.target.checked)} /><div><div className="font-semibold">{line.productName}</div>{line.nameRo && <div className="text-xs text-slate-500">{line.nameRo}</div>}<div className="text-xs text-slate-400">Disponibil: {line.remainingQuantity} · £{line.remainingValue.toFixed(2)}</div></div><NumericInput disabled={!state?.checked} decimalScale={3} value={state?.quantity || ''} onValueChange={(value) => updateLine(line.id, { quantity: value })} className="border rounded-lg px-2 py-2" /><NumericInput disabled={!state?.checked} decimalScale={2} value={state?.unitAmount || ''} onValueChange={(value) => updateLine(line.id, { unitAmount: value })} className="border rounded-lg px-2 py-2" /><label className={`text-xs flex gap-2 items-center ${line.canReturnToStock ? '' : 'text-slate-400'}`}><input type="checkbox" disabled={!state?.checked || !line.canReturnToStock} checked={state?.returnToStock || false} onChange={(e) => updateLine(line.id, { returnToStock: e.target.checked })} />Retur integral în stoc</label></div>; })}</div></div>)}</div>
      {!scopedInvoices.length && <div className="p-8 text-center border border-dashed rounded-xl text-slate-500">Nu există facturi eligibile în această selecție.</div>}
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex gap-3 text-sm text-amber-900"><AlertTriangle className="shrink-0" size={20} /><span>Credit Note-ul este document financiar permanent. După prima emitere, seria nu mai poate fi schimbată.</span></div>
    </div><div className="sticky bottom-0 border-t bg-white p-5 flex justify-between items-center"><div className="font-bold text-lg">Total creditat: £{previewTotal.toFixed(2)}</div><div className="flex gap-3"><button onClick={() => setShowCreate(false)} className="px-5 py-2.5 border rounded-xl">Renunță</button><button disabled={busy || !chosenItems.length || !reason.trim()} onClick={issue} className="px-5 py-2.5 bg-indigo-600 disabled:opacity-50 text-white rounded-xl font-bold">{busy ? 'Se emite...' : 'Emite Credit Note'}</button></div></div></div></div>}
  </div>;
}

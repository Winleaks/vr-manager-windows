import { useState } from 'react';
import { ArrowRightLeft, Ban, Banknote, Edit3, FileMinus2, Receipt, RefreshCw, RotateCw, Search, Trash2 } from 'lucide-react';
import { ProtectedDocumentActions } from './ProtectedDocumentActions';

export function ProtectedInvoiceList({ invoices, loading, error, reload, notify, onEdit, onIssuerChange, onCancel, onRemove, onReissue, onCreditNote, onPayment }: {
  invoices: any[]; loading: boolean; error: string; reload: () => void; notify: (message: string) => void;
  onEdit: (invoice: any) => void; onIssuerChange: (invoice: any) => void; onCancel: (invoice: any) => void;
  onRemove: (invoice: any) => void; onReissue: (invoice: any) => void; onCreditNote: (invoice: any) => void; onPayment: (invoice: any) => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [issuer, setIssuer] = useState('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const filtered = invoices.filter(row => normalize(`${row.reference} ${row.companyName} ${row.storeName}`).includes(normalize(search.trim()))
    && (status === 'all' || row.status === status) && (issuer === 'all' || row.issuerCode === issuer)
    && (!start || row.invoiceDate >= start) && (!end || row.invoiceDate <= end));
  const labels: Record<string, string> = { unpaid: 'Neachitată', partial: 'Parțial achitată', paid: 'Achitată', cancelled: 'Anulată' };
  const money = (value: number) => `£${Number(value || 0).toFixed(2)}`;
  return <div className="space-y-6">
    <header className="flex items-center justify-between gap-3"><div><h1 className="flex items-center gap-3 text-2xl font-bold text-slate-900"><span className="p-2 rounded-xl bg-indigo-100 text-indigo-600"><Receipt size={24} /></span>Registru facturi</h1><p className="mt-2 text-sm text-slate-500">Facturi și acțiuni pentru registrul separat.</p></div><button type="button" title="Reîncarcă facturile" aria-label="Reîncarcă facturile" disabled={loading} onClick={reload} className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50"><RefreshCw size={20} className={loading ? 'animate-spin' : ''} /></button></header>
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <label className="block text-sm font-semibold">Caută factură, companie sau magazin<div className="relative mt-2"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input type="search" value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10" placeholder="Număr factură, companie sau magazin..." /></div></label>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <label className="text-sm font-medium">Status<select className="block w-full mt-1" value={status} onChange={e => setStatus(e.target.value)}><option value="all">Toate statusurile</option>{Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="text-sm font-medium">Societate emitentă<select className="block w-full mt-1" value={issuer} onChange={e => setIssuer(e.target.value)}><option value="all">Toți emitenții</option><option value="goodness">THE GOODNESS BAKER LTD</option><option value="vatra">VATRA ROMANEASCA LTD</option></select></label>
        <label className="text-sm font-medium">De la<input type="date" className="block w-full mt-1" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="text-sm font-medium">Până la<input type="date" className="block w-full mt-1" value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>
    </section>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p>}
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 text-sm text-slate-500">{filtered.length} facturi · Total {money(filtered.filter(row => row.status !== 'cancelled').reduce((sum, row) => sum + row.totalAmount, 0))} · Rest {money(filtered.reduce((sum, row) => sum + row.outstanding, 0))}</div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{['Factură / Data', 'Companie / Magazin', 'Emitent', 'Total / Rest', 'Status', 'Acțiuni'].map(label => <th key={label} className="px-5 py-4 text-left">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{filtered.map(invoice => <tr key={invoice.id}>
          <td className="px-5 py-4"><b className="text-indigo-600 whitespace-nowrap">#{invoice.reference}</b><small className="block mt-1 text-slate-500">{invoice.invoiceDate.split('-').reverse().join('/')}</small>{invoice.testDocument && <small className="text-amber-700">TEST</small>}{invoice.replacesInvoiceId && <small className="block text-indigo-600">Înlocuiește {invoices.find(row => row.id === invoice.replacesInvoiceId)?.reference || 'factura originală'}</small>}{invoice.replacedByInvoiceId && <small className="block text-indigo-600">Înlocuită cu {invoices.find(row => row.id === invoice.replacedByInvoiceId)?.reference || 'factura nouă'}</small>}</td>
          <td className="px-5 py-4"><p className="font-semibold text-slate-900">{invoice.companyName}</p><small className="block mt-1 text-slate-500">{invoice.storeName}</small></td>
          <td className="px-5 py-4 text-xs font-semibold">{invoice.issuerCode === 'goodness' ? 'THE GOODNESS BAKER LTD' : 'VATRA ROMANEASCA LTD'}</td>
          <td className="px-5 py-4 whitespace-nowrap"><b>{money(invoice.totalAmount)}</b><small className="block mt-1 text-slate-500">Rest {money(invoice.outstanding)}</small></td>
          <td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${invoice.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : invoice.status === 'cancelled' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'}`}>{labels[invoice.status] || invoice.status}</span></td>
          <td className="px-5 py-4"><div className="flex flex-wrap items-center gap-1 min-w-36">
            <ProtectedDocumentActions id={invoice.id} status={invoice.status} notify={notify} />
            {invoice.status !== 'cancelled' && <>
              <Action label="Editează factura" icon={Edit3} onClick={() => onEdit(invoice)} />
              <Action label="Schimbă emitentul" icon={ArrowRightLeft} onClick={() => onIssuerChange(invoice)} />
              <Action label="Înregistrează plata" icon={Banknote} onClick={() => onPayment(invoice)} />
              <Action label="Emite Credit Note" icon={FileMinus2} onClick={() => onCreditNote(invoice)} />
              <Action label="Anulează factura" icon={Ban} onClick={() => onCancel(invoice)} />
            </>}
            {invoice.status === 'cancelled' && !invoice.replacedByInvoiceId && <Action label="Reemite cu număr nou" icon={RotateCw} onClick={() => onReissue(invoice)} />}
            {invoice.testDocument && <Action label="Șterge factura de test" icon={Trash2} onClick={() => onRemove(invoice)} />}
          </div></td>
        </tr>)}</tbody></table></div>
      {!filtered.length && <p role="status" className="p-12 text-center text-slate-500">{loading ? 'Se încarcă facturile...' : 'Nu există facturi pentru filtrele selectate.'}</p>}
    </section>
  </div>;
}

function Action({ label, icon: Icon, onClick }: { label: string; icon: typeof Edit3; onClick: () => void }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50"><Icon size={16} aria-hidden="true" /></button>;
}

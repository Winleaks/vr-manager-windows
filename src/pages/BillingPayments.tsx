import { useEffect, useState } from 'react';
import { AlertCircle, History, Loader2, Search, Wallet } from 'lucide-react';
import { api } from '../shared/api';
import { format } from 'date-fns';

const money = (value: number) => value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputStyle = 'w-full min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

export function BillingPayments() {
  const [from, setFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setError('');
    if (!from || !to || from > to) {
      setRows([]); setLoading(false);
      setError('Selectează o perioadă validă: data de început nu poate fi după data de sfârșit.');
      return () => { active = false; };
    }
    setLoading(true);
    api.billing.getPaymentReport(from, to)
      .then(data => { if (active) setRows(data); })
      .catch(cause => { if (active) { setRows([]); setError(cause instanceof Error ? cause.message : 'Istoricul plăților nu a putut fi încărcat.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to]);

  const filtered = rows.filter(row => `${row.company_name} ${row.store_name || ''} ${row.company_stores || ''} ${row.invoice_number || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const total = filtered.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100;

  return <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
    <div>
      <div className="flex items-center gap-3"><div className="w-10 h-10 shrink-0 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center"><History size={22} aria-hidden="true" /></div><h1 className="text-3xl font-bold text-slate-900">Istoric Plăți</h1></div>
      <p className="text-slate-500 mt-2">Consultă încasările din perioada selectată și caută după client, magazin sau factură.</p>
    </div>
    <section aria-label="Filtre istoric plăți" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-end">
        <label className="min-w-0 space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">De la</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputStyle} /></label>
        <label className="min-w-0 space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">Până la</span><input type="date" min={from} value={to} onChange={e => setTo(e.target.value)} className={inputStyle} /></label>
        <label className="min-w-0 space-y-1.5 sm:col-span-2"><span className="text-xs font-semibold uppercase text-slate-500">Caută client, magazin sau factură</span><div className="relative"><Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nume client, magazin sau număr factură..." className={`${inputStyle} pl-10`} /></div></label>
      </div>
    </section>
    {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><AlertCircle size={18} className="shrink-0" />{error}</div> : loading ?
      <div role="status" className="p-12 flex justify-center items-center gap-3 text-slate-500"><Loader2 size={20} className="animate-spin" />Se încarcă istoricul plăților...</div> : <>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><div className="w-10 h-10 shrink-0 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center"><Wallet size={20} aria-hidden="true" /></div><div><h2 className="font-semibold text-slate-700">Încasări în perioada selectată</h2><p className="text-sm text-slate-500">{filtered.length} {filtered.length === 1 ? 'plată' : 'plăți'} pentru filtrele selectate</p></div></div>
          <div className="text-3xl font-bold text-slate-900">£{money(total)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200"><tr>{['Data', 'Client / Magazin', 'Emitent', 'Factură', 'Metodă / Bancă', 'Sumă'].map((label, index) => <th scope="col" key={label} className={`px-5 py-4 font-semibold ${index === 5 ? 'text-right' : ''}`}>{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{filtered.map(row => <tr key={row.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-5 py-4 whitespace-nowrap text-slate-600">{String(row.payment_date).split('-').reverse().join('/')}</td>
              <td className="px-5 py-4"><div className="font-semibold text-slate-800">{row.company_name}</div><div className="text-xs text-slate-500 mt-1">{row.store_name}</div></td>
              <td className="px-5 py-4 text-slate-600">{row.issuer_name}</td>
              <td className="px-5 py-4 font-semibold text-indigo-600 whitespace-nowrap">{row.invoice_number || 'Avans / credit'}</td>
              <td className="px-5 py-4"><span className="inline-flex rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{row.method === 'transfer' ? row.bank_name || 'Transfer' : 'Cash'}</span></td>
              <td className="px-5 py-4 text-right font-bold text-slate-900 whitespace-nowrap">£{money(Number(row.amount))}</td>
            </tr>)}{!filtered.length && <tr><td colSpan={6} className="p-12 text-center text-slate-500"><History size={36} aria-hidden="true" className="mx-auto text-slate-300 mb-3" />Nu există plăți pentru filtrele selectate.</td></tr>}</tbody>
          </table>
        </div></div>
      </>}
  </div>;
}

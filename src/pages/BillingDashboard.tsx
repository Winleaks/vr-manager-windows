import { useState, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, FileText, FileMinus2, DollarSign, TrendingUp } from 'lucide-react';
import { api } from '../shared/api';
import { addWeeks, format, startOfWeek, endOfWeek } from 'date-fns';
import { ro } from 'date-fns/locale';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { billingDashboardRange, type BillingDashboardPeriod } from '../utils/billingDashboardPeriod';

export function BillingDashboard() {
  const [stats, setStats] = useState({ totalInvoiced: 0, totalPaid: 0, totalUnpaid: 0, totalCredited: 0 });
  const [week, setWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [period, setPeriod] = useState<BillingDashboardPeriod>('month');
  const { from, to } = billingDashboardRange(period, week);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const [issuers, setIssuers] = useState<any[]>([]);
  const [issuerFilter, setIssuerFilter] = useState('all');

  useEffect(() => {
    let active=true;
    const loadStats = async () => {
      setLoading(true);setError('');
      try {
        const data = await api.billing.getStats(issuerFilter === 'all' ? undefined : Number(issuerFilter), from, to);
        if(active)setStats(data);
      } catch (error) {
        if(active)setError(error instanceof Error ? error.message : 'Statisticile nu pot fi încărcate.');
      } finally { if(active)setLoading(false); }
    };
    void loadStats();
    return()=>{active=false;};
  }, [issuerFilter, from, to]);

  useEffect(() => { api.billing.getIssuers().then(setIssuers).catch(console.error); }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard Facturare</h1>
        <p className="text-slate-500 mt-2">Sumarul financiar și situația restanțierilor.</p>
        </div>
        <label className="text-sm font-medium text-slate-600">Societate emitentă<select value={issuerFilter} onChange={(e) => setIssuerFilter(e.target.value)} className="block mt-1 bg-white border border-slate-200 rounded-xl px-4 py-2"><option value="all">Toate societățile</option>{issuers.map((issuer) => <option key={issuer.id} value={issuer.id}>{issuer.legal_name}</option>)}</select></label>
      </div>

      <section aria-label="Perioada statisticilor" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Calendar size={18} className="text-slate-400" />Perioada statisticilor</div>
          <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-xl">
            {([['month', 'Luna curentă'], ['week', 'Săptămână'], ['all', 'Tot istoricul']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${period === value ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}>{label}</button>)}
          </div>
        </div>
        {period === 'week' ? <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="px-4 py-2 text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl">Săptămâna curentă</button>
          <div className="flex items-center min-w-0 bg-slate-50 border border-slate-200 rounded-xl p-1">
            <button type="button" onClick={() => setWeek(value => addWeeks(value, -1))} title="Săptămâna anterioară" aria-label="Săptămâna anterioară" className="shrink-0 p-2 text-slate-600 hover:bg-slate-200 rounded-lg"><ChevronLeft size={18} /></button>
            <DatePicker selected={week} onChange={(date: Date | null) => { if (date) setWeek(startOfWeek(date, { weekStartsOn: 1 })); }} showWeekPicker showWeekNumbers locale={ro} calendarStartDay={1}
              customInput={<button type="button" aria-label="Alege săptămâna" className="px-3 py-2 font-semibold text-slate-800 text-sm hover:text-indigo-600">Luni, {format(week, 'dd MMM yyyy', { locale: ro })} – Duminică, {format(endOfWeek(week, { weekStartsOn: 1 }), 'dd MMM yyyy', { locale: ro })}</button>} />
            <button type="button" onClick={() => setWeek(value => addWeeks(value, 1))} title="Săptămâna următoare" aria-label="Săptămâna următoare" className="shrink-0 p-2 text-slate-600 hover:bg-slate-200 rounded-lg"><ChevronRight size={18} /></button>
          </div>
        </div> : <p className="text-sm text-slate-600">{period === 'month' ? `Luna curentă: ${format(new Date(), 'MMMM yyyy', { locale: ro })} · ${from?.split('-').reverse().join('/')} – ${to?.split('-').reverse().join('/')}` : 'Statistici pentru tot istoricul.'}</p>}
      </section>
      {error&&<p role="alert" className="text-rose-700 mb-4">{error}</p>}
      {loading&&<p role="status">Se încarcă statisticile...</p>}
      <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8 ${loading||error?'hidden':''}`}>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 shrink-0 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
              <FileMinus2 size={20} aria-hidden="true" />
            </div>
            <h3 className="font-semibold text-slate-700">Credit Notes</h3>
          </div>
          <div className="text-3xl font-bold text-slate-900">£{stats.totalCredited.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
              <TrendingUp size={20} />
            </div>
            <h3 className="font-semibold text-slate-700">Total Facturat</h3>
          </div>
          <div className="text-3xl font-bold text-slate-900">£{stats.totalInvoiced.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
              <DollarSign size={20} />
            </div>
            <h3 className="font-semibold text-slate-700">Total Încasat</h3>
          </div>
          <div className="text-3xl font-bold text-slate-900">£{stats.totalPaid.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-red-100 text-red-600 rounded-xl flex items-center justify-center">
              <FileText size={20} />
            </div>
            <h3 className="font-semibold text-slate-700">Rest de Plată Actual · Tot istoricul</h3>
          </div>
          <div className="text-3xl font-bold text-slate-900">£{stats.totalUnpaid.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
      </div>
      
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center text-slate-500">
        Facturarea săptămânală folosește comenzile din VR Baker Platform prin API-ul dedicat read-only.
      </div>
    </div>
  );
}

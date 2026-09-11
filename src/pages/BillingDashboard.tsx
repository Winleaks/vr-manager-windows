import { useState, useEffect } from 'react';
import { FileText, DollarSign, TrendingUp } from 'lucide-react';
import { api } from '../shared/api';
import { format, startOfWeek, endOfWeek } from 'date-fns';

export function BillingDashboard() {
  const [stats, setStats] = useState({ totalInvoiced: 0, totalPaid: 0, totalUnpaid: 0, totalCredited: 0 });
  const [week,setWeek] = useState(format(new Date(),'yyyy-MM-dd'));
  const [allTime,setAllTime] = useState(false);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const [issuers, setIssuers] = useState<any[]>([]);
  const [issuerFilter, setIssuerFilter] = useState('all');

  useEffect(() => {
    let active=true;
    const loadStats = async () => {
      setLoading(true);setError('');
      try {
        const date = new Date(`${week}T12:00:00`);
        const data = await api.billing.getStats(issuerFilter === 'all' ? undefined : Number(issuerFilter), allTime ? undefined : format(startOfWeek(date,{weekStartsOn:1}),'yyyy-MM-dd'), allTime ? undefined : format(endOfWeek(date,{weekStartsOn:1}),'yyyy-MM-dd'));
        if(active)setStats(data);
      } catch (error) {
        if(active)setError(error instanceof Error ? error.message : 'Statisticile nu pot fi încărcate.');
      } finally { if(active)setLoading(false); }
    };
    void loadStats();
    return()=>{active=false;};
  }, [issuerFilter,week,allTime]);

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

      <div className="flex gap-4 items-end mb-6"><label>Alege o zi din săptămână<input type="date" value={week} onChange={e=>{if(e.target.value)setWeek(e.target.value);}} disabled={allTime} className="block border rounded-xl p-2"/></label><label><input type="checkbox" checked={allTime} onChange={e=>setAllTime(e.target.checked)}/> Tot istoricul</label></div>
      {!allTime&&<p className="mb-4 text-slate-600">Luni {format(startOfWeek(new Date(`${week}T12:00:00`),{weekStartsOn:1}),'dd/MM/yyyy')} – Duminică {format(endOfWeek(new Date(`${week}T12:00:00`),{weekStartsOn:1}),'dd/MM/yyyy')}</p>}
      {error&&<p role="alert" className="text-rose-700 mb-4">{error}</p>}
      {loading&&<p role="status">Se încarcă statisticile...</p>}
      <div className={`grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 ${loading||error?'hidden':''}`}>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><h3 className="font-semibold text-slate-700 mb-4">Credit Notes</h3><div className="text-3xl font-bold">£{stats.totalCredited.toFixed(2)}</div></div>
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

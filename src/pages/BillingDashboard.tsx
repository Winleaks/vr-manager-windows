import { useState, useEffect } from 'react';
import { FileText, DollarSign, TrendingUp } from 'lucide-react';
import { api } from '../shared/api';

export function BillingDashboard() {
  const [stats, setStats] = useState({ totalInvoiced: 0, totalPaid: 0, totalUnpaid: 0 });
  const [issuers, setIssuers] = useState<any[]>([]);
  const [issuerFilter, setIssuerFilter] = useState('all');

  useEffect(() => {
    const loadStats = async () => {
      try {
        const data = await api.billing.getStats(issuerFilter === 'all' ? undefined : Number(issuerFilter));
        setStats(data);
      } catch (error) {
        console.error(error);
      }
    };
    void loadStats();
  }, [issuerFilter]);

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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
            <h3 className="font-semibold text-slate-700">Rest de Plată</h3>
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

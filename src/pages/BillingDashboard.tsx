import React, { useState, useEffect } from 'react';
import { FileText, Users, DollarSign, TrendingUp } from 'lucide-react';
import { api } from '../shared/api';

export function BillingDashboard() {
  const [stats, setStats] = useState({ totalInvoiced: 0, totalPaid: 0, totalUnpaid: 0 });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await api.billing.getStats();
      setStats(data);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Dashboard Facturare</h1>
        <p className="text-slate-500 mt-2">Sumarul financiar și situația restanțierilor.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
              <TrendingUp size={20} />
            </div>
            <h3 className="font-semibold text-slate-700">Total Facturat</h3>
          </div>
          <div className="text-3xl font-bold text-slate-900">£ {stats.totalInvoiced.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
              <DollarSign size={20} />
            </div>
            <h3 className="font-semibold text-slate-700">Total Încasat</h3>
          </div>
          <div className="text-3xl font-bold text-slate-900">£ {stats.totalPaid.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-red-100 text-red-600 rounded-xl flex items-center justify-center">
              <FileText size={20} />
            </div>
            <h3 className="font-semibold text-slate-700">Rest de Plată</h3>
          </div>
          <div className="text-3xl font-bold text-slate-900">£ {stats.totalUnpaid.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
      </div>
      
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center text-slate-500">
        Secțiune în construcție. Așteptăm detaliile platformei Lovable pentru sincronizarea automată.
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { api } from '../shared/api';
import { Building2, Store, RefreshCw, AlertCircle, FileText } from 'lucide-react';

export function BillingClients() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [syncing, setSyncing] = useState(false);

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      const data = await api.billing.getAllCompaniesAndStores();
      setCompanies(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncWithServer = async () => {
    try {
      setSyncing(true);
      await api.billing.syncEntities();
      await fetchCompanies();
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Clienți & Entități</h1>
          <p className="text-slate-500 mt-2">Baza de date cu clienți (companii) și magazinele (punctele de lucru) mapate din Supabase.</p>
        </div>
        <button 
          onClick={handleSyncWithServer}
          disabled={syncing}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium shadow-sm shadow-indigo-600/30 transition-colors"
        >
          <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
          Sincronizează cu Serverul
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <RefreshCw className="animate-spin text-indigo-500" size={32} />
        </div>
      ) : companies.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
          <Building2 size={48} className="mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-bold text-slate-700 mb-2">Nicio companie găsită</h3>
          <p className="text-slate-500 max-w-md mx-auto">Nu există companii în baza de date locală. Ele se sincronizează automat când aduci comenzile din secțiunea "Facturi".</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {companies.map(company => (
            <div key={company.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-indigo-100 text-indigo-700 rounded-lg flex items-center justify-center shrink-0">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-lg leading-tight">{company.name}</h3>
                    <div className="text-sm text-slate-500 mt-1 flex flex-col gap-0.5">
                      {company.cui && <span>VAT No: <span className="font-medium text-slate-700 font-mono">{company.cui}</span></span>}
                      {company.reg_com && <span>CRN: <span className="font-medium text-slate-700 font-mono">{company.reg_com}</span></span>}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="p-5 flex-1 bg-white">
                <div className="flex items-center gap-2 mb-3">
                  <Store size={16} className="text-slate-400" />
                  <span className="font-semibold text-slate-700 text-sm">Magazine ({company.stores?.length || 0})</span>
                </div>
                
                {company.stores && company.stores.length > 0 ? (
                  <ul className="space-y-2">
                    {company.stores.map((store: any) => (
                      <li key={store.id} className="text-sm flex items-start gap-2 p-2 rounded bg-slate-50 border border-slate-100">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0"></div>
                        <div>
                          <p className="font-medium text-slate-800">{store.name}</p>
                          {store.address && <p className="text-slate-500 text-xs mt-0.5">{store.address}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-slate-400 italic flex items-center gap-1">
                    <AlertCircle size={14} /> Fără magazine mapate
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

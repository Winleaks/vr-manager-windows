import React, { useEffect, useState } from 'react';
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  Truck,
  User,
  Trash2
} from 'lucide-react';
import { useCashStore } from '../store/cashStore';
import { DateRangePicker } from '../components/DateRangePicker';
import { api } from '../shared/api';

export function DailyCash() {
  const { activeDay, dateFilter, setDateFilter, transactions: storeTransactions, fetchActiveDay } = useCashStore();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const reloadData = async () => {
    setLoading(true);
    try {
      const result = await api.dailyCash.getTransactionsByDateRange(
        dateFilter.startDate, 
        dateFilter.endDate
      );
      setData(result);
      if (fetchActiveDay) fetchActiveDay();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadData();
  }, [dateFilter, storeTransactions]);

  const handleDeleteTransaction = async (id: number) => {
    if (window.confirm('Ești sigur că vrei să ștergi această tranzacție din registru?')) {
      await api.dailyCash.deleteTransaction(id);
      reloadData();
    }
  };

  // Aggregations based on fetched data
  const totalIn = data.filter(t => t.type === 'IN').reduce((sum, t) => sum + t.amount, 0);
  const totalOut = data.filter(t => t.type === 'OUT').reduce((sum, t) => sum + t.amount, 0);
  const netCashFlow = totalIn - totalOut;

  return (
    <div className="p-8 pb-32">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col gap-5 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
              <Wallet size={26} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Daily Cash Dashboard</h1>
              <p className="text-slate-500 text-sm">Privire de ansamblu asupra fluxului de numerar</p>
            </div>
          </div>
          <div>
            <DateRangePicker 
              startDate={dateFilter.startDate} 
              endDate={dateFilter.endDate} 
              onChange={setDateFilter} 
            />
          </div>
        </div>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="text-slate-500 text-sm font-medium mb-2">Tranzacții (Perioadă)</div>
            <div className="text-2xl font-bold text-slate-800">{data.length}</div>
          </div>
          
          <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-100 shadow-sm flex flex-col justify-between">
            <div className="text-emerald-700 text-sm font-medium mb-2 flex items-center gap-1"><TrendingUp size={16}/> Total Intrări</div>
            <div className="text-2xl font-bold text-emerald-700">
              {totalIn.toFixed(2)} <span className="text-sm font-normal opacity-80">£</span>
            </div>
          </div>

          <div className="bg-rose-50 p-5 rounded-2xl border border-rose-100 shadow-sm flex flex-col justify-between">
            <div className="text-rose-700 text-sm font-medium mb-2 flex items-center gap-1"><TrendingDown size={16}/> Total Ieșiri</div>
            <div className="text-2xl font-bold text-rose-700">
              {totalOut.toFixed(2)} <span className="text-sm font-normal opacity-80">£</span>
            </div>
          </div>

          <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700 shadow-lg flex flex-col justify-between relative overflow-hidden">
            <div className="text-slate-300 text-sm font-medium mb-2 relative z-10">Cash Flow Net</div>
            <div className={`text-3xl font-bold relative z-10 ${netCashFlow >= 0 ? 'text-white' : 'text-rose-400'}`}>
              {netCashFlow > 0 ? '+' : ''}{netCashFlow.toFixed(2)} <span className="text-lg font-normal text-slate-400">£</span>
            </div>
            <Wallet className="absolute -right-4 -bottom-4 w-24 h-24 text-slate-700 opacity-50" />
          </div>
        </div>
        
        {/* Current Active Day Status (Always visible regardless of filter, just as an indicator) */}
        {activeDay && (
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl flex justify-between items-center text-blue-800">
            <div>
              <span className="font-bold">Sesiune curentă deschisă:</span> {activeDay.date}
            </div>
            <div className="flex gap-4">
              <div>Sold Deschidere: <span className="font-bold">£{activeDay.opening_balance.toFixed(2)}</span></div>
              <div>Sold Curent: <span className="font-bold">£{activeDay.current_balance.toFixed(2)}</span></div>
            </div>
          </div>
        )}

        {/* Transactions Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <h2 className="font-bold text-slate-800">Istoric Tranzacții (Perioada Selectată)</h2>
          </div>
          {loading ? (
             <div className="p-8 text-center text-slate-500">Se încarcă...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-medium">Dată/Ora</th>
                    <th className="px-6 py-4 font-medium">Tip</th>
                    <th className="px-6 py-4 font-medium">Categorie / Detalii</th>
                    <th className="px-6 py-4 font-medium text-right">Suma</th>
                    <th className="px-6 py-4 font-medium">Note</th>
                    <th className="px-6 py-4 font-medium text-right">Acțiuni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-slate-500">Nicio tranzacție înregistrată.</td>
                    </tr>
                  ) : (
                    data.map(t => (
                      <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 text-slate-500">
                          {new Date(t.created_at).toLocaleDateString('ro-RO')} <br/>
                          <span className="text-xs">{new Date(t.created_at).toLocaleTimeString('ro-RO', {hour:'2-digit', minute:'2-digit'})}</span>
                        </td>
                        <td className="px-6 py-4">
                          {t.type === 'IN' 
                            ? <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-bold">IN</span>
                            : <span className="bg-rose-100 text-rose-700 px-2 py-1 rounded text-xs font-bold">OUT</span>
                          }
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-800">
                            {t.category === 'driver_collection' ? 'Încasare Șofer' : 
                             t.category === 'direct_sale' ? 'Vânzare Directă' : 
                             t.category === 'purchase' ? 'Achiziție Marfă' : 
                             t.category === 'cash_collection' ? 'Colectare Cash' : 'Alte Cheltuieli'}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 flex gap-2">
                            {t.driver_name && <span className="flex items-center gap-1"><Truck size={12}/> {t.driver_name}</span>}
                            {t.employee_name && <span className="flex items-center gap-1"><User size={12}/> {t.employee_name}</span>}
                            {t.reference_name && <span className="flex items-center gap-1"><User size={12}/> {t.reference_name}</span>}
                          </div>
                        </td>
                        <td className={`px-6 py-4 font-bold text-right ${t.type === 'IN' ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {t.type === 'IN' ? '+' : '-'}{t.amount.toFixed(2)} £
                        </td>
                        <td className="px-6 py-4 text-slate-600">{t.notes}</td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleDeleteTransaction(t.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Șterge tranzacția"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { Calendar, DownloadCloud, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { api } from '../shared/api';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format, startOfWeek, endOfWeek, addDays, parseISO } from 'date-fns';
import { ro } from 'date-fns/locale';

export function BillingInvoices() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  const dateRangeStr = `${format(weekStart, 'dd MMM', { locale: ro })} - ${format(weekEnd, 'dd MMM yyyy', { locale: ro })}`;

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      // Format to YYYY-MM-DD for Supabase
      const startStr = format(weekStart, 'yyyy-MM-dd');
      const endStr = format(weekEnd, 'yyyy-MM-dd');
      
      const res = await api.billing.syncSupabaseOrders(startStr, endStr);
      setSyncResult(res);
    } catch (e: any) {
      setSyncResult({ success: false, message: e.message || 'Eroare necunoscută' });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Sincronizare & Facturi</h1>
          <p className="text-slate-500 mt-2">Preluare comenzi Lovable și emitere facturi (Săptămânal).</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-8 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-slate-500 mb-1">Alege săptămâna</span>
            <div className="relative">
              <DatePicker
                selected={selectedDate}
                onChange={(date) => date && setSelectedDate(date)}
                dateFormat="dd MMM yyyy"
                locale={ro}
                customInput={
                  <button className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-700 hover:bg-slate-100 transition-colors">
                    <Calendar size={18} className="text-indigo-600" />
                    <span className="font-medium">{dateRangeStr}</span>
                  </button>
                }
              />
            </div>
          </div>
          
          <div className="h-10 w-px bg-slate-200"></div>
          
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-6 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
          >
            {isSyncing ? <Loader2 size={18} className="animate-spin" /> : <DownloadCloud size={18} />}
            {isSyncing ? 'Se sincronizează...' : 'Sincronizează Comenzile din Cloud'}
          </button>
        </div>
      </div>

      {syncResult && (
        <div className={`p-6 rounded-2xl mb-8 border ${syncResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          <div className="flex items-center gap-3 font-semibold mb-2">
            {syncResult.success ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
            {syncResult.message}
          </div>
          {syncResult.success && syncResult.ordersByStore && (
            <div className="mt-4 space-y-4">
              <p className="font-medium">Am găsit comenzi pentru {syncResult.ordersByStore.length} magazine.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {syncResult.ordersByStore.map((data: any, idx: number) => {
                  const total = data.items.reduce((acc: number, item: any) => acc + item.totalPrice, 0);
                  return (
                    <div key={idx} className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm">
                      <div className="font-bold text-slate-800">{data.store.name}</div>
                      <div className="text-sm text-slate-500 mb-2">{data.store.owner?.company_name || 'Companie neasociată'}</div>
                      <div className="text-sm text-slate-600 mb-2">{data.items.length} produse comandate</div>
                      <div className="font-semibold text-emerald-700 border-t border-emerald-50 pt-2 mt-2">
                        Total calculat: {total.toFixed(2)} GBP
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center text-slate-500">
        Aici vor apărea facturile PDF generate după ce salvăm comenzile sincronizate în baza noastră locală.
      </div>
    </div>
  );
}

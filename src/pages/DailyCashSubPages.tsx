import React, { useEffect, useState } from 'react';
import { useCashStore } from '../store/cashStore';
import { DateRangePicker } from '../components/DateRangePicker';
import { PlusCircle, FileText, Truck, User, Pencil, Trash2 } from 'lucide-react';
import { api } from '../shared/api';
import { NumericInput } from '../components/NumericInput';

interface PageProps {
  title: string;
  category: string;
  icon: React.ReactNode;
  color: 'emerald' | 'rose' | 'orange' | 'blue';
  modalType: 'incasare' | 'vanzare' | 'plata' | 'colectare';
}

export function TransactionHistoryPage({ title, category, icon, color, modalType }: PageProps) {
  const { dateFilter, setDateFilter, openModal, loadData, drivers } = useCashStore();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<any | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDriverId, setEditDriverId] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [deviceRole, setDeviceRole] = useState<'writer' | 'viewer'>('viewer');

  const transactionsTrigger = useCashStore(state => state.transactions);

  useEffect(() => {
    api.system.getDeviceRole().then((state) => setDeviceRole(state.role)).catch(() => {});
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const result = await api.dailyCash.getTransactionsByDateRange(
          dateFilter.startDate, 
          dateFilter.endDate, 
          category
        );
        setData(result);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [dateFilter, category, transactionsTrigger]);

  const totalSum = data.reduce((sum, t) => sum + t.amount, 0);
  const managesDriverReceipts = category === 'driver_collection' && deviceRole === 'writer';

  const beginReceiptEdit = (transaction: any) => {
    setEditingReceipt(transaction);
    setEditAmount(Number(transaction.amount).toFixed(2));
    setEditDriverId(String(transaction.reference_id || ''));
    setEditNotes(transaction.notes || '');
  };

  const handleReceiptUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingReceipt) return;
    const amount = Number(editAmount);
    const referenceId = Number(editDriverId);
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(\.\d{1,2})?$/.test(editAmount.trim()) || !Number.isInteger(referenceId) || referenceId <= 0) {
      window.alert('Verifică șoferul și suma introdusă. Suma poate avea maximum două zecimale.');
      return;
    }
    try {
      await api.dailyCash.updateReceipt({ id: editingReceipt.id, amount, reference_id: referenceId, notes: editNotes });
      setEditingReceipt(null);
      await loadData();
    } catch (error: any) {
      window.alert(error?.message || 'Încasarea nu a putut fi modificată.');
    }
  };

  const handleReceiptDelete = async (transaction: any) => {
    if (!window.confirm(`Ștergi încasarea de £${Number(transaction.amount).toFixed(2)}?`)) return;
    try {
      await api.dailyCash.deleteTransaction(transaction.id);
      await loadData();
    } catch (error: any) {
      window.alert(error?.message || 'Încasarea nu a putut fi ștearsă.');
    }
  };

  const colorConfig = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', btn: 'bg-emerald-600 hover:bg-emerald-700' },
    rose: { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200', btn: 'bg-rose-600 hover:bg-rose-700' },
    orange: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200', btn: 'bg-orange-600 hover:bg-orange-700' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200', btn: 'bg-blue-600 hover:bg-blue-700' }
  };

  const theme = colorConfig[color];

  return (
    <div className="p-8 pb-32">
      <div className="flex flex-col gap-5 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
            <span className={theme.text}>{icon}</span>
            {title}
          </h1>
          <p className="text-slate-500 mt-1">Istoric tranzacții și rapoarte</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <DateRangePicker 
            startDate={dateFilter.startDate} 
            endDate={dateFilter.endDate} 
            onChange={setDateFilter} 
          />
          {deviceRole === 'writer' && (
            <button
              onClick={() => openModal(modalType)}
              className={`px-5 py-2.5 text-white font-medium rounded-lg flex items-center gap-2 shadow-sm transition-colors ${theme.btn}`}
            >
              <PlusCircle size={20} />
              Adaugă
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className={`p-6 rounded-2xl border shadow-sm flex flex-col justify-center ${theme.bg} ${theme.border}`}>
          <div className="text-sm font-bold text-slate-500 mb-1">TOTAL SUMĂ (Perioada selectată)</div>
          <div className={`text-4xl font-black ${theme.text}`}>£{totalSum.toFixed(2)}</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
          <div className="text-sm font-bold text-slate-500 mb-1">NUMĂR TRANZACȚII</div>
          <div className="text-4xl font-black text-slate-700">{data.length}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <FileText size={18} className="text-slate-400" />
            Istoric Detaliat
          </h3>
        </div>
        {loading ? (
          <div className="p-10 text-center text-slate-500">Se încarcă datele...</div>
        ) : data.length === 0 ? (
          <div className="p-10 text-center text-slate-500">Nu există tranzacții în perioada selectată.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-bold">
                  <th className="p-4 w-40">Dată</th>
                  <th className="p-4 w-32">Oră</th>
                  <th className="p-4">Referință</th>
                  <th className="p-4">Detalii</th>
                  <th className="p-4 text-right w-40">Sumă</th>
                  {managesDriverReceipts && <th className="p-4 text-right w-32">Acțiuni</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map(t => {
                   const d = new Date(t.created_at);
                   const dateFormatted = d.toLocaleDateString('ro-RO');
                   const timeFormatted = d.toLocaleTimeString('ro-RO', {hour: '2-digit', minute:'2-digit'});
                   
                   return (
                     <tr key={t.id} className="hover:bg-slate-50/50">
                       <td className="p-4 text-slate-600 font-medium">{dateFormatted}</td>
                       <td className="p-4 text-slate-500 text-sm">{timeFormatted}</td>
                       <td className="p-4">
                          <div className="font-medium text-slate-800">
                            {t.driver_name ? <span className="flex items-center gap-1"><Truck size={14} className="text-slate-400"/> {t.driver_name}</span> : 
                             t.employee_name ? <span className="flex items-center gap-1"><User size={14} className="text-slate-400"/> {t.employee_name}</span> : 
                             t.reference_name ? <span className="flex items-center gap-1"><User size={14} className="text-slate-400"/> {t.reference_name}</span> : 
                             '-'}
                          </div>
                       </td>
                       <td className="p-4 text-slate-600 text-sm">{t.notes || '-'}</td>
                       <td className="p-4 text-right">
                         <span className={`font-bold ${theme.text}`}>£{t.amount.toFixed(2)}</span>
                       </td>
                       {managesDriverReceipts && (
                         <td className="p-4 text-right">
                           {Number(t.cash_day_closed) === 0 ? (
                             <div className="inline-flex gap-1">
                               <button type="button" onClick={() => beginReceiptEdit(t)} className="p-2 rounded-lg text-blue-600 hover:bg-blue-50" title="Modifică încasarea">
                                 <Pencil size={16} />
                               </button>
                               <button type="button" onClick={() => handleReceiptDelete(t)} className="p-2 rounded-lg text-rose-600 hover:bg-rose-50" title="Șterge încasarea">
                                 <Trash2 size={16} />
                               </button>
                             </div>
                           ) : <span className="text-xs text-slate-400">Zi închisă</span>}
                         </td>
                       )}
                     </tr>
                   );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingReceipt && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-emerald-50 flex justify-between items-center">
              <h3 className="font-bold text-emerald-800">Modifică încasarea</h3>
              <button type="button" onClick={() => setEditingReceipt(null)} className="text-slate-500">&times;</button>
            </div>
            <form onSubmit={handleReceiptUpdate} className="p-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Șofer
                <select required value={editDriverId} onChange={(event) => setEditDriverId(event.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white">
                  <option value="">-- Selectează șofer --</option>
                  {drivers.map((driver: any) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Suma (£)
                <NumericInput decimalScale={2} required value={editAmount} onChange={(event) => setEditAmount(event.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Note
                <input type="text" value={editNotes} onChange={(event) => setEditNotes(event.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg" />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingReceipt(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700">Renunță</button>
                <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium">Salvează</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function HistoricalZPage() {
  const { dateFilter, setDateFilter } = useCashStore();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const transactionsTrigger = useCashStore(state => state.transactions);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const result = await api.dailyCash.getHistoricalZReports(
          dateFilter.startDate, 
          dateFilter.endDate
        );
        setData(result);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [dateFilter, transactionsTrigger]);

  return (
    <div className="p-8 pb-32">
      <div className="flex flex-col gap-5 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
            <span className="text-slate-600"><FileText size={24}/></span>
            Istoric Închideri Z
          </h1>
          <p className="text-slate-500 mt-1">Rapoarte de final de zi</p>
        </div>
        <div className="flex items-center gap-4">
          <DateRangePicker 
            startDate={dateFilter.startDate} 
            endDate={dateFilter.endDate} 
            onChange={setDateFilter} 
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-500">Se încarcă datele...</div>
        ) : data.length === 0 ? (
          <div className="p-10 text-center text-slate-500">Nu există rapoarte Z în perioada selectată.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-bold">
                  <th className="p-4 w-40">Ziua</th>
                  <th className="p-4 w-40 text-right">Sold Deschidere</th>
                  <th className="p-4 w-40 text-right">Sold Închidere</th>
                  <th className="p-4 w-40">Închis la</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map(z => {
                   const closedAt = z.closed_at ? new Date(z.closed_at) : null;
                   
                   return (
                     <tr key={z.id} className="hover:bg-slate-50/50">
                       <td className="p-4 text-slate-800 font-bold">{z.date}</td>
                       <td className="p-4 text-right text-slate-500">£{z.opening_balance.toFixed(2)}</td>
                       <td className="p-4 text-right font-black text-slate-800">£{z.closing_balance.toFixed(2)}</td>
                       <td className="p-4 text-slate-500 text-sm">
                         {closedAt ? `${closedAt.toLocaleDateString('ro-RO')} ${closedAt.toLocaleTimeString('ro-RO', {hour:'2-digit', minute:'2-digit'})}` : '-'}
                       </td>
                     </tr>
                   );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { Calendar, DownloadCloud, Loader2, CheckCircle, AlertTriangle, FileText, Printer } from 'lucide-react';
import { api } from '../shared/api';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format, startOfWeek, endOfWeek, parseISO } from 'date-fns';
import { ro } from 'date-fns/locale';
import { generateInvoicePDF } from '../utils/pdfGenerator';

export function BillingInvoices() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generatingOrderId, setGeneratingOrderId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<any>(null);

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  const dateRangeStr = `${format(weekStart, 'dd MMM', { locale: ro })} - ${format(weekEnd, 'dd MMM yyyy', { locale: ro })}`;

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
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

  const generatePdfForOrder = async (order: any, isRegenerate = false) => {
    try {
      let currentOrder = order;
      if (!isRegenerate) {
        const res = await api.billing.createInvoicesFromSync([order]);
        if (!res.success) throw new Error(res.message);
        currentOrder = res.updatedOrders[0];

        setSyncResult((prev: any) => ({
          ...prev,
          ordersByStore: prev.ordersByStore.map((o: any) => 
            o.store.id === currentOrder.store.id ? currentOrder : o
          )
        }));
      }

      const settings = await api.billing.getSettings();
      const pdfData = {
        invoiceNumber: currentOrder.assignedInvoiceNumber,
        invoiceDate: currentOrder.assignedInvoiceDate,
        client: {
          name: currentOrder.store.owner?.company_name || currentOrder.store.name,
          cui: currentOrder.store.owner?.cui,
          regCom: currentOrder.store.owner?.reg_com,
          address: currentOrder.store.owner?.address,
          county: currentOrder.store.owner?.county,
          city: currentOrder.store.owner?.city
        },
        items: currentOrder.items,
        totalAmount: currentOrder.items.reduce((acc: number, item: any) => acc + item.totalPrice, 0)
      };

      const buffer = generateInvoicePDF(settings, pdfData);
      const filename = `Factura_${settings.invoiceSeries || 'FACT'}_${currentOrder.assignedInvoiceNumber}.pdf`;

      await api.system.savePdfAuto({ buffer, filename });
      api.system.uploadPdfToCloud(filename, buffer).catch(console.error); // fundal
      
      return true;
    } catch (e: any) {
      alert('Eroare la generare: ' + e.message);
      return false;
    }
  };

  const handleGenerateAll = async () => {
    const pendingOrders = syncResult.ordersByStore.filter((o: any) => !o.assignedInvoiceNumber);
    if (pendingOrders.length === 0) {
      alert('Toate facturile sunt deja generate!');
      return;
    }
    
    setIsGeneratingAll(true);
    let successCount = 0;
    
    for (const order of pendingOrders) {
      const ok = await generatePdfForOrder(order, false);
      if (ok) successCount++;
    }
    
    setIsGeneratingAll(false);
    if (successCount > 0) {
      alert(`Au fost generate cu succes ${successCount} facturi noi! (Salvate în Documents/Facturi Vatra Romaneasca și pe Google Drive)`);
    }
  };

  const handleGenerateIndividual = async (order: any) => {
    setGeneratingOrderId(order.store.id);
    const isRegenerate = !!order.assignedInvoiceNumber;
    await generatePdfForOrder(order, isRegenerate);
    if (isRegenerate) {
      alert('Factura a fost re-generată cu succes în folderul tău!');
    }
    setGeneratingOrderId(null);
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
        <div className={`p-6 rounded-2xl mb-8 border ${syncResult.success ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200 text-red-800'}`}>
          <div className={`flex items-center gap-3 font-semibold mb-2 ${syncResult.success ? 'text-emerald-800' : ''}`}>
            {syncResult.success ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
            {syncResult.message}
          </div>
          {syncResult.success && syncResult.ordersByStore && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-medium text-slate-700">Am găsit comenzi pentru {syncResult.ordersByStore.length} magazine.</p>
                <button 
                  onClick={handleGenerateAll}
                  disabled={isGeneratingAll}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white px-6 py-2 rounded-xl font-medium transition-colors shadow-sm"
                >
                  {isGeneratingAll ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                  Generează Toate Facturile
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {syncResult.ordersByStore.map((data: any, idx: number) => {
                  const total = data.items.reduce((acc: number, item: any) => acc + item.totalPrice, 0);
                  const isGenerated = !!data.assignedInvoiceNumber;
                  const isDoing = generatingOrderId === data.store.id;
                  
                  return (
                    <div key={idx} className={`bg-white p-4 rounded-xl border shadow-sm ${isGenerated ? 'border-emerald-500' : 'border-slate-200'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-bold text-slate-800 flex items-center gap-2">
                            {data.store.name}
                            {isGenerated && <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full">FACT {data.assignedInvoiceNumber}</span>}
                          </div>
                          <div className="text-sm text-slate-500 mb-2">{data.store.owner?.company_name || 'Companie neasociată'}</div>
                          <div className="text-sm text-slate-600 mb-2">{data.items.length} produse comandate</div>
                          <div className="font-semibold text-slate-700 border-t border-slate-100 pt-2 mt-2">
                            Total calculat: {total.toFixed(2)} GBP
                          </div>
                        </div>
                        
                        <button
                          onClick={() => handleGenerateIndividual(data)}
                          disabled={isDoing}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            isGenerated 
                              ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' 
                              : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                          }`}
                        >
                          {isDoing ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : isGenerated ? (
                            <Printer size={16} />
                          ) : (
                            <FileText size={16} />
                          )}
                          {isGenerated ? 'Retipărește' : 'Generează'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { Calendar, Loader2, FileText, Printer, Building2, Trash2, ShoppingBag, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../shared/api';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { ro } from 'date-fns/locale';
import { generateInvoicePDF } from '../utils/pdfGenerator';

export function BillingOrders() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generatingOrderId, setGeneratingOrderId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<any>(null);

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });

  const handlePrevWeek = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 7);
    setSelectedDate(newDate);
  };

  const handleNextWeek = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 7);
    setSelectedDate(newDate);
  };

  const handleCurrentWeek = () => {
    setSelectedDate(new Date());
  };

  const getDayClassName = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(weekEnd);
    end.setHours(0, 0, 0, 0);

    const classes = [];

    if (d.getDay() === 1) {
      classes.push('day-monday-highlight');
    }

    if (d.getTime() >= start.getTime() && d.getTime() <= end.getTime()) {
      classes.push('custom-week-highlight');
    }

    return classes.join(' ');
  };


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
          name: currentOrder.store.client_company?.name || currentOrder.store.name,
          cui: currentOrder.store.client_company?.vat_number || currentOrder.store.client_company?.cui,
          regCom: currentOrder.store.client_company?.registration_number || currentOrder.store.client_company?.reg_com,
          address: currentOrder.store.client_company?.address || currentOrder.store.address,
          county: currentOrder.store.owner?.county,
          city: currentOrder.store.owner?.city
        },
        store: {
          name: currentOrder.store.name,
          address: currentOrder.store.address,
        },
        items: currentOrder.items,
        totalAmount: currentOrder.items.reduce((acc: number, item: any) => acc + item.totalPrice, 0)
      };

      const buffer = generateInvoicePDF(settings, pdfData);
      const filename = `Factura_${settings.invoiceSeries || 'FACT'}_${currentOrder.assignedInvoiceNumber}.pdf`;

      await api.system.savePdfAuto({ buffer, filename });
      api.system.uploadPdfToCloud(filename, buffer).catch(console.error);
      
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
    await generatePdfForOrder(order, false);
    setGeneratingOrderId(null);
  };

  const handleOpenPdf = async (order: any) => {
    setGeneratingOrderId(order.store.id);
    try {
      const settings = await api.billing.getSettings();
      const series = settings.invoiceSeries || 'FACT';
      const filename = `Factura_${series}_${order.assignedInvoiceNumber}.pdf`;

      const res = await api.system.openPdfFile(filename);
      if (res.notFound) {
        await generatePdfForOrder(order, true);
        await api.system.openPdfFile(filename);
      }
    } catch (e: any) {
      alert('Eroare la deschiderea PDF: ' + e.message);
    } finally {
      setGeneratingOrderId(null);
    }
  };

  const handleDeleteInvoice = async (order: any) => {
    if (!order.assignedInvoiceNumber) return;
    if (window.confirm(`Ești sigur că dorești să ștergi factura FACT #${order.assignedInvoiceNumber} pentru magazinul ${order.store.name}?`)) {
      try {
        const settings = await api.billing.getSettings();
        const series = settings.invoiceSeries || 'FACT';
        const filename = `Factura_${series}_${order.assignedInvoiceNumber}.pdf`;

        const allInvoices = await api.billing.getInvoices();
        const inv = allInvoices.find((i: any) => i.invoice_number === order.assignedInvoiceNumber);

        if (inv) {
          await api.billing.deleteInvoice(inv.id);
        }

        await api.system.deletePdfAuto(filename);

        setSyncResult((prev: any) => ({
          ...prev,
          ordersByStore: prev.ordersByStore.map((o: any) => 
            o.store.id === order.store.id ? { ...o, assignedInvoiceNumber: undefined, assignedInvoiceDate: undefined } : o
          )
        }));

        alert(`Factura #${order.assignedInvoiceNumber} a fost ștearsă din sistem, de pe calculator și din Google Drive!`);
      } catch (e: any) {
        alert('Eroare la ștergere: ' + e.message);
      }
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header Standard Pagină */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
              <ShoppingBag size={22} />
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Sincronizare Comenzi</h1>
          </div>
          <p className="text-slate-500 mt-2">Selectează săptămâna dorită și sincronizează comenzile din cloud pentru generarea facturilor.</p>
        </div>

        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-xl shadow-sm transition-colors flex items-center gap-2 self-start md:self-auto"
        >
          {isSyncing ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          <span>{isSyncing ? 'Se sincronizează...' : 'Sincronizează Comenzi'}</span>
        </button>
      </div>

      {/* Card Filtrare Săptămână (stil unitar cu celelalte pagini, compact) */}
      <div className="bg-white p-4 px-6 rounded-2xl border border-slate-200 shadow-sm mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 mr-1">
            <Calendar size={18} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">Filtrează după Săptămână:</span>
          </div>

          <button
            onClick={handleCurrentWeek}
            className="px-4 py-2 text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
          >
            Săptămâna Curentă
          </button>

          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-sm">
            <button
              onClick={handlePrevWeek}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors"
              title="Săptămâna anterioară"
            >
              <ChevronLeft size={18} />
            </button>

            <div className="relative flex items-center px-3 py-1">
              <DatePicker
                selected={selectedDate}
                onChange={(date: Date | null) => date && setSelectedDate(date)}
                dateFormat="dd MMM yyyy"
                locale={ro}
                calendarStartDay={1}
                dayClassName={getDayClassName}
                className="bg-transparent text-slate-800 font-semibold text-sm outline-none cursor-pointer"
                customInput={
                  <button className="flex items-center gap-1.5 font-bold text-slate-800 text-sm hover:text-indigo-600 transition-colors">
                    <span>
                      Luni, {format(weekStart, 'dd MMM', { locale: ro })} - Duminică, {format(weekEnd, 'dd MMM yyyy', { locale: ro })}
                    </span>
                  </button>
                }
              />
            </div>

            <button
              onClick={handleNextWeek}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors"
              title="Săptămâna următoare"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {syncResult && (
        <div className="space-y-6">
          {!syncResult.success ? (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl">
              {syncResult.message}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-900">
                  Comenzi Găsite ({syncResult.ordersByStore.length} magazine)
                </h2>

                <button
                  onClick={handleGenerateAll}
                  disabled={isGeneratingAll || syncResult.ordersByStore.every((o: any) => o.assignedInvoiceNumber)}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-2 text-sm"
                >
                  {isGeneratingAll ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
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
                            {isGenerated && <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-medium">FACT {data.assignedInvoiceNumber}</span>}
                          </div>
                          <div className="text-sm text-slate-600 mb-2 flex items-center gap-1.5 flex-wrap">
                            <Building2 size={14} className="text-indigo-500" />
                            <span className="font-medium text-slate-800">{data.store.client_company?.name || data.store.company_name || 'Companie neasociată'}</span>
                          </div>
                          <div className="font-semibold text-slate-700 border-t border-slate-100 pt-2 mt-2">
                            Total calculat: £{total.toFixed(2)}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {isGenerated ? (
                            <button
                              onClick={() => handleOpenPdf(data)}
                              disabled={isDoing}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-slate-100 hover:bg-slate-200 text-slate-700"
                              title="Deschide PDF-ul facturii"
                            >
                              {isDoing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                              Deschide PDF
                            </button>
                          ) : (
                            <button
                              onClick={() => handleGenerateIndividual(data)}
                              disabled={isDoing}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-indigo-50 hover:bg-indigo-100 text-indigo-700"
                            >
                              {isDoing ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                              Generează
                            </button>
                          )}

                          {isGenerated && (
                            <button
                              onClick={() => handleDeleteInvoice(data)}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Șterge factura din sistem, disk & cloud"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
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

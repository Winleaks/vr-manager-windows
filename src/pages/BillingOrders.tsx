import { useEffect, useState } from 'react';
import { Calendar, Loader2, FileText, Printer, Building2, Trash2, ShoppingBag, RefreshCw, ChevronLeft, ChevronRight, MapPin, Truck } from 'lucide-react';
import { api } from '../shared/api';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { ro } from 'date-fns/locale';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { TextConfirmationModal } from '../components/TextConfirmationModal';

const UNASSIGNED_ZONE_KEY = 'unassigned';

function orderZoneKey(order: any) {
  return order.store.zone?.id || UNASSIGNED_ZONE_KEY;
}

function buildZoneSummaries(syncResult: any) {
  if (!syncResult?.success) return [];
  const orders = Array.isArray(syncResult.ordersByStore) ? syncResult.ordersByStore : [];
  const zoneMap = new Map<string, any>();
  for (const zone of Array.isArray(syncResult.zones) ? syncResult.zones : []) {
    zoneMap.set(zone.id, { ...zone, key: zone.id });
  }
  for (const order of orders) {
    const zone = order.store.zone;
    if (zone && !zoneMap.has(zone.id)) zoneMap.set(zone.id, { ...zone, key: zone.id });
  }
  const zones = [...zoneMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  if (orders.some((order: any) => orderZoneKey(order) === UNASSIGNED_ZONE_KEY)) {
    zones.push({ key: UNASSIGNED_ZONE_KEY, id: null, name: 'FĂRĂ ZONĂ ALOCATĂ', color: '#D97706', driver: null });
  }
  return zones.map((zone) => {
    const zoneOrders = orders.filter((order: any) => orderZoneKey(order) === zone.key);
    return {
      ...zone,
      orders: zoneOrders,
      storeCount: zoneOrders.length,
      readyCount: zoneOrders.filter((order: any) => order.billingState === 'ready').length,
      generatedCount: zoneOrders.filter((order: any) => order.billingState === 'invoiced').length,
      total: zoneOrders.reduce((sum: number, order: any) => sum + order.items.reduce((itemSum: number, item: any) => itemSum + item.totalPrice, 0), 0),
    };
  });
}

export function BillingOrders() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generatingZoneKey, setGeneratingZoneKey] = useState<string | null>(null);
  const [generatingOrderId, setGeneratingOrderId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [testMode, setTestMode] = useState(false);
  const [pendingOrderAction, setPendingOrderAction] = useState<any | null>(null);
  const [selectedZoneKey, setSelectedZoneKey] = useState('all');

  useEffect(() => {
    api.billing.getTestMode().then((mode) => setTestMode(mode.enabled === true)).catch(console.error);
  }, []);

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
      
      const res = await api.billing.previewWeeklyInvoices(startStr, endStr);
      setSyncResult(res);
      setSelectedZoneKey('all');
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
        const startStr = format(weekStart, 'yyyy-MM-dd');
        const endStr = format(weekEnd, 'yyyy-MM-dd');
        const res = await api.billing.createWeeklyInvoices(startStr, endStr, [order.store.id]);
        if (!res.success) throw new Error(res.message);
        currentOrder = res.updatedOrders[0];

        setSyncResult((prev: any) => ({
          ...prev,
          ordersByStore: prev.ordersByStore.map((o: any) => 
            o.store.id === currentOrder.store.id ? currentOrder : o
          )
        }));
      }

      const sharedSettings = await api.billing.getSettings();
      const settings = { ...currentOrder.issuerSettings, invoiceLogo: sharedSettings.invoiceLogo };
      if (!currentOrder.issuerSettings) throw new Error('Snapshotul emitentului facturii lipsește.');
      const pdfData = {
        invoiceNumber: currentOrder.assignedInvoiceNumber,
        invoiceDate: currentOrder.assignedInvoiceDate,
        client: {
          name: currentOrder.store.company?.name || currentOrder.store.name,
          cui: currentOrder.store.company?.vatNumber,
          regCom: currentOrder.store.company?.registrationNumber,
          address: currentOrder.store.company?.address || currentOrder.store.address,
          county: currentOrder.store.owner?.county,
          city: currentOrder.store.owner?.city
        },
        store: {
          name: currentOrder.store.name,
          address: currentOrder.store.address,
          postcode: currentOrder.store.postcode,
        },
        items: currentOrder.items,
        totalAmount: currentOrder.items.reduce((acc: number, item: any) => acc + item.totalPrice, 0)
      };

      const buffer = generateInvoicePDF(settings, pdfData);
      const filename = `Factura_${currentOrder.assignedInvoiceNumber}.pdf`;

      await api.system.savePdfAuto({ buffer, filename, issuerCode: settings.code });
      api.system.uploadPdfToCloud(filename, buffer).catch(console.error);
      
      return true;
    } catch (e: any) {
      alert('Eroare la generare: ' + e.message);
      return false;
    }
  };

  const handleGenerateAll = async () => {
    const pendingOrders = syncResult.ordersByStore.filter((o: any) => o.billingState === 'ready');
    if (pendingOrders.length === 0) {
      alert('Toate facturile sunt deja generate!');
      return;
    }
    
    setIsGeneratingAll(true);
    let successCount = 0;
    let issuedCount = 0;
    const startStr = format(weekStart, 'yyyy-MM-dd');
    const endStr = format(weekEnd, 'yyyy-MM-dd');
    try {
      const res = await api.billing.createWeeklyInvoices(startStr, endStr, pendingOrders.map((order: any) => order.store.id));
      if (!res.success) throw new Error(res.message);
      issuedCount = res.updatedOrders.length;
      for (const order of res.updatedOrders) {
        if (await generatePdfForOrder(order, true)) successCount += 1;
      }
      setSyncResult((prev: any) => ({ ...prev, ordersByStore: prev.ordersByStore.map((old: any) => res.updatedOrders.find((next: any) => next.store.id === old.store.id) || old) }));
    } catch (e: any) {
      alert('Eroare la emiterea lotului: ' + e.message);
    }
    
    setIsGeneratingAll(false);
    if (issuedCount > 0) {
      alert(successCount === issuedCount
        ? `Au fost emise și pregătite cu succes ${issuedCount} facturi noi în registrele emitentelor și în Google Drive.`
        : `Au fost emise ${issuedCount} facturi. PDF-uri pregătite: ${successCount}. Documentele lipsă pot fi regenerate din lista facturilor.`);
    }
  };

  const handleGenerateZone = async (zone: any) => {
    const pendingOrders = zone.orders.filter((order: any) => order.billingState === 'ready');
    if (pendingOrders.length === 0) {
      alert('Zona selectată nu are facturi pregătite pentru emitere.');
      return;
    }
    const issuers = Object.values(pendingOrders.reduce((groups: any, order: any) => {
      const key = order.issuerId || 'unknown';
      groups[key] ||= { name: order.issuerName || 'Emitent neconfigurat', count: 0 };
      groups[key].count += 1;
      return groups;
    }, {})).map((issuer: any) => `${issuer.name}: ${issuer.count}`).join('\n');
    const confirmed = window.confirm(
      `Generezi facturile pentru zona „${zone.name}”?\n\n` +
      `Șofer: ${zone.driver?.name || 'Nealocat'}\n` +
      `Facturi noi: ${pendingOrders.length}\n` +
      `Total: £${pendingOrders.reduce((sum: number, order: any) => sum + order.items.reduce((itemSum: number, item: any) => itemSum + item.totalPrice, 0), 0).toFixed(2)}\n\n` +
      issuers,
    );
    if (!confirmed) return;

    setGeneratingZoneKey(zone.key);
    let successCount = 0;
    let issuedCount = 0;
    const startStr = format(weekStart, 'yyyy-MM-dd');
    const endStr = format(weekEnd, 'yyyy-MM-dd');
    try {
      const res = await api.billing.createWeeklyInvoicesByZone(
        startStr,
        endStr,
        zone.key === UNASSIGNED_ZONE_KEY ? null : zone.id,
      );
      if (!res.success) throw new Error(res.message);
      issuedCount = res.updatedOrders.length;
      for (const order of res.updatedOrders) {
        if (await generatePdfForOrder(order, true)) successCount += 1;
      }
      setSyncResult((prev: any) => ({
        ...prev,
        ordersByStore: prev.ordersByStore.map((old: any) => res.updatedOrders.find((next: any) => next.store.id === old.store.id) || old),
      }));
      alert(successCount === issuedCount
        ? `Au fost emise și pregătite ${issuedCount} facturi pentru zona „${zone.name}”.`
        : `Au fost emise ${issuedCount} facturi pentru zona „${zone.name}”. PDF-uri pregătite: ${successCount}. Documentele lipsă pot fi regenerate din lista facturilor.`);
    } catch (e: any) {
      alert('Eroare la emiterea facturilor pe zonă: ' + e.message);
    } finally {
      setGeneratingZoneKey(null);
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
      const filename = `Factura_${order.assignedInvoiceNumber}.pdf`;

      const res = await api.system.openPdfFile(filename, order.issuerCode || order.issuerSettings?.code);
      if (res.notFound) {
        await generatePdfForOrder(order, true);
        await api.system.openPdfFile(filename, order.issuerCode || order.issuerSettings?.code);
      }
    } catch (e: any) {
      alert('Eroare la deschiderea PDF: ' + e.message);
    } finally {
      setGeneratingOrderId(null);
    }
  };

  const handleDeleteInvoice = async (order: any) => {
    if (!order.assignedInvoiceNumber) return;
    setPendingOrderAction(order);
  };

  const confirmOrderInvoiceAction = async (value: string) => {
    const order = pendingOrderAction;
    if (!order?.assignedInvoiceNumber) return;
    if (testMode) {
      try {
        const allInvoices = await api.billing.getInvoices();
        const inv = allInvoices.find((item: any) => item.invoice_number === order.assignedInvoiceNumber);
        if (!inv) throw new Error('Factura nu a fost găsită.');
        const result = await api.billing.deleteTestInvoice(inv.id, value);
        setSyncResult((previous: any) => ({
          ...previous,
          ordersByStore: previous.ordersByStore.map((item: any) => item.store.id === order.store.id
            ? { ...item, billingState: 'ready', assignedInvoiceId: null, assignedInvoiceNumber: null, assignedInvoiceDate: null }
            : item),
        }));
        setPendingOrderAction(null);
        const dependencies = [
          result.deletedPayments ? `${result.deletedPayments} încasări` : '',
          result.deletedCreditNotes ? `${result.deletedCreditNotes} Credit Notes` : '',
          result.deletedCreditApplications ? `${result.deletedCreditApplications} aplicări de credit` : '',
          result.removedReplacementLinks ? `${result.removedReplacementLinks} legături de reemitere` : '',
        ].filter(Boolean).join(', ');
        alert(`Factura de test #${order.assignedInvoiceNumber} și toate dependențele ei au fost șterse definitiv.${dependencies ? ` Au fost eliminate: ${dependencies}.` : ''}`);
      } catch (error: any) {
        throw new Error('Eroare la ștergerea facturii de test: ' + error.message);
      }
      return;
    }
    try {
      const allInvoices = await api.billing.getInvoices();
      const inv = allInvoices.find((item: any) => item.invoice_number === order.assignedInvoiceNumber);
      if (!inv) throw new Error('Factura nu a fost găsită.');
      await api.billing.cancelInvoice(inv.id, value);

      setSyncResult((previous: any) => ({
        ...previous,
        ordersByStore: previous.ordersByStore.map((item: any) => item.store.id === order.store.id ? { ...item, billingState: 'cancelled' } : item),
      }));

      setPendingOrderAction(null);
      alert(`Factura #${order.assignedInvoiceNumber} a fost anulată și păstrată în registru. Anularea nu înlocuiește o notă de credit VAT.`);
    } catch (error: any) {
      throw new Error('Eroare la anulare: ' + error.message);
    }
  };

  const zoneSummaries = buildZoneSummaries(syncResult);
  const selectedZone = zoneSummaries.find((zone: any) => zone.key === selectedZoneKey);
  const displayedOrders = selectedZoneKey === 'all'
    ? syncResult?.ordersByStore || []
    : (syncResult?.ordersByStore || []).filter((order: any) => orderZoneKey(order) === selectedZoneKey);
  const isBatchGenerating = isGeneratingAll || generatingZoneKey !== null;

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
          disabled={isSyncing || isBatchGenerating}
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
            disabled={isBatchGenerating}
            className="px-4 py-2 text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
          >
            Săptămâna Curentă
          </button>

          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-sm">
            <button
              onClick={handlePrevWeek}
              disabled={isBatchGenerating}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors"
              title="Săptămâna anterioară"
            >
              <ChevronLeft size={18} />
            </button>

            <div className="relative flex items-center px-3 py-1">
              <DatePicker
                selected={selectedDate}
                disabled={isBatchGenerating}
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
              disabled={isBatchGenerating}
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
                <div className="flex flex-wrap gap-2 ml-4">
                  {Object.values(syncResult.ordersByStore.reduce((groups: any, order: any) => {
                    const key = order.issuerId || 'unknown';
                    groups[key] ||= { name: order.issuerName || 'Emitent neconfigurat', color: order.issuerColor || '#64748B', count: 0 };
                    groups[key].count += 1;
                    return groups;
                  }, {})).map((group: any) => <span key={group.name} className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: group.color }}>{group.name}: {group.count}</span>)}
                </div>

                <button
                  onClick={handleGenerateAll}
                  disabled={isBatchGenerating || syncResult.ordersByStore.every((o: any) => o.billingState !== 'ready')}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-2 text-sm"
                >
                  {isGeneratingAll ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                  Generează Toate Facturile
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-5 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
                  <div>
                    <h3 className="font-bold text-slate-900 flex items-center gap-2"><MapPin size={18} className="text-indigo-600" /> Facturare pe zone</h3>
                    <p className="text-xs text-slate-500 mt-1">Selectează o zonă pentru a vedea magazinele și a emite numai facturile pregătite din acea rută.</p>
                  </div>
                  {selectedZone && <button
                    onClick={() => handleGenerateZone(selectedZone)}
                    disabled={isBatchGenerating || selectedZone.readyCount === 0}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-2 text-sm self-start lg:self-auto"
                  >
                    {generatingZoneKey === selectedZone.key ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                    Generează facturile zonei ({selectedZone.readyCount})
                  </button>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  <button
                    onClick={() => setSelectedZoneKey('all')}
                    className={`text-left rounded-xl border p-3 transition-colors ${selectedZoneKey === 'all' ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className="font-bold text-sm text-slate-900">TOATE ZONELE</div>
                    <div className="text-xs text-slate-500 mt-1">{syncResult.ordersByStore.length} magazine</div>
                  </button>
                  {zoneSummaries.map((zone: any) => <button
                    key={zone.key}
                    onClick={() => setSelectedZoneKey(zone.key)}
                    className={`text-left rounded-xl border p-3 transition-colors ${selectedZoneKey === zone.key ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900 flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: zone.color || '#64748B' }} />{zone.name}</span>
                      <span className="text-xs font-semibold text-indigo-700">£{zone.total.toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Truck size={13} />{zone.driver?.name || 'Șofer nealocat'}</div>
                    <div className="text-xs text-slate-600 mt-2">{zone.storeCount} magazine · {zone.readyCount} pregătite · {zone.generatedCount} generate</div>
                  </button>)}
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {displayedOrders.map((data: any, idx: number) => {
                  const total = data.items.reduce((acc: number, item: any) => acc + item.totalPrice, 0);
                  const isGenerated = data.billingState === 'invoiced';
                  const isDoing = generatingOrderId === data.store.id;
                  
                  return (
                    <div key={idx} className={`bg-white p-4 rounded-xl border shadow-sm ${isGenerated ? 'border-emerald-500' : 'border-slate-200'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-bold text-slate-800 flex items-center gap-2">
                            {data.store.name}
                            {isGenerated && <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-medium">{data.assignedInvoiceNumber}</span>}
                          </div>
                          <div className="mb-2"><span className="inline-flex text-xs font-semibold text-white px-2 py-1 rounded-full" style={{ backgroundColor: data.issuerColor || '#64748B' }}>{data.issuerName || 'Emitent neconfigurat'}{data.billingState === 'ready' && data.estimatedInvoiceReference ? ` · ${data.estimatedInvoiceReference}` : ''}</span></div>
                          <div className="text-sm text-slate-600 mb-2 flex items-center gap-1.5 flex-wrap">
                            <Building2 size={14} className="text-indigo-500" />
                            <span className="font-medium text-slate-800">{data.store.company?.name || 'Companie neasociată'}</span>
                          </div>
                          <div className="font-semibold text-slate-700 border-t border-slate-100 pt-2 mt-2">
                            Total calculat: £{total.toFixed(2)}
                          </div>
                          {data.billingState === 'source_changed' && <div className="mt-2 text-xs font-semibold text-amber-700">Sursa s-a modificat după emitere — verificare manuală necesară.</div>}
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {isGenerated ? (
                            <button
                              onClick={() => handleOpenPdf(data)}
                              disabled={isDoing || isBatchGenerating}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-slate-100 hover:bg-slate-200 text-slate-700"
                              title="Deschide PDF-ul facturii"
                            >
                              {isDoing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                              Deschide PDF
                            </button>
                          ) : data.billingState === 'ready' ? (
                            <button
                              onClick={() => handleGenerateIndividual(data)}
                              disabled={isDoing || isBatchGenerating}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-indigo-50 hover:bg-indigo-100 text-indigo-700"
                            >
                              {isDoing ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                              Generează
                            </button>
                          ) : (
                            <span className="text-xs font-semibold text-amber-700">{data.billingState === 'cancelled' ? 'Anulată · reemite din Facturi' : 'Necesită verificare'}</span>
                          )}

                          {isGenerated && (
                            <button
                              onClick={() => handleDeleteInvoice(data)}
                              disabled={isBatchGenerating}
                              className={`p-2 rounded-lg transition-colors ${testMode ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`}
                              title={testMode ? 'Șterge definitiv factura de test' : 'Anulează factura și păstrează numărul în registru'}
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
              {displayedOrders.length === 0 && <div className="bg-slate-50 border border-dashed border-slate-300 text-slate-500 text-sm text-center rounded-xl p-8">Zona selectată nu are magazine cu comenzi pentru această săptămână.</div>}
            </div>
          )}
        </div>
      )}
      {pendingOrderAction && <TextConfirmationModal
        title={testMode ? `Șterge definitiv factura #${pendingOrderAction.assignedInvoiceNumber}` : `Anulează factura #${pendingOrderAction.assignedInvoiceNumber}`}
        description={testMode ? 'Se va crea o copie de siguranță, apoi vor fi șterse tranzacțional factura și toate dependențele ei: încasări, Credit Notes, aplicări de credit și legături de reemitere.' : `Factura pentru ${pendingOrderAction.store.name} rămâne în registru cu status anulat.`}
        fieldLabel={testMode ? 'Confirmare' : 'Motivul anulării'}
        confirmLabel={testMode ? 'Șterge definitiv' : 'Anulează factura'}
        expectedText={testMode ? `STERGE ${pendingOrderAction.assignedInvoiceNumber}` : undefined}
        dangerous
        onCancel={() => setPendingOrderAction(null)}
        onConfirm={confirmOrderInvoiceAction}
      />}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { 
  Receipt, Search, Calendar, Edit3, Trash2, Printer, X, Plus, Save, 
  CheckCircle2, Clock, AlertCircle, Building2, Store, FileText, Loader2 
} from 'lucide-react';
import { api } from '../shared/api';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';
import { generateInvoicePDF } from '../utils/pdfGenerator';

interface InvoiceItem {
  id?: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface Invoice {
  id: number;
  store_id: number;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  paid_amount: number;
  status: string;
  store_name?: string;
  store_address?: string;
  company_name?: string;
  company_cui?: string;
  company_reg_com?: string;
  company_address?: string;
  company_bank_account?: string;
  company_bank_name?: string;
  client_name?: string;
  items?: InvoiceItem[];
}

export function BillingInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  // Date filter (opțional, default toate sau ultimele 30 zile)
  const [useDateFilter, setUseDateFilter] = useState(false);
  const [startDate, setStartDate] = useState<Date>(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = useState<Date>(new Date());

  // Modal editare
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editForm, setEditForm] = useState<{
    invoice_number: string;
    invoice_date: string;
    paid_amount: number;
    status: string;
    items: InvoiceItem[];
  }>({
    invoice_number: '',
    invoice_date: '',
    paid_amount: 0,
    status: 'unpaid',
    items: []
  });

  const [isSaving, setIsSaving] = useState(false);
  const [generatingPdfId, setGeneratingPdfId] = useState<number | null>(null);

  useEffect(() => {
    loadInvoices();
  }, [useDateFilter, startDate, endDate]);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      let startStr: string | undefined = undefined;
      let endStr: string | undefined = undefined;

      if (useDateFilter) {
        startStr = format(startDate, 'yyyy-MM-dd');
        endStr = format(endDate, 'yyyy-MM-dd');
      }

      const data = await api.billing.getInvoices(startStr, endStr);
      setInvoices(data || []);
    } catch (e) {
      console.error('Eroare la încărcarea facturilor:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteInvoice = async (inv: Invoice) => {
    if (window.confirm(`Ești sigur că dorești să ștergi definitiv factura FACT #${inv.invoice_number} emisiune ${inv.store_name || ''}?`)) {
      try {
        const settings = await api.billing.getSettings();
        const series = settings.invoiceSeries || 'FACT';
        const filename = `Factura_${series}_${inv.invoice_number}.pdf`;

        // 1. Ștergem din baza de date
        await api.billing.deleteInvoice(inv.id);

        // 2. Ștergem fișierul PDF de pe calculator și din Google Drive
        await api.system.deletePdfAuto(filename);

        setInvoices(prev => prev.filter(i => i.id !== inv.id));
        alert(`Factura #${inv.invoice_number} și fișierul ei PDF au fost șterse din calculator și din Google Drive!`);
      } catch (e: any) {
        alert('Eroare la ștergerea facturii: ' + e.message);
      }
    }
  };

  const handleOpenEdit = (inv: Invoice) => {
    setEditingInvoice(inv);
    setEditForm({
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      paid_amount: inv.paid_amount || 0,
      status: inv.status || 'unpaid',
      items: inv.items ? JSON.parse(JSON.stringify(inv.items)) : []
    });
  };

  const handleItemChange = (index: number, field: keyof InvoiceItem, value: any) => {
    const newItems = [...editForm.items];
    const item = { ...newItems[index] };
    
    if (field === 'quantity') {
      item.quantity = parseFloat(value) || 0;
      item.totalPrice = item.quantity * item.unitPrice;
    } else if (field === 'unitPrice') {
      item.unitPrice = parseFloat(value) || 0;
      item.totalPrice = item.quantity * item.unitPrice;
    } else if (field === 'productName') {
      item.productName = value;
    }
    
    newItems[index] = item;
    setEditForm(prev => ({ ...prev, items: newItems }));
  };

  const handleAddItem = () => {
    setEditForm(prev => ({
      ...prev,
      items: [
        ...prev.items,
        { productName: 'Produs nou', quantity: 1, unitPrice: 0, totalPrice: 0 }
      ]
    }));
  };

  const handleRemoveItem = (index: number) => {
    setEditForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const calculatedTotalAmount = editForm.items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);

  const handleSaveEdit = async () => {
    if (!editingInvoice) return;
    if (!editForm.invoice_number.trim()) {
      alert('Te rugăm să introduci numărul facturii!');
      return;
    }

    setIsSaving(true);
    try {
      await api.billing.updateInvoice({
        id: editingInvoice.id,
        invoiceNumber: editForm.invoice_number.trim(),
        invoiceDate: editForm.invoice_date,
        totalAmount: calculatedTotalAmount,
        paidAmount: editForm.paid_amount,
        status: editForm.status,
        items: editForm.items
      });

      // Re-generăm și suprascriem PDF-ul cu datele actualizate
      const updatedInv = {
        ...editingInvoice,
        invoice_number: editForm.invoice_number.trim(),
        invoice_date: editForm.invoice_date,
        total_amount: calculatedTotalAmount,
        paid_amount: editForm.paid_amount,
        status: editForm.status,
        items: editForm.items
      };
      await handlePrintPdf(updatedInv, true);

      alert('Factura a fost modificată și fișierul PDF a fost actualizat pe disk & Google Drive!');
      setEditingInvoice(null);
      await loadInvoices();
    } catch (e: any) {
      alert('Eroare la salvarea modificărilor: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrintPdf = async (inv: Invoice, isQuiet = false) => {
    setGeneratingPdfId(inv.id);
    try {
      const settings = await api.billing.getSettings();
      const pdfData = {
        invoiceNumber: inv.invoice_number,
        invoiceDate: inv.invoice_date,
        client: {
          name: inv.company_name || inv.client_name || inv.store_name || 'Client',
          cui: inv.company_cui,
          regCom: inv.company_reg_com,
          address: inv.company_address || inv.store_address,
          county: '',
          city: ''
        },
        store: {
          name: inv.store_name || '',
          address: inv.store_address || '',
        },
        items: inv.items || [],
        totalAmount: inv.total_amount
      };

      const buffer = generateInvoicePDF(settings, pdfData);
      const filename = `Factura_${settings.invoiceSeries || 'FACT'}_${inv.invoice_number}.pdf`;

      await api.system.savePdfAuto({ buffer, filename });
      api.system.uploadPdfToCloud(filename, buffer).catch(console.error);

      if (!isQuiet) {
        alert(`Factura #${inv.invoice_number} a fost actualizată pe calculator și în Google Drive!`);
      }
    } catch (e: any) {
      if (!isQuiet) alert('Eroare la generarea PDF: ' + e.message);
    } finally {
      setGeneratingPdfId(null);
    }
  };

  const handleOpenPdf = async (inv: Invoice) => {
    setGeneratingPdfId(inv.id);
    try {
      const settings = await api.billing.getSettings();
      const series = settings.invoiceSeries || 'FACT';
      const filename = `Factura_${series}_${inv.invoice_number}.pdf`;

      // Încercăm deschiderea directă a fișierului
      const res = await api.system.openPdfFile(filename);

      // Dacă fișierul nu există local, îl re-creăm și îl deschidem
      if (res.notFound) {
        await handlePrintPdf(inv, true);
        await api.system.openPdfFile(filename);
      }
    } catch (e: any) {
      alert('Eroare la deschiderea PDF: ' + e.message);
    } finally {
      setGeneratingPdfId(null);
    }
  };

  // Filtrare locală după text și status
  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = 
      inv.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (inv.store_name && inv.store_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (inv.company_name && inv.company_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (inv.client_name && inv.client_name.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
              <Receipt size={22} />
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Facturi Emise</h1>
          </div>
          <p className="text-slate-500 mt-2">Evidența tuturor facturilor generate, posibilitate de modificare, ștergere și retipărire PDF.</p>
        </div>
      </div>

      {/* Controale de căutare & filtrare */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Căutare */}
          <div className="relative flex-1 min-w-[280px]">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Caută după nr. factură, magazin, firmă sau client..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Filtru status */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-500">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-700 font-medium px-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
            >
              <option value="all">Toate facturile</option>
              <option value="unpaid">Neachitate</option>
              <option value="paid">Achitate integral</option>
              <option value="partial">Achitate parțial</option>
            </select>
          </div>
        </div>

        {/* Filtrare pe perioadă opțională */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={useDateFilter}
                onChange={(e) => setUseDateFilter(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
              />
              Filtrează după interval calendaristic
            </label>
          </div>

          {useDateFilter && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">De la:</span>
                <DatePicker
                  selected={startDate}
                  onChange={(d) => d && setStartDate(d)}
                  dateFormat="dd/MM/yyyy"
                  locale={ro}
                  className="w-32 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Până la:</span>
                <DatePicker
                  selected={endDate}
                  onChange={(d) => d && setEndDate(d)}
                  dateFormat="dd/MM/yyyy"
                  locale={ro}
                  className="w-32 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabel cu facturi */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 flex items-center justify-center gap-3">
            <Loader2 size={24} className="animate-spin text-indigo-600" />
            <span>Se încarcă facturile...</span>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <FileText size={48} className="mx-auto mb-4 text-slate-300" />
            <p className="text-lg font-medium text-slate-700">Nu am găsit nicio factură.</p>
            <p className="text-sm mt-1">Poți genera facturi noi din secțiunea <strong>Comenzi</strong>.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-4 px-6">Factură</th>
                  <th className="py-4 px-6">Data</th>
                  <th className="py-4 px-6">Magazin & Companie</th>
                  <th className="py-4 px-6">Valoare Totală</th>
                  <th className="py-4 px-6">Status Plată</th>
                  <th className="py-4 px-6 text-right">Acțiuni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredInvoices.map((inv) => {
                  const isPaid = inv.status === 'paid';
                  const isPartial = inv.status === 'partial';

                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-4 px-6 font-bold text-slate-900">
                        FACT #{inv.invoice_number}
                      </td>
                      <td className="py-4 px-6 text-slate-600">
                        {inv.invoice_date}
                      </td>
                      <td className="py-4 px-6">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <Store size={14} className="text-indigo-600" />
                          {inv.store_name}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                          <Building2 size={12} className="text-slate-400" />
                          {inv.company_name} {inv.company_cui ? `(CUI: ${inv.company_cui})` : ''}
                        </div>
                      </td>
                      <td className="py-4 px-6 font-bold text-slate-900">
                        £{inv.total_amount.toFixed(2)}
                      </td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                          isPaid
                            ? 'bg-emerald-100 text-emerald-800'
                            : isPartial
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}>
                          {isPaid ? <CheckCircle2 size={13} /> : isPartial ? <Clock size={13} /> : <AlertCircle size={13} />}
                          {isPaid ? 'Achitat' : isPartial ? `Parțial (£${inv.paid_amount.toFixed(2)})` : 'Neachitat'}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Deschide PDF */}
                          <button
                            onClick={() => handleOpenPdf(inv)}
                            disabled={generatingPdfId === inv.id}
                            className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-1.5"
                            title="Deschide PDF-ul facturii"
                          >
                            {generatingPdfId === inv.id ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                            <span className="text-xs font-semibold">Deschide PDF</span>
                          </button>

                          {/* Editează */}
                          <button
                            onClick={() => handleOpenEdit(inv)}
                            className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Editează detaliile facturii"
                          >
                            <Edit3 size={16} />
                          </button>

                          {/* Șterge */}
                          <button
                            onClick={() => handleDeleteInvoice(inv)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Șterge factura"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Editare Factură */}
      {editingInvoice && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col">
            {/* Header Modal */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-2xl">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Modificare Factură #{editingInvoice.invoice_number}</h3>
                <p className="text-sm text-slate-500 mt-0.5">{editingInvoice.store_name} - {editingInvoice.company_name}</p>
              </div>
              <button
                onClick={() => setEditingInvoice(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Corp Modal */}
            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1.5">Număr Factură</label>
                  <input
                    type="text"
                    value={editForm.invoice_number}
                    onChange={(e) => setEditForm({ ...editForm, invoice_number: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1.5">Data Emiterii</label>
                  <input
                    type="date"
                    value={editForm.invoice_date}
                    onChange={(e) => setEditForm({ ...editForm, invoice_date: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1.5">Status Plată</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="unpaid">Neachitat</option>
                    <option value="paid">Achitat integral</option>
                    <option value="partial">Achitat parțial</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1.5">Suma Plătită (£)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.paid_amount}
                    onChange={(e) => setEditForm({ ...editForm, paid_amount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Articole din Factură */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-slate-800">Produse / Pozitii Factură</h4>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Plus size={14} /> Adaugă Produs
                  </button>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                        <th className="py-2.5 px-3">Denumire Produs</th>
                        <th className="py-2.5 px-3 w-24">Cantitate</th>
                        <th className="py-2.5 px-3 w-28">Preț unitar</th>
                        <th className="py-2.5 px-3 w-28">Total</th>
                        <th className="py-2.5 px-2 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editForm.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.productName}
                              onChange={(e) => handleItemChange(idx, 'productName', e.target.value)}
                              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-slate-800"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="0.01"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-slate-800 font-mono"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) => handleItemChange(idx, 'unitPrice', e.target.value)}
                              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-slate-800 font-mono"
                            />
                          </td>
                          <td className="p-2 font-bold text-slate-900 font-mono">
                            £{item.totalPrice.toFixed(2)}
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              className="text-slate-400 hover:text-rose-600 p-1"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 flex justify-between items-center">
                  <span className="font-semibold text-slate-700">Total Calculat Factură:</span>
                  <span className="text-xl font-bold text-indigo-700 font-mono">£{calculatedTotalAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Footer Modal */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingInvoice(null)}
                className="px-5 py-2.5 border border-slate-200 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Anulează
              </button>

              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-6 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
              >
                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {isSaving ? 'Se salvează...' : 'Salvează Modificările'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

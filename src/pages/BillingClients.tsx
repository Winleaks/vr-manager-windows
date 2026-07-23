import React, { useState, useEffect } from 'react';
import { api } from '../shared/api';
import { 
  Building2, Store, RefreshCw, AlertCircle, FileText, ArrowLeft, 
  DollarSign, CheckCircle2, Clock, PlusCircle, CreditCard, Banknote, 
  ChevronRight, Printer, AlertTriangle, ShieldCheck, Info, Loader2, Search, X
} from 'lucide-react';
import { generateInvoicePDF } from '../utils/pdfGenerator';

interface Company {
  id: number;
  name: string;
  cui?: string;
  reg_com?: string;
  address?: string;
  bank_account?: string;
  bank_name?: string;
  credit_balance?: number;
  stores?: any[];
  unpaidInvoicesCount?: number;
  unpaidTotal?: number;
}

export function BillingClients() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Profil companie selectat
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [profileData, setProfileData] = useState<any | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [activeTab, setActiveTab] = useState<'unpaid' | 'all' | 'payments' | 'stores'>('unpaid');

  // Modal Încasare
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<any | null>(null);
  const [paymentForm, setPaymentForm] = useState<{
    amount: string;
    method: 'cash' | 'transfer';
    bankName: 'Barclays' | 'Virgin';
    paymentDate: string;
    notes: string;
  }>({
    amount: '',
    method: 'cash',
    bankName: 'Barclays',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: ''
  });
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [generatingPdfId, setGeneratingPdfId] = useState<number | null>(null);

  useEffect(() => {
    fetchCompanies();
  }, []);

  useEffect(() => {
    if (selectedCompanyId) {
      loadCompanyProfile(selectedCompanyId);
    } else {
      setProfileData(null);
    }
  }, [selectedCompanyId]);

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

  const loadCompanyProfile = async (companyId: number) => {
    try {
      setLoadingProfile(true);
      const data = await api.billing.getCompanyProfile(companyId);
      setProfileData(data);
    } catch (e) {
      console.error('Eroare încărcare profil companie:', e);
    } finally {
      setLoadingProfile(false);
    }
  };

  const handleSyncWithServer = async () => {
    try {
      setSyncing(true);
      await api.billing.syncEntities();
      await fetchCompanies();
      if (selectedCompanyId) {
        await loadCompanyProfile(selectedCompanyId);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenPaymentModal = (invoice: any = null) => {
    setSelectedInvoiceForPayment(invoice);
    const initialAmount = invoice ? (invoice.total_amount - invoice.paid_amount).toFixed(2) : '';
    setPaymentForm({
      amount: initialAmount,
      method: 'cash',
      bankName: 'Barclays',
      paymentDate: new Date().toISOString().split('T')[0],
      notes: invoice ? `Încasare factura FACT #${invoice.invoice_number}` : ''
    });
    setShowPaymentModal(true);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileData?.company?.id) return;

    const numericAmount = parseFloat(paymentForm.amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      alert('Te rugăm să introduci o sumă validă mai mare decât 0!');
      return;
    }

    if (paymentForm.method === 'transfer' && !paymentForm.bankName) {
      alert('Te rugăm să selectezi banca unde s-a primit transferul bancar (Barclays sau Virgin)!');
      return;
    }

    setIsSubmittingPayment(true);
    try {
      await api.billing.recordCompanyPayment({
        companyId: profileData.company.id,
        invoiceId: selectedInvoiceForPayment ? selectedInvoiceForPayment.id : undefined,
        amount: numericAmount,
        paymentDate: paymentForm.paymentDate,
        method: paymentForm.method,
        bankName: paymentForm.method === 'transfer' ? paymentForm.bankName : undefined,
        notes: paymentForm.notes.trim()
      });

      alert('Plata a fost înregistrată cu succes!');
      setShowPaymentModal(false);
      await loadCompanyProfile(profileData.company.id);
      await fetchCompanies();
    } catch (err: any) {
      alert('Eroare la procesarea plății: ' + err.message);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handlePrintPdf = async (inv: any) => {
    setGeneratingPdfId(inv.id);
    try {
      const settings = await api.billing.getSettings();
      const pdfData = {
        invoiceNumber: inv.invoice_number,
        invoiceDate: inv.invoice_date,
        client: {
          name: profileData?.company?.name || inv.store_name || 'Client',
          cui: profileData?.company?.cui,
          regCom: profileData?.company?.reg_com,
          address: profileData?.company?.address,
          county: '',
          city: ''
        },
        store: {
          name: inv.store_name || '',
          address: '',
        },
        items: inv.items || [],
        totalAmount: inv.total_amount
      };

      const buffer = generateInvoicePDF(settings, pdfData);
      const filename = `Factura_${settings.invoiceSeries || 'FACT'}_${inv.invoice_number}.pdf`;

      await api.system.savePdfAuto({ buffer, filename });
      api.system.uploadPdfToCloud(filename, buffer).catch(console.error);
      alert(`Factura #${inv.invoice_number} a fost salvată pe calculator și în Google Drive!`);
    } catch (e: any) {
      alert('Eroare la generarea PDF: ' + e.message);
    } finally {
      setGeneratingPdfId(null);
    }
  };

  const filteredCompanies = companies.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.cui && c.cui.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (c.reg_com && c.reg_com.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // --- VIZUALIZARE 1: PROFIL COMPANIE ---
  if (selectedCompanyId && profileData) {
    const { company, stores, invoices, unpaidInvoices, payments, stats } = profileData;

    return (
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        {/* Header Profil Companie */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <button
              onClick={() => setSelectedCompanyId(null)}
              className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-medium mb-3 transition-colors text-sm"
            >
              <ArrowLeft size={16} /> Înapoi la lista de clienți
            </button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-bold text-xl shadow-md shadow-indigo-600/20">
                <Building2 size={24} />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-900">{company.name}</h1>
                <div className="flex items-center gap-4 text-sm text-slate-500 mt-1 flex-wrap">
                  {company.cui && <span>VAT No: <span className="font-semibold text-slate-800">{company.cui}</span></span>}
                  {company.reg_com && <span>CRN: <span className="font-semibold text-slate-800">{company.reg_com}</span></span>}
                  <span>{stores.length} magazine arondate</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => handleOpenPaymentModal(null)}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold transition-colors shadow-md shadow-emerald-600/20"
            >
              <PlusCircle size={20} />
              Înregistrează Încasare Plată
            </button>
          </div>
        </div>

        {/* Carduri Sumar Financiar Companie */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Facturat</span>
            <div className="text-2xl font-bold text-slate-900 mt-2">£{stats.totalInvoiced.toFixed(2)}</div>
            <span className="text-xs text-slate-400 mt-2">{invoices.length} facturi emise</span>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Încasat</span>
            <div className="text-2xl font-bold text-emerald-600 mt-2">£{stats.totalPaid.toFixed(2)}</div>
            <span className="text-xs text-slate-400 mt-2">{payments.length} plăti înregistrate</span>
          </div>

          <div className={`p-6 rounded-2xl border shadow-sm flex flex-col justify-between ${
            stats.totalUnpaid > 0 ? 'bg-rose-50/50 border-rose-200' : 'bg-white border-slate-200'
          }`}>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Restanță Totală Curentă</span>
            <div className={`text-2xl font-bold mt-2 ${stats.totalUnpaid > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
              £{stats.totalUnpaid.toFixed(2)}
            </div>
            <span className="text-xs text-slate-500 mt-2">{unpaidInvoices.length} facturi neachitate</span>
          </div>

          <div className={`p-6 rounded-2xl border shadow-sm flex flex-col justify-between ${
            stats.creditBalance > 0 ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">Sold Credit / Avans</span>
              <ShieldCheck size={16} className="text-indigo-600" />
            </div>
            <div className="text-2xl font-bold text-indigo-700 mt-2">£{stats.creditBalance.toFixed(2)}</div>
            <span className="text-xs text-indigo-600 mt-2 font-medium">
              {stats.creditBalance > 0 ? 'Disponibil pentru facturi viitoare' : 'Niciun avans existent'}
            </span>
          </div>
        </div>

        {/* Tab-uri Navigare Profil */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 flex items-center gap-6 overflow-x-auto">
            <button
              onClick={() => setActiveTab('unpaid')}
              className={`py-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'unpaid'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <AlertCircle size={18} />
              Facturi Restante ({unpaidInvoices.length})
            </button>

            <button
              onClick={() => setActiveTab('all')}
              className={`py-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'all'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileText size={18} />
              Toate Facturile ({invoices.length})
            </button>

            <button
              onClick={() => setActiveTab('payments')}
              className={`py-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'payments'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Banknote size={18} />
              Istoric Încasări ({payments.length})
            </button>

            <button
              onClick={() => setActiveTab('stores')}
              className={`py-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'stores'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Store size={18} />
              Magazine Arondate ({stores.length})
            </button>
          </div>

          <div className="p-6">
            {/* TAB 1: FACTURI RESTANTE */}
            {activeTab === 'unpaid' && (
              <div>
                {unpaidInvoices.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
                    <p className="font-bold text-slate-800 text-lg">Felicitări! Toate facturile acestei companii sunt achitate complet.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200">
                          <th className="py-3 px-4">Factură</th>
                          <th className="py-3 px-4">Data Emiterii</th>
                          <th className="py-3 px-4">Magazin</th>
                          <th className="py-3 px-4">Total Factură</th>
                          <th className="py-3 px-4">Achitat</th>
                          <th className="py-3 px-4 text-rose-600 font-bold">Rest de Plată</th>
                          <th className="py-3 px-4 text-right">Acțiune</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {unpaidInvoices.map((inv: any) => {
                          const due = inv.total_amount - inv.paid_amount;
                          return (
                            <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-3.5 px-4 font-bold text-slate-900">FACT #{inv.invoice_number}</td>
                              <td className="py-3.5 px-4 text-slate-600">{inv.invoice_date}</td>
                              <td className="py-3.5 px-4 font-semibold text-slate-800">{inv.store_name}</td>
                              <td className="py-3.5 px-4 font-medium">£{inv.total_amount.toFixed(2)}</td>
                              <td className="py-3.5 px-4 text-emerald-600 font-semibold">£{inv.paid_amount.toFixed(2)}</td>
                              <td className="py-3.5 px-4 font-bold text-rose-600">£{due.toFixed(2)}</td>
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  onClick={() => handleOpenPaymentModal(inv)}
                                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3.5 py-1.5 rounded-lg font-semibold text-xs transition-colors"
                                >
                                  Încasează această factură
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: TOATE FACTURILE */}
            {activeTab === 'all' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200">
                      <th className="py-3 px-4">Factură</th>
                      <th className="py-3 px-4">Data Emiterii</th>
                      <th className="py-3 px-4">Magazin</th>
                      <th className="py-3 px-4">Valoare Totală</th>
                      <th className="py-3 px-4">Status Plată</th>
                      <th className="py-3 px-4 text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {invoices.map((inv: any) => {
                      const isPaid = inv.status === 'paid';
                      const isPartial = inv.status === 'partial';

                      return (
                        <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-slate-900">FACT #{inv.invoice_number}</td>
                          <td className="py-3.5 px-4 text-slate-600">{inv.invoice_date}</td>
                          <td className="py-3.5 px-4 font-semibold text-slate-800">{inv.store_name}</td>
                          <td className="py-3.5 px-4 font-bold">£{inv.total_amount.toFixed(2)}</td>
                          <td className="py-3.5 px-4">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              isPaid ? 'bg-emerald-100 text-emerald-800' : isPartial ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {isPaid ? 'Achitat' : isPartial ? `Parțial (£${inv.paid_amount.toFixed(2)})` : 'Neachitat'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={() => handlePrintPdf(inv)}
                              disabled={generatingPdfId === inv.id}
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                              title="Descarcă PDF"
                            >
                              {generatingPdfId === inv.id ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 3: ISTORIC ÎNCASĂRI */}
            {activeTab === 'payments' && (
              <div>
                {payments.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 italic">Nu există nicio plată înregistrată încă pentru această companie.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200">
                          <th className="py-3 px-4">Data Plății</th>
                          <th className="py-3 px-4">Suma Încasată</th>
                          <th className="py-3 px-4">Metodă Plată</th>
                          <th className="py-3 px-4">Bancă</th>
                          <th className="py-3 px-4">Factură Aferentă</th>
                          <th className="py-3 px-4">Note / Detalii</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {payments.map((p: any) => (
                          <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3.5 px-4 font-semibold text-slate-700">{p.payment_date}</td>
                            <td className="py-3.5 px-4 font-bold text-emerald-600">£{p.amount.toFixed(2)}</td>
                            <td className="py-3.5 px-4">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold ${
                                p.method === 'cash' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'
                              }`}>
                                {p.method === 'cash' ? <Banknote size={12} /> : <CreditCard size={12} />}
                                {p.method === 'cash' ? 'Cash' : 'Transfer Bancar'}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-slate-800">
                              {p.bank_name ? (
                                <span className="bg-slate-100 px-2 py-0.5 rounded text-xs text-slate-700 border border-slate-200">
                                  {p.bank_name}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="py-3.5 px-4 font-medium text-slate-800">
                              {p.invoice_number ? `FACT #${p.invoice_number}` : <span className="text-indigo-600 font-bold">Avans / Credit Companie</span>}
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-500 italic">{p.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: MAGAZINE ARONDATE */}
            {activeTab === 'stores' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stores.map((s: any) => (
                  <div key={s.id} className="p-4 border border-slate-200 rounded-xl bg-slate-50/50 flex items-start gap-3">
                    <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                      <Store size={18} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900">{s.name}</h4>
                      {s.address && <p className="text-xs text-slate-500 mt-1">{s.address}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* MODAL ÎNCASARE PLATĂ */}
        {showPaymentModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-emerald-100 text-emerald-700 rounded-lg flex items-center justify-center font-bold">
                    <DollarSign size={18} />
                  </div>
                  <h3 className="font-bold text-slate-900 text-lg">Înregistrează Plată / Încasare</h3>
                </div>
                <button onClick={() => setShowPaymentModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmitPayment} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Companie</label>
                  <div className="w-full px-3.5 py-2 bg-slate-100 border border-slate-200 rounded-xl font-bold text-slate-800">
                    {company.name}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Factură Vizată (Opțional)</label>
                  <select
                    value={selectedInvoiceForPayment ? selectedInvoiceForPayment.id : ''}
                    onChange={(e) => {
                      const id = parseInt(e.target.value);
                      const inv = unpaidInvoices.find((i: any) => i.id === id) || null;
                      setSelectedInvoiceForPayment(inv);
                      if (inv) {
                        setPaymentForm(prev => ({ ...prev, amount: (inv.total_amount - inv.paid_amount).toFixed(2) }));
                      }
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800"
                  >
                    <option value="">-- Distribuire automată pe cea mai veche factură neachitată --</option>
                    {unpaidInvoices.map((inv: any) => (
                      <option key={inv.id} value={inv.id}>
                        FACT #{inv.invoice_number} ({inv.store_name}) — Restanță: £{(inv.total_amount - inv.paid_amount).toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Suma Încasată (£)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 text-lg font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                {/* Selecție Metodă Plată */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1.5">Metodă Plată (Obligatoriu)</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentForm({ ...paymentForm, method: 'cash' })}
                      className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-bold transition-all ${
                        paymentForm.method === 'cash'
                          ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/20'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <Banknote size={18} /> Cash (Numerar)
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentForm({ ...paymentForm, method: 'transfer' })}
                      className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-bold transition-all ${
                        paymentForm.method === 'transfer'
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <CreditCard size={18} /> Transfer Bancar
                    </button>
                  </div>
                </div>

                {/* Selecție Bancă - Activ doar dacă metoda este Transfer Bancar */}
                {paymentForm.method === 'transfer' && (
                  <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-2">
                    <label className="block text-xs font-bold text-indigo-900 uppercase">Selectează Banca (Obligatoriu)</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPaymentForm({ ...paymentForm, bankName: 'Barclays' })}
                        className={`p-2.5 rounded-lg border text-sm font-bold transition-all ${
                          paymentForm.bankName === 'Barclays'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-indigo-50'
                        }`}
                      >
                        Barclays
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentForm({ ...paymentForm, bankName: 'Virgin' })}
                        className={`p-2.5 rounded-lg border text-sm font-bold transition-all ${
                          paymentForm.bankName === 'Virgin'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-indigo-50'
                        }`}
                      >
                        Virgin
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Data Încasării</label>
                  <input
                    type="date"
                    required
                    value={paymentForm.paymentDate}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Note / Observații</label>
                  <input
                    type="text"
                    placeholder="Referință sau detalii tranzacție..."
                    value={paymentForm.notes}
                    onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowPaymentModal(false)}
                    className="px-4 py-2.5 text-sm font-medium border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Anulează
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingPayment}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-sm"
                  >
                    {isSubmittingPayment ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    {isSubmittingPayment ? 'Se procesează...' : 'Confirmă Încasarea'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- VIZUALIZARE 2: LISTA GENERALĂ DE COMPANII ---
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center flex-wrap gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Clienți & Entități</h1>
          <p className="text-slate-500 mt-2">Gestiunea profilurilor companiilor, restanțelor, plăților și soldului de credit.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleSyncWithServer}
            disabled={syncing}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl font-medium shadow-sm shadow-indigo-600/30 transition-colors text-sm"
          >
            <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
            Sincronizează cu Serverul
          </button>
        </div>
      </div>

      {/* Bară de căutare */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm mb-8">
        <div className="relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Caută companie după nume, VAT / CUI, CRN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64 text-indigo-600 gap-3">
          <Loader2 className="animate-spin" size={32} />
          <span className="font-semibold text-slate-600">Se încarcă companiile...</span>
        </div>
      ) : filteredCompanies.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
          <Building2 size={48} className="mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-bold text-slate-700 mb-2">Nicio companie găsită</h3>
          <p className="text-slate-500 max-w-md mx-auto">Nu s-au găsit companii conform căutării.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCompanies.map(company => {
            const hasUnpaid = (company.unpaidInvoicesCount || 0) > 0;
            const hasCredit = (company.credit_balance || 0) > 0;

            return (
              <div 
                key={company.id} 
                onClick={() => setSelectedCompanyId(company.id)}
                className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-500/50 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                        <Building2 size={22} />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-lg leading-tight group-hover:text-indigo-600 transition-colors">{company.name}</h3>
                        <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                          {company.cui && <div>VAT No: <span className="font-mono text-slate-700 font-medium">{company.cui}</span></div>}
                          {company.reg_com && <div>CRN: <span className="font-mono text-slate-700 font-medium">{company.reg_com}</span></div>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-500 flex items-center gap-1.5 font-medium">
                      <Store size={14} className="text-indigo-500" />
                      {company.stores?.length || 0} magazine arondate
                    </span>

                    {hasCredit && (
                      <span className="bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full font-mono">
                        Credit: £{company.credit_balance?.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>

                <div className={`px-6 py-3 border-t flex items-center justify-between text-xs font-semibold ${
                  hasUnpaid ? 'bg-rose-50/60 border-rose-100 text-rose-800' : 'bg-slate-50 border-slate-100 text-slate-600'
                }`}>
                  <span>
                    {hasUnpaid 
                      ? `${company.unpaidInvoicesCount} facturi neachitate (£${company.unpaidTotal?.toFixed(2)})` 
                      : 'Fără restanțe'}
                  </span>
                  <span className="text-indigo-600 flex items-center gap-1 group-hover:translate-x-1 transition-transform font-bold">
                    Vezi Profil <ChevronRight size={14} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

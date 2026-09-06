import React, { useState, useEffect } from 'react';
import { api } from '../shared/api';
import { 
  Building2, Store, RefreshCw, AlertCircle, FileText, ArrowLeft, 
  DollarSign, CheckCircle2, PlusCircle, CreditCard, Banknote,
  ChevronRight, Printer, ShieldCheck, Loader2, Search, X, FileMinus2, Edit3
} from 'lucide-react';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { NumericInput } from '../components/NumericInput';
import { TextConfirmationModal } from '../components/TextConfirmationModal';

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
  const [, setLoadingProfile] = useState(false);
  const [activeTab, setActiveTab] = useState<'unpaid' | 'all' | 'payments' | 'credits' | 'stores'>('unpaid');
  const [profileIssuerFilter, setProfileIssuerFilter] = useState('all');

  // Modal Încasare
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<any | null>(null);
  const [paymentForm, setPaymentForm] = useState<{
    amount: string;
    method: 'cash' | 'transfer';
    bankName: 'Barclays' | 'Virgin';
    paymentDate: string;
    notes: string;
    issuerId: string;
  }>({
    amount: '',
    method: 'cash',
    bankName: 'Barclays',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: ''
    ,issuerId: ''
  });
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [generatingPdfId, setGeneratingPdfId] = useState<number | null>(null);
  const [creditInvoice, setCreditInvoice] = useState<any | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [isWriter, setIsWriter] = useState(false);
  const [editingPayment, setEditingPayment] = useState<any | null>(null);
  const [paymentEditForm, setPaymentEditForm] = useState({ amount: '', method: 'cash' as 'cash' | 'transfer', bankName: 'Barclays' as 'Barclays' | 'Virgin', reason: '' });
  const [isUpdatingPayment, setIsUpdatingPayment] = useState(false);
  const [pendingCreditReversal, setPendingCreditReversal] = useState<any | null>(null);

  useEffect(() => {
    void fetchCompanies();
    api.system.getDeviceRole().then((device) => setIsWriter(device.role === 'writer')).catch(console.error);
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
    const initialAmount = invoice ? Number(invoice.outstanding ?? (invoice.total_amount - invoice.paid_amount)).toFixed(2) : '';
    setPaymentForm({
      amount: initialAmount,
      method: 'cash',
      bankName: 'Barclays',
      paymentDate: new Date().toISOString().split('T')[0],
      notes: invoice ? `Încasare factura #${invoice.invoice_number}` : ''
      ,issuerId: String(invoice?.issuer_id || (profileIssuerFilter !== 'all' ? profileIssuerFilter : profileData?.company?.issuer_id) || '')
    });
    setShowPaymentModal(true);
  };

  const applyCredit = async () => {
    if (!creditInvoice || !profileData?.company) return;
    try {
      await api.billing.applyCompanyCredit({ companyId: profileData.company.id, issuerId: creditInvoice.issuer_id, invoiceId: creditInvoice.id, amount: Number(creditAmount), reason: creditReason });
      setCreditInvoice(null); setCreditAmount(''); setCreditReason(''); await loadCompanyProfile(profileData.company.id); await fetchCompanies();
    } catch (error: any) { alert(error.message || 'Creditul nu a putut fi aplicat.'); }
  };

  const reverseCredit = async (application: any) => {
    setPendingCreditReversal(application);
  };

  const confirmCreditReversal = async (reason: string) => {
    if (!pendingCreditReversal || !profileData?.company?.id) return;
    try {
      await api.billing.reverseCreditApplication(pendingCreditReversal.id, reason);
      setPendingCreditReversal(null);
      await Promise.all([loadCompanyProfile(profileData.company.id), fetchCompanies()]);
    } catch (error: any) {
      throw new Error(error.message || 'Aplicarea creditului nu a putut fi reversată.');
    }
  };

  const openPaymentEdit = (payment: any) => {
    setEditingPayment(payment);
    setPaymentEditForm({
      amount: Number(payment.amount).toFixed(2),
      method: payment.method === 'transfer' ? 'transfer' : 'cash',
      bankName: payment.bank_name === 'Virgin' ? 'Virgin' : 'Barclays',
      reason: '',
    });
  };

  const submitPaymentEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingPayment || !profileData?.company?.id) return;
    const amount = Number(paymentEditForm.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !paymentEditForm.reason.trim()) {
      alert('Introdu o sumă validă și motivul modificării.');
      return;
    }
    setIsUpdatingPayment(true);
    try {
      await api.billing.updatePayment({
        id: editingPayment.id,
        amount,
        method: paymentEditForm.method,
        bankName: paymentEditForm.method === 'transfer' ? paymentEditForm.bankName : undefined,
        reason: paymentEditForm.reason.trim(),
      });
      setEditingPayment(null);
      await Promise.all([loadCompanyProfile(profileData.company.id), fetchCompanies()]);
    } catch (error: any) {
      alert('Încasarea nu a putut fi modificată: ' + (error.message || error));
    } finally {
      setIsUpdatingPayment(false);
    }
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileData?.company?.id) return;

    const numericAmount = parseFloat(paymentForm.amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      alert('Te rugăm să introduci o sumă validă mai mare decât 0!');
      return;
    }
    if (!Number.isSafeInteger(Number(paymentForm.issuerId)) || Number(paymentForm.issuerId) <= 0) {
      alert('Selectează societatea emitentă pentru această încasare.');
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
        issuerId: Number(paymentForm.issuerId),
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
      const sharedSettings = await api.billing.getSettings();
      const settings = { ...(inv.issuer_settings || {}), invoiceLogo: sharedSettings.invoiceLogo };
      if (!inv.issuer_settings) throw new Error('Snapshotul emitentului facturii lipsește.');
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
          address: inv.store_address || '',
          postcode: inv.store_postcode || '',
        },
        items: inv.items || [],
        totalAmount: inv.total_amount
      };

      const buffer = generateInvoicePDF(settings, pdfData);
      const filename = `Factura_${inv.invoice_number}.pdf`;

      const localSave = await api.system.savePdfAuto({ buffer, filename, issuerCode: inv.issuer_code || settings.code });
      if (!localSave.success) throw new Error(localSave.error || 'PDF-ul nu a putut fi salvat local.');
      const cloudSave = await api.system.uploadPdfToCloud(filename, buffer);
      alert(cloudSave.success
        ? `Factura #${inv.invoice_number} a fost salvată pe calculator și verificată în Google Drive.`
        : `Factura #${inv.invoice_number} a fost salvată pe calculator, dar nu a fost confirmată în Google Drive: ${cloudSave.error || 'Eroare necunoscută'}`);
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
    const { company, stores, invoices: allInvoices, payments: allPayments } = profileData;
    const invoices = profileIssuerFilter === 'all' ? allInvoices : allInvoices.filter((invoice: any) => String(invoice.issuer_id) === profileIssuerFilter);
    const unpaidInvoices = invoices.filter((invoice: any) => invoice.status !== 'cancelled' && Number(invoice.outstanding || 0) > 0.005);
    const payments = profileIssuerFilter === 'all' ? allPayments : allPayments.filter((payment: any) => String(payment.issuer_id) === profileIssuerFilter);
    const selectedCredit = (profileData.issuerCredits || []).filter((credit: any) => profileIssuerFilter === 'all' || String(credit.issuer_id) === profileIssuerFilter).reduce((sum: number, credit: any) => sum + Number(credit.balance || 0), 0);
    const stats = {
      totalInvoiced: invoices.filter((invoice: any) => invoice.status !== 'cancelled').reduce((sum: number, invoice: any) => sum + Number(invoice.grossAmount || 0), 0),
      totalCredited: invoices.filter((invoice: any) => invoice.status !== 'cancelled').reduce((sum: number, invoice: any) => sum + Number(invoice.creditedAmount || 0), 0),
      totalNet: invoices.filter((invoice: any) => invoice.status !== 'cancelled').reduce((sum: number, invoice: any) => sum + Number(invoice.netAmount || 0), 0),
      totalPaid: invoices.filter((invoice: any) => invoice.status !== 'cancelled').reduce((sum: number, invoice: any) => sum + Number(invoice.cashPaid || 0), 0),
      totalCreditApplied: invoices.filter((invoice: any) => invoice.status !== 'cancelled').reduce((sum: number, invoice: any) => sum + Number(invoice.appliedCredit || 0), 0),
      totalUnpaid: unpaidInvoices.reduce((sum: number, invoice: any) => sum + Number(invoice.outstanding || 0), 0),
      creditBalance: selectedCredit,
    };

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
                  <span className="text-white px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: company.issuer_color || '#64748B' }}>{company.issuer_name || 'Emitent implicit'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <select value={profileIssuerFilter} onChange={(e) => setProfileIssuerFilter(e.target.value)} className="border border-slate-200 bg-white rounded-xl px-3 py-3 text-sm font-semibold"><option value="all">Toate societățile</option>{(profileData.issuers || []).map((issuer: any) => <option key={issuer.id} value={issuer.id}>{issuer.legal_name}</option>)}</select>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Facturat</span>
            <div className="text-2xl font-bold text-slate-900 mt-2">£{stats.totalInvoiced.toFixed(2)}</div>
            <span className="text-xs text-slate-400 mt-2">{invoices.length} facturi emise</span>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-amber-200 shadow-sm"><span className="text-xs font-semibold text-slate-500 uppercase">Total Creditat</span><div className="text-2xl font-bold text-amber-700 mt-2">£{stats.totalCredited.toFixed(2)}</div><div className="text-xs text-slate-400 mt-2">Net facturat £{stats.totalNet.toFixed(2)}</div></div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Încasat</span>
            <div className="text-2xl font-bold text-emerald-600 mt-2">£{stats.totalPaid.toFixed(2)}</div>
            <span className="text-xs text-slate-400 mt-2">Credit aplicat £{stats.totalCreditApplied.toFixed(2)}</span>
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
            <div className="mt-2 space-y-1">{(profileData.issuerCredits || []).map((credit: any) => <div key={credit.issuer_id} className="text-[10px] text-slate-500">{credit.issuer_name}: £{Number(credit.balance).toFixed(2)}</div>)}</div>
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
            <button onClick={() => setActiveTab('credits')} className={`py-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'credits' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><ShieldCheck size={18} />Registru Credit</button>
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
                          const due = Number(inv.outstanding || 0);
                          const issuerCredit = Number((profileData.issuerCredits || []).find((credit: any) => credit.issuer_id === inv.issuer_id)?.balance || 0);
                          return (
                            <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-3.5 px-4 font-bold text-slate-900">#{inv.invoice_number}</td>
                              <td className="py-3.5 px-4 text-slate-600">{inv.invoice_date}</td>
                              <td className="py-3.5 px-4 font-semibold text-slate-800">{inv.store_name}</td>
                              <td className="py-3.5 px-4 font-medium">£{Number(inv.netAmount ?? inv.total_amount).toFixed(2)}</td>
                              <td className="py-3.5 px-4 text-emerald-600 font-semibold">£{Number(inv.cashPaid || 0).toFixed(2)} + £{Number(inv.appliedCredit || 0).toFixed(2)} credit</td>
                              <td className="py-3.5 px-4 font-bold text-rose-600">£{due.toFixed(2)}</td>
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  onClick={() => handleOpenPaymentModal(inv)}
                                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3.5 py-1.5 rounded-lg font-semibold text-xs transition-colors"
                                >
                                  Încasează această factură
                                </button>
                                {issuerCredit > 0.005 && <button onClick={() => { setCreditInvoice(inv); setCreditAmount(Math.min(issuerCredit, due).toFixed(2)); setCreditReason('Aplicare manuală credit client'); }} className="ml-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3.5 py-1.5 rounded-lg font-semibold text-xs">Aplică credit</button>}
                                <button onClick={() => { window.location.hash = `/facturare/credit-notes?invoice=${inv.id}`; }} className="ml-2 bg-amber-50 hover:bg-amber-100 text-amber-800 px-3.5 py-1.5 rounded-lg font-semibold text-xs">Credit Note</button>
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
                      <th className="py-3 px-4 text-right">Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {invoices.map((inv: any) => {
                      const isPaid = inv.status === 'paid' || inv.status === 'credited';
                      const isPartial = inv.status === 'partial';

                      return (
                        <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-slate-900">#{inv.invoice_number}</td>
                          <td className="py-3.5 px-4 text-slate-600">{inv.invoice_date}</td>
                          <td className="py-3.5 px-4 font-semibold text-slate-800">{inv.store_name}</td>
                          <td className="py-3.5 px-4 font-bold">£{Number(inv.netAmount ?? inv.total_amount).toFixed(2)}{Number(inv.creditedAmount || 0) > 0 && <div className="text-[10px] font-normal text-amber-700">creditat £{Number(inv.creditedAmount).toFixed(2)}</div>}</td>
                          <td className="py-3.5 px-4">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              isPaid ? 'bg-emerald-100 text-emerald-800' : isPartial ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {inv.status === 'credited' ? 'Creditată integral' : isPaid ? 'Achitat' : isPartial ? `Parțial (£${Number(inv.cashPaid || inv.paid_amount || 0).toFixed(2)})` : 'Neachitat'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {inv.status !== 'cancelled' && inv.status !== 'credited' && <button onClick={() => { window.location.hash = `/facturare/credit-notes?invoice=${inv.id}`; }} className="p-1.5 text-amber-700 hover:bg-amber-50 rounded transition-colors" title="Creează Credit Note"><FileMinus2 size={16} /></button>}
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
                          <th className="py-3 px-4 text-right">Acțiuni</th>
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
                              {p.invoice_number ? `#${p.invoice_number}` : <span className="text-indigo-600 font-bold">Avans / Credit · {p.issuer_name || 'Emitent'}</span>}
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-500 italic">{p.notes || '—'}</td>
                            <td className="py-3.5 px-4 text-right">{isWriter && <button type="button" onClick={() => openPaymentEdit(p)} className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700" title="Modifică suma sau metoda de plată"><Edit3 size={16} /></button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'credits' && <div className="space-y-6"><div><h3 className="font-bold text-slate-900 mb-3">Surse de credit</h3><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="text-left p-3">Sursă</th><th className="text-left p-3">Emitent</th><th className="text-right p-3">Inițial</th><th className="text-right p-3">Disponibil</th><th className="text-left p-3">Status</th></tr></thead><tbody className="divide-y">{(profileData.creditLedger?.entries || []).filter((entry: any) => profileIssuerFilter === 'all' || String(entry.issuer_id) === profileIssuerFilter).map((entry: any) => <tr key={entry.id}><td className="p-3">{entry.source_type === 'credit_note' ? 'Credit Note' : entry.source_type === 'payment_overpayment' ? 'Supraîncasare' : 'Sold istoric'}</td><td className="p-3">{entry.issuer_name}</td><td className="p-3 text-right">£{Number(entry.original_amount).toFixed(2)}</td><td className="p-3 text-right font-bold">£{Number(entry.available_amount).toFixed(2)}</td><td className="p-3">{entry.status === 'active' ? 'Activ' : 'Reversat'}</td></tr>)}</tbody></table></div></div><div><h3 className="font-bold text-slate-900 mb-3">Aplicări pe facturi</h3><div className="divide-y border rounded-xl">{(profileData.creditLedger?.applications || []).filter((application: any) => profileIssuerFilter === 'all' || String(application.issuer_id) === profileIssuerFilter).map((application: any) => <div key={application.id} className="p-3 flex justify-between items-center"><div><strong>#{application.invoice_number}</strong> · £{Number(application.amount).toFixed(2)}<div className="text-xs text-slate-500">{application.reason}</div></div>{application.reversed_at ? <span className="text-xs text-slate-500">Reversat</span> : <button onClick={() => reverseCredit(application)} className="text-xs font-semibold text-rose-700">Reversează</button>}</div>)}</div></div></div>}

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
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Societate emitentă</label>
                  <select value={paymentForm.issuerId} disabled={Boolean(selectedInvoiceForPayment)} onChange={(e) => { setSelectedInvoiceForPayment(null); setPaymentForm((current) => ({ ...current, issuerId: e.target.value })); }} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800">
                    {(profileData.issuers || []).filter((issuer: any) => issuer.is_active === 1).map((issuer: any) => <option key={issuer.id} value={issuer.id}>{issuer.legal_name}</option>)}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">Plata și creditul se distribuie numai facturilor acestui emitent.</p>
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
                        setPaymentForm(prev => ({ ...prev, amount: Number(inv.outstanding || 0).toFixed(2) }));
                      }
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800"
                  >
                    <option value="">-- Distribuire automată pe cea mai veche factură neachitată --</option>
                    {unpaidInvoices.filter((inv: any) => String(inv.issuer_id) === paymentForm.issuerId).map((inv: any) => (
                      <option key={inv.id} value={inv.id}>
                        #{inv.invoice_number} ({inv.store_name}) — Restanță: £{Number(inv.outstanding || 0).toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Suma Încasată (£)</label>
                  <NumericInput
                    decimalScale={2}
                    required
                    placeholder="0.00"
                    value={paymentForm.amount}
                    onValueChange={(amount) => setPaymentForm(current => ({ ...current, amount }))}
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
        {editingPayment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 p-5"><div><h3 className="text-lg font-bold text-slate-900">Modifică încasarea</h3><p className="text-xs text-slate-500">{editingPayment.invoice_number ? `Factura #${editingPayment.invoice_number}` : `Avans / credit · ${editingPayment.issuer_name || 'Emitent'}`}</p></div><button type="button" onClick={() => setEditingPayment(null)} className="p-1 text-slate-400 hover:text-slate-700"><X size={20} /></button></div>
              <form onSubmit={submitPaymentEdit} className="space-y-4 p-6">
                <label className="block text-xs font-semibold uppercase text-slate-600">Suma încasată (£)<NumericInput decimalScale={2} required value={paymentEditForm.amount} onValueChange={(amount) => setPaymentEditForm((current) => ({ ...current, amount }))} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 font-mono text-lg font-bold" /></label>
                <div><div className="mb-1.5 text-xs font-semibold uppercase text-slate-600">Metodă plată</div><div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setPaymentEditForm((current) => ({ ...current, method: 'cash' }))} className={`rounded-xl border p-3 text-sm font-bold ${paymentEditForm.method === 'cash' ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-200 bg-slate-50 text-slate-700'}`}><Banknote size={17} className="mr-2 inline" />Cash</button><button type="button" onClick={() => setPaymentEditForm((current) => ({ ...current, method: 'transfer' }))} className={`rounded-xl border p-3 text-sm font-bold ${paymentEditForm.method === 'transfer' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700'}`}><CreditCard size={17} className="mr-2 inline" />Transfer</button></div></div>
                {paymentEditForm.method === 'transfer' && <label className="block text-xs font-semibold uppercase text-slate-600">Banca<select value={paymentEditForm.bankName} onChange={(event) => setPaymentEditForm((current) => ({ ...current, bankName: event.target.value as 'Barclays' | 'Virgin' }))} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"><option value="Barclays">Barclays</option><option value="Virgin">Virgin</option></select></label>}
                <label className="block text-xs font-semibold uppercase text-slate-600">Motivul modificării<input required maxLength={500} value={paymentEditForm.reason} onChange={(event) => setPaymentEditForm((current) => ({ ...current, reason: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" placeholder="Ex.: sumă introdusă greșit" /></label>
                <p className="text-xs text-slate-500">Modificarea recalculează factura sau creditul companiei și este păstrată în jurnalul de audit.</p>
                <div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setEditingPayment(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Renunță</button><button type="submit" disabled={isUpdatingPayment} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{isUpdatingPayment ? 'Se salvează...' : 'Salvează modificarea'}</button></div>
              </form>
            </div>
          </div>
        )}
        {creditInvoice && (
          <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex justify-between gap-3"><div><h3 className="text-lg font-bold">Aplică credit pe factura #{creditInvoice.invoice_number}</h3><p className="text-sm text-slate-500">Numai pentru {creditInvoice.issuer_name}.</p></div><button onClick={() => setCreditInvoice(null)}><X /></button></div>
              <label className="block text-sm font-semibold">Sumă (£)<NumericInput decimalScale={2} value={creditAmount} onValueChange={setCreditAmount} className="block w-full mt-1 border rounded-xl px-3 py-2.5" /></label>
              <label className="block text-sm font-semibold">Motiv<input value={creditReason} onChange={(e) => setCreditReason(e.target.value)} className="block w-full mt-1 border rounded-xl px-3 py-2.5" /></label>
              <div className="text-xs text-slate-500">Rest factură: £{Number(creditInvoice.outstanding || 0).toFixed(2)}. Creditul disponibil este verificat în backend și consumat FIFO.</div>
              <div className="flex justify-end gap-3"><button onClick={() => setCreditInvoice(null)} className="px-4 py-2 border rounded-xl">Renunță</button><button onClick={applyCredit} disabled={!creditReason.trim() || Number(creditAmount) <= 0} className="px-4 py-2 bg-indigo-600 disabled:opacity-50 text-white rounded-xl font-bold">Aplică credit</button></div>
            </div>
          </div>
        )}
        {pendingCreditReversal && <TextConfirmationModal
          title={`Reversează creditul aplicat facturii #${pendingCreditReversal.invoice_number}`}
          description="Creditul va redeveni disponibil pentru aceeași companie și același emitent, iar restul facturii va fi recalculat."
          fieldLabel="Motivul reversării"
          confirmLabel="Reversează creditul"
          dangerous
          onCancel={() => setPendingCreditReversal(null)}
          onConfirm={confirmCreditReversal}
        />}
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

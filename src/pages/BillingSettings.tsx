import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, Database, FileImage, Loader2, Save, Search, ShieldCheck } from 'lucide-react';
import { api } from '../shared/api';
import { NumericInput } from '../components/NumericInput';

type Issuer = any;

function toForm(issuer: Issuer) {
  return {
    id: issuer.id,
    legalName: issuer.legal_name || '',
    address: issuer.address || '',
    companyNumber: issuer.company_number || '',
    vatRegistered: issuer.vat_registered === 1,
    vatNumber: issuer.vat_number || '',
    bankName1: issuer.bank_name_1 || '', accountNumber1: issuer.account_number_1 || '', sortCode1: issuer.sort_code_1 || '',
    bankName2: issuer.bank_name_2 || '', accountNumber2: issuer.account_number_2 || '', sortCode2: issuer.sort_code_2 || '',
    footer: issuer.footer || '', invoiceSeries: issuer.invoice_series || '',
    nextInvoiceNumber: String(issuer.next_invoice_number || 1), color: issuer.color || '#4F46E5',
    alternateRowColor: issuer.alternate_row_color || issuer.color || '#4F46E5',
    alternateRowOpacity: Number(issuer.alternate_row_opacity ?? 5), isActive: issuer.is_active === 1,
    counterChangeReason: '',
  };
}

export function BillingSettings() {
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  const [selectedIssuerId, setSelectedIssuerId] = useState<number | null>(null);
  const [issuerForm, setIssuerForm] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [invoiceLogo, setInvoiceLogo] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [vrBaker, setVrBaker] = useState({ endpoint: '', hasToken: false });
  const [vrBakerToken, setVrBakerToken] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [isWriter, setIsWriter] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async (preferredIssuerId?: number) => {
    const [nextIssuers, nextCompanies, settings, status, device] = await Promise.all([
      api.billing.getIssuers(), api.billing.getAllCompaniesAndStores(), api.billing.getSettings(), api.billing.getVrBakerStatus(), api.system.getDeviceRole(),
    ]);
    setIssuers(nextIssuers || []); setCompanies(nextCompanies || []); setInvoiceLogo(settings.invoiceLogo || ''); setVrBaker(status); setIsWriter(device.role === 'writer');
    const issuer = nextIssuers.find((item: Issuer) => item.id === preferredIssuerId) || nextIssuers.find((item: Issuer) => item.is_default === 1) || nextIssuers[0];
    if (issuer) { setSelectedIssuerId(issuer.id); setIssuerForm(toForm(issuer)); }
  };

  useEffect(() => { load().catch((cause) => setError(cause.message)); }, []);
  const selectedIssuer = issuers.find((issuer) => issuer.id === selectedIssuerId);
  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLocaleLowerCase('ro-RO');
    return companies.filter((company) => !query || company.name.toLocaleLowerCase('ro-RO').includes(query));
  }, [companies, companySearch]);
  const updateField = (name: string, value: unknown) => setIssuerForm((current: any) => ({ ...current, [name]: value }));

  const saveIssuer = async () => {
    if (!issuerForm) return;
    setIsSaving(true); setError('');
    try {
      await api.billing.updateIssuer({ ...issuerForm, nextInvoiceNumber: Number(issuerForm.nextInvoiceNumber) });
      await api.billing.saveSettings({ invoiceLogo });
      await load(issuerForm.id); setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (cause: any) { setError(cause.message || 'Setările nu au putut fi salvate.'); }
    finally { setIsSaving(false); }
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 1024 * 1024) return setError('Logo-ul trebuie să fie mai mic de 1 MB.');
    const reader = new FileReader(); reader.onloadend = () => setInvoiceLogo(String(reader.result || '')); reader.readAsDataURL(file);
  };

  const assignIssuer = async (companyId: number, issuerId: number) => {
    setError('');
    try { await api.billing.assignCompanyIssuer(companyId, issuerId); await load(selectedIssuerId || undefined); }
    catch (cause: any) { setError(cause.message || 'Emitentul nu a putut fi atribuit.'); }
  };

  if (!issuerForm) return <div className="p-12 flex items-center gap-3 text-slate-500"><Loader2 className="animate-spin" /> Se încarcă setările...</div>;
  const fieldClass = 'w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 text-sm';

  return <div className="p-8 max-w-7xl mx-auto space-y-8">
    <div className="flex items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div><h1 className="text-2xl font-bold text-slate-900">Setări Facturare</h1><p className="text-sm text-slate-500 mt-1">Societăți emitente, serii independente și atribuirea clienților.</p></div>
      <button onClick={saveIssuer} disabled={isSaving || !isWriter} className="bg-indigo-600 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2">
        {isSaving ? <Loader2 size={18} className="animate-spin" /> : saved ? <Check size={18} /> : <Save size={18} />}{saved ? 'Salvat' : 'Salvează emitentul'}
      </button>
    </div>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</div>}
    {!isWriter && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">Mod consultare: setările și atribuirile pot fi schimbate numai pe calculatorul Writer.</div>}

    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-200 flex flex-wrap gap-3">{issuers.map((issuer) => <button key={issuer.id} onClick={() => { setSelectedIssuerId(issuer.id); setIssuerForm(toForm(issuer)); setError(''); }} className={`px-4 py-3 rounded-xl border text-left ${selectedIssuerId === issuer.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
        <span className="block font-bold text-slate-900">{issuer.legal_name}</span><span className="text-xs text-slate-500">{issuer.is_default ? 'Implicit · ' : ''}{issuer.isReady ? 'Pregătit pentru facturare' : 'Configurare incompletă'}</span>
      </button>)}</div>
      <fieldset disabled={!isWriter}>
      <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="flex items-center gap-3"><Building2 className="text-indigo-600" /><h2 className="text-lg font-bold">Date juridice și bancare</h2></div>
          <label className="block text-sm font-medium">Company Name<input className={fieldClass} value={issuerForm.legalName} onChange={(e) => updateField('legalName', e.target.value)} /></label>
          <label className="block text-sm font-medium">Company Address<input className={fieldClass} value={issuerForm.address} onChange={(e) => updateField('address', e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">Company Registration Number<input className={fieldClass} value={issuerForm.companyNumber} onChange={(e) => updateField('companyNumber', e.target.value)} /></label><label className="block text-sm font-medium">VAT Number<input className={fieldClass} disabled={!issuerForm.vatRegistered} value={issuerForm.vatNumber} onChange={(e) => updateField('vatNumber', e.target.value)} /></label></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm flex items-center gap-2"><ShieldCheck size={17} className={issuerForm.vatRegistered ? 'text-emerald-600' : 'text-amber-600'} />{issuerForm.vatRegistered ? 'Societate VAT registered' : 'Societate non-VAT; factura nu colectează VAT'}</div>
          <div className="grid grid-cols-3 gap-3"><label className="block text-sm font-medium">Bank<input className={fieldClass} value={issuerForm.bankName1} onChange={(e) => updateField('bankName1', e.target.value)} /></label><label className="block text-sm font-medium">Account Number<input className={fieldClass} value={issuerForm.accountNumber1} onChange={(e) => updateField('accountNumber1', e.target.value)} /></label><label className="block text-sm font-medium">Sort Code<input className={fieldClass} value={issuerForm.sortCode1} onChange={(e) => updateField('sortCode1', e.target.value)} /></label></div>
          <div className="grid grid-cols-3 gap-3"><label className="block text-sm font-medium">Bank 2<input className={fieldClass} value={issuerForm.bankName2} onChange={(e) => updateField('bankName2', e.target.value)} /></label><label className="block text-sm font-medium">Account 2<input className={fieldClass} value={issuerForm.accountNumber2} onChange={(e) => updateField('accountNumber2', e.target.value)} /></label><label className="block text-sm font-medium">Sort Code 2<input className={fieldClass} value={issuerForm.sortCode2} onChange={(e) => updateField('sortCode2', e.target.value)} /></label></div>
        </div>
        <div className="space-y-4">
          <h2 className="text-lg font-bold">Serie și design PDF</h2>
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">Serie<input className={`${fieldClass} uppercase font-bold`} value={issuerForm.invoiceSeries} onChange={(e) => updateField('invoiceSeries', e.target.value.toUpperCase())} /></label><label className="block text-sm font-medium">Următorul număr<NumericInput integer className={`${fieldClass} font-mono`} value={issuerForm.nextInvoiceNumber} onValueChange={(value) => updateField('nextInvoiceNumber', value)} /></label></div>
          {selectedIssuer && Number(issuerForm.nextInvoiceNumber) > Number(selectedIssuer.next_invoice_number) && <label className="block text-sm font-medium">Motivul creșterii contorului<input className={fieldClass} value={issuerForm.counterChangeReason} onChange={(e) => updateField('counterChangeReason', e.target.value)} placeholder="Explică numerele omise" /></label>}
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">Culoare accent<input type="color" className="block mt-2 w-16 h-11" value={issuerForm.color} onChange={(e) => updateField('color', e.target.value)} /></label><label className="block text-sm font-medium">Culoare rânduri<input type="color" className="block mt-2 w-16 h-11" value={issuerForm.alternateRowColor} onChange={(e) => updateField('alternateRowColor', e.target.value)} /></label></div>
          <label className="block text-sm font-medium">Footer<textarea rows={4} className={fieldClass} value={issuerForm.footer} onChange={(e) => updateField('footer', e.target.value)} /></label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 font-semibold"><input type="checkbox" checked={issuerForm.isActive} disabled={Boolean(selectedIssuer?.is_default)} onChange={(e) => updateField('isActive', e.target.checked)} />Activ pentru facturare {selectedIssuer?.is_default ? '(emitent implicit)' : ''}</label>
          <div className="border-t border-slate-200 pt-4"><label className="text-sm font-medium block mb-2">Logo comun facturilor</label><div className="flex items-center gap-4">{invoiceLogo ? <img src={invoiceLogo} alt="Logo factură" className="h-16 max-w-32 object-contain border rounded-lg p-2" /> : <div className="w-24 h-16 border border-dashed rounded-lg flex items-center justify-center text-slate-400"><FileImage /></div>}<input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={handleLogoUpload} className="text-sm" />{invoiceLogo && <button onClick={() => { setInvoiceLogo(''); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="text-sm text-rose-600">Elimină</button>}</div></div>
        </div>
      </div>
      </fieldset>
    </section>

    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
      <fieldset disabled={!isWriter} className="space-y-4">
      <div><h2 className="text-lg font-bold">Emitentul fiecărui client</h2><p className="text-sm text-slate-500">Alegerea se aplică tuturor magazinelor companiei și numai facturilor viitoare.</p></div>
      <div className="relative max-w-xl"><Search size={17} className="absolute left-3 top-3 text-slate-400" /><input className="w-full pl-10 pr-4 py-2.5 border rounded-xl" value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} placeholder="Caută o companie-client..." /></div>
      <div className="divide-y divide-slate-100 border rounded-xl max-h-96 overflow-y-auto">{filteredCompanies.map((company) => <div key={company.id} className="p-4 flex items-center justify-between gap-4"><div><div className="font-semibold text-slate-900">{company.name}</div><div className="text-xs text-slate-500">{company.stores?.length || 0} magazine</div></div><select value={company.issuer_id || ''} onChange={(e) => assignIssuer(company.id, Number(e.target.value))} className="min-w-72 border border-slate-200 rounded-xl px-3 py-2 text-sm">{issuers.map((issuer) => <option key={issuer.id} value={issuer.id} disabled={!issuer.isReady}>{issuer.legal_name}{issuer.is_default ? ' (Implicit)' : ''}{!issuer.isReady ? ' — configurare incompletă' : ''}</option>)}</select></div>)}</div>
      </fieldset>
    </section>

    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><fieldset disabled={!isWriter}><div className="flex items-center gap-3 mb-5"><Database className="text-slate-600" /><div><h2 className="text-lg font-bold">Conexiune VR Baker Platform</h2><p className="text-sm text-slate-500">API read-only pentru comenzi, companii, magazine și produse.</p></div></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><input readOnly value={vrBaker.endpoint} className="bg-slate-100 border rounded-xl px-4 py-2.5 text-xs" /><input type="password" value={vrBakerToken} onChange={(e) => setVrBakerToken(e.target.value)} placeholder={vrBaker.hasToken ? 'Token salvat — introdu unul nou pentru rotație' : 'Introdu tokenul dedicat'} className="border rounded-xl px-4 py-2.5" /><div className="md:col-span-2 flex flex-wrap gap-3 items-center"><button disabled={!vrBakerToken} onClick={async () => { const result = await api.billing.configureVrBakerToken(vrBakerToken); setConnectionMessage(result.message); if (result.success) { setVrBakerToken(''); setVrBaker(await api.billing.getVrBakerStatus()); } }} className="bg-indigo-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold">Verifică și salvează tokenul</button><button disabled={!vrBaker.hasToken} onClick={async () => setConnectionMessage((await api.billing.testVrBakerConnection()).message)} className="bg-slate-100 disabled:opacity-50 px-4 py-2 rounded-xl text-sm font-semibold">Testează conexiunea</button><span className={vrBaker.hasToken ? 'text-emerald-700 text-sm font-medium' : 'text-amber-700 text-sm font-medium'}>{vrBaker.hasToken ? 'Token configurat' : 'Token neconfigurat'}</span></div>{connectionMessage && <p className="md:col-span-2 text-sm text-slate-600">{connectionMessage}</p>}</div></fieldset></section>
  </div>;
}

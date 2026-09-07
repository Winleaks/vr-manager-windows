import {BillingPublicationSettings} from '../components/BillingPublicationSettings';
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Building2, Check, Database, FileImage, Loader2, Save, ShieldCheck } from 'lucide-react';
import { api } from '../shared/api';
import { NumericInput } from '../components/NumericInput';
import { TextConfirmationModal } from '../components/TextConfirmationModal';

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
    creditNoteSeries: issuer.credit_note_series || (issuer.code === 'goodness' ? 'CN-TGB' : 'CN-VATRA'),
    nextCreditNoteNumber: String(issuer.next_credit_note_number || 1),
    confirmCreditNoteSequence: issuer.credit_note_sequence_confirmed === 1,
    creditNoteCounterChangeReason: '',
  };
}

export function BillingSettings() {
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  const [selectedIssuerId, setSelectedIssuerId] = useState<number | null>(null);
  const [issuerForm, setIssuerForm] = useState<any>(null);
  const [invoiceLogo, setInvoiceLogo] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [vrBaker, setVrBaker] = useState({ endpoint: '', hasToken: false });
  const [vrBakerToken, setVrBakerToken] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [isWriter, setIsWriter] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [pendingTestMode, setPendingTestMode] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async (preferredIssuerId?: number) => {
    const [nextIssuers, settings, status, device, testModeState] = await Promise.all([
      api.billing.getIssuers(), api.billing.getSettings(), api.billing.getVrBakerStatus(), api.system.getDeviceRole(), api.billing.getTestMode(),
    ]);
    setIssuers(nextIssuers || []); setInvoiceLogo(settings.invoiceLogo || ''); setVrBaker(status); setIsWriter(device.role === 'writer'); setTestMode(testModeState.enabled === true);
    const issuer = nextIssuers.find((item: Issuer) => item.id === preferredIssuerId) || nextIssuers.find((item: Issuer) => item.is_default === 1) || nextIssuers[0];
    if (issuer) { setSelectedIssuerId(issuer.id); setIssuerForm(toForm(issuer)); }
  };

  useEffect(() => { load().catch((cause) => setError(cause.message)); }, []);
  const selectedIssuer = issuers.find((issuer) => issuer.id === selectedIssuerId);
  const updateField = (name: string, value: unknown) => setIssuerForm((current: any) => ({ ...current, [name]: value }));

  const saveIssuer = async () => {
    if (!issuerForm) return;
    setIsSaving(true); setError('');
    try {
      await api.billing.updateIssuer({ ...issuerForm, nextInvoiceNumber: Number(issuerForm.nextInvoiceNumber), nextCreditNoteNumber: Number(issuerForm.nextCreditNoteNumber) });
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

  const changeTestMode = async () => {
    const enabling = !testMode;
    setPendingTestMode(enabling);
  };

  const confirmTestMode = async (confirmation: string) => {
    if (pendingTestMode === null) return;
    setError('');
    try {
      const result = await api.billing.setTestMode(pendingTestMode, confirmation);
      setTestMode(result.enabled === true);
      setPendingTestMode(null);
    } catch (cause: any) {
      throw new Error(cause.message || 'Modul de facturare nu a putut fi schimbat.');
    }
  };

  if (!issuerForm) return <div className="p-12 flex items-center gap-3 text-slate-500"><Loader2 className="animate-spin" /> Se încarcă setările...</div>;
  const fieldClass = 'w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 text-sm';

  return <div className="p-8 max-w-7xl mx-auto space-y-8">
    <div className="flex items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div><h1 className="text-2xl font-bold text-slate-900">Setări Facturare</h1><p className="text-sm text-slate-500 mt-1">Societăți emitente, serii independente și conexiunea VR Baker Platform.</p></div>
      <button onClick={saveIssuer} disabled={isSaving || !isWriter} className="bg-indigo-600 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2">
        {isSaving ? <Loader2 size={18} className="animate-spin" /> : saved ? <Check size={18} /> : <Save size={18} />}{saved ? 'Salvat' : 'Salvează emitentul'}
      </button>
    </div>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</div>}
    {!isWriter && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">Mod consultare: setările și atribuirile pot fi schimbate numai pe calculatorul Writer.</div>}

    <section className={`rounded-2xl border p-5 shadow-sm ${testMode ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3"><AlertTriangle className={testMode ? 'text-amber-600' : 'text-slate-400'} /><div><h2 className="font-bold text-slate-900">Mod test facturare</h2><p className="mt-1 max-w-3xl text-sm text-slate-600">{testMode ? 'ACTIV — facturile simple de test pot fi șterse definitiv din pagina Facturi Emise. Facturile cu plăți, Credit Notes sau reemiteri se curăță prin restaurarea copiei inițiale.' : 'INACTIV — comportament live: numerele emise se păstrează, iar facturile pot fi doar anulate.'}</p></div></div>
        <button type="button" disabled={!isWriter} onClick={changeTestMode} className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 ${testMode ? 'bg-slate-700 hover:bg-slate-800' : 'bg-amber-600 hover:bg-amber-700'}`}>{testMode ? 'Începe operarea live' : 'Activează modul test'}</button>
      </div>
    </section>

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
          <div className="mt-5 pt-5 border-t border-slate-200 space-y-3"><div><h3 className="font-bold text-slate-900">Numerotare Credit Notes</h3><p className="text-xs text-slate-500 mt-1">Serie independentă, fără resetare anuală. Emiterea este blocată până la confirmare.</p></div><div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">Serie Credit Note<input className={`${fieldClass} uppercase font-bold`} value={issuerForm.creditNoteSeries} onChange={(e) => updateField('creditNoteSeries', e.target.value.toUpperCase())} /></label><label className="block text-sm font-medium">Următorul număr<NumericInput integer className={`${fieldClass} font-mono`} value={issuerForm.nextCreditNoteNumber} onValueChange={(value) => updateField('nextCreditNoteNumber', value)} /></label></div>{selectedIssuer && Number(issuerForm.nextCreditNoteNumber) > Number(selectedIssuer.next_credit_note_number || 1) && <label className="block text-sm font-medium">Motivul saltului de numere<input className={fieldClass} value={issuerForm.creditNoteCounterChangeReason} onChange={(e) => updateField('creditNoteCounterChangeReason', e.target.value)} placeholder="Explică numerele omise" /></label>}<label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><input className="mt-0.5" type="checkbox" checked={issuerForm.confirmCreditNoteSequence} onChange={(e) => updateField('confirmCreditNoteSequence', e.target.checked)} /><span><strong>Confirm seria și următorul număr liber.</strong><br /><span className="text-amber-800">După prima emitere seria nu mai poate fi schimbată.</span></span></label></div>
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">Culoare accent<input type="color" className="block mt-2 w-16 h-11" value={issuerForm.color} onChange={(e) => updateField('color', e.target.value)} /></label><label className="block text-sm font-medium">Culoare rânduri<input type="color" className="block mt-2 w-16 h-11" value={issuerForm.alternateRowColor} onChange={(e) => updateField('alternateRowColor', e.target.value)} /></label></div>
          <label className="block text-sm font-medium">Footer<textarea rows={4} className={fieldClass} value={issuerForm.footer} onChange={(e) => updateField('footer', e.target.value)} /></label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 font-semibold"><input type="checkbox" checked={issuerForm.isActive} disabled={Boolean(selectedIssuer?.is_default)} onChange={(e) => updateField('isActive', e.target.checked)} />Activ pentru facturare {selectedIssuer?.is_default ? '(emitent implicit)' : ''}</label>
          <div className="border-t border-slate-200 pt-4"><label className="text-sm font-medium block mb-2">Logo comun facturilor</label><div className="flex items-center gap-4">{invoiceLogo ? <img src={invoiceLogo} alt="Logo factură" className="h-16 max-w-32 object-contain border rounded-lg p-2" /> : <div className="w-24 h-16 border border-dashed rounded-lg flex items-center justify-center text-slate-400"><FileImage /></div>}<input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={handleLogoUpload} className="text-sm" />{invoiceLogo && <button onClick={() => { setInvoiceLogo(''); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="text-sm text-rose-600">Elimină</button>}</div></div>
        </div>
      </div>
      </fieldset>
    </section>

    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><fieldset disabled={!isWriter}><div className="flex items-center gap-3 mb-5"><Database className="text-slate-600" /><div><h2 className="text-lg font-bold">Conexiune VR Baker Platform</h2><p className="text-sm text-slate-500">API read-only pentru comenzi, companii, magazine și produse.</p></div></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><input readOnly value={vrBaker.endpoint} className="bg-slate-100 border rounded-xl px-4 py-2.5 text-xs" /><input type="password" value={vrBakerToken} onChange={(e) => setVrBakerToken(e.target.value)} placeholder={vrBaker.hasToken ? 'Token salvat — introdu unul nou pentru rotație' : 'Introdu tokenul dedicat'} className="border rounded-xl px-4 py-2.5" /><div className="md:col-span-2 flex flex-wrap gap-3 items-center"><button disabled={!vrBakerToken} onClick={async () => { const result = await api.billing.configureVrBakerToken(vrBakerToken); setConnectionMessage(result.message); if (result.success) { setVrBakerToken(''); setVrBaker(await api.billing.getVrBakerStatus()); } }} className="bg-indigo-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold">Verifică și salvează tokenul</button><button disabled={!vrBaker.hasToken} onClick={async () => setConnectionMessage((await api.billing.testVrBakerConnection()).message)} className="bg-slate-100 disabled:opacity-50 px-4 py-2 rounded-xl text-sm font-semibold">Testează conexiunea</button><span className={vrBaker.hasToken ? 'text-emerald-700 text-sm font-medium' : 'text-amber-700 text-sm font-medium'}>{vrBaker.hasToken ? 'Token configurat' : 'Token neconfigurat'}</span></div>{connectionMessage && <p className="md:col-span-2 text-sm text-slate-600">{connectionMessage}</p>}</div></fieldset></section>
    <BillingPublicationSettings isWriter={isWriter}/>
    {pendingTestMode !== null && <TextConfirmationModal
      title={pendingTestMode ? 'Activează Modul test facturare' : 'Începe operarea live'}
      description={pendingTestMode ? 'Facturile simple de test vor putea fi șterse definitiv. Păstrează copia de siguranță inițială pentru scenariile cu plăți și Credit Notes.' : 'După dezactivare, facturile emise vor putea fi doar anulate și numerele lor vor rămâne în registru.'}
      fieldLabel="Confirmare"
      confirmLabel={pendingTestMode ? 'Activează modul test' : 'Începe live'}
      expectedText={pendingTestMode ? 'MOD TEST' : 'INCEP LIVE'}
      dangerous={pendingTestMode}
      onCancel={() => setPendingTestMode(null)}
      onConfirm={confirmTestMode}
    />}
  </div>;
}

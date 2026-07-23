import React, { useState, useEffect, useRef } from 'react';
import { Save, Check, Database, Building2, Palette, FileImage } from 'lucide-react';
import { api } from '../shared/api';

export function BillingSettings() {
  const [settings, setSettings] = useState({
    supabaseUrl: '',
    supabaseKey: '',
    supabaseEmail: '',
    supabasePassword: '',
    invoiceSeries: 'INV',
    invoiceStartNumber: '1',
    issuerName: '',
    issuerAddress: '',
    issuerCrn: '',
    issuerVat: '',
    invoiceBankName1: '',
    invoiceAccountNumber: '',
    invoiceSortCode: '',
    invoiceBankName2: '',
    invoiceAccountNumber2: '',
    invoiceSortCode2: '',
    invoiceFooter: '',
    invoiceColor: '#4F46E5',
    invoiceAlternateRowColor: '#4F46E5',
    invoiceAlternateRowOpacity: 5,
    invoiceLogo: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.billing.getSettings();
      setSettings(prev => ({ ...prev, ...data }));
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.billing.saveSettings(settings);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSettings(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
      alert("Image is too large! Please choose an image under 1MB.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setSettings(prev => ({ ...prev, invoiceLogo: base64String }));
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setSettings(prev => ({ ...prev, invoiceLogo: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Salvare Setări (Save Settings)</h2>
          <p className="text-sm text-slate-500">Apasă aici pentru a salva toate modificările de mai jos.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-md shadow-indigo-200 cursor-pointer"
        >
          {showSaved ? <Check size={20} /> : <Save size={20} />}
          {showSaved ? 'Salvat' : 'Salvează Tot'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Date Companie */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
              <Building2 size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Date Companie (UK Provider)</h2>
              <p className="text-sm text-slate-500">Apar pe facturile generate (partea stângă-sus).</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Company Name</label>
              <input type="text" name="issuerName" value={settings.issuerName} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Company Address (Adresă Emitent)</label>
              <input type="text" name="issuerAddress" value={settings.issuerAddress} onChange={handleChange} placeholder="Ex: 123 High Street, London, UK" className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700">CRN (Company Reg. No)</label>
                <input type="text" name="issuerCrn" value={settings.issuerCrn} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">VAT Number (Opțional)</label>
                <input type="text" name="issuerVat" value={settings.issuerVat} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
              </div>
            </div>
            
            {/* Cont Bancar Principal */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <h3 className="text-sm font-bold text-slate-800">Cont Bancar Principal (Bank Account 1)</h3>
              <div>
                <label className="text-xs font-medium text-slate-600">Nume Bancă (Bank Name)</label>
                <input type="text" name="invoiceBankName1" value={settings.invoiceBankName1} onChange={handleChange} placeholder="Ex: Barclays / Revolut Business" className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-600">Account Number</label>
                  <input type="text" name="invoiceAccountNumber" value={settings.invoiceAccountNumber} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500 font-mono text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Sort Code</label>
                  <input type="text" name="invoiceSortCode" value={settings.invoiceSortCode} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500 font-mono text-sm" placeholder="XX-XX-XX" />
                </div>
              </div>
            </div>

            {/* Cont Bancar Secundar */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <h3 className="text-sm font-bold text-slate-800">Cont Bancar Secundar (Bank Account 2 - Opțional)</h3>
              <div>
                <label className="text-xs font-medium text-slate-600">Nume Bancă 2 (Bank Name 2)</label>
                <input type="text" name="invoiceBankName2" value={settings.invoiceBankName2} onChange={handleChange} placeholder="Ex: Lloyds Bank" className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-600">Account Number 2</label>
                  <input type="text" name="invoiceAccountNumber2" value={settings.invoiceAccountNumber2} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500 font-mono text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Sort Code 2</label>
                  <input type="text" name="invoiceSortCode2" value={settings.invoiceSortCode2} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500 font-mono text-sm" placeholder="XX-XX-XX" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Template Factura PDF */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="w-10 h-10 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center">
              <Palette size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Personalizare Design PDF</h2>
              <p className="text-sm text-slate-500">Logo, culori și numerotare facturi.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700">Invoice Series Prefix</label>
                <input type="text" name="invoiceSeries" value={settings.invoiceSeries} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 uppercase font-bold" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Next Number</label>
                <input type="number" name="invoiceStartNumber" value={settings.invoiceStartNumber} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 font-mono" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-2">Culoare Header Factură</label>
                <div className="flex items-center gap-3">
                  <input 
                    type="color" 
                    name="invoiceColor" 
                    value={settings.invoiceColor} 
                    onChange={handleChange} 
                    className="w-12 h-12 rounded-lg cursor-pointer border-0 p-1 bg-slate-50" 
                  />
                  <span className="text-slate-500 font-mono text-sm">{settings.invoiceColor}</span>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 block mb-2">Culoare Nuanțare Rânduri Alternate</label>
                <div className="flex items-center gap-3">
                  <input 
                    type="color" 
                    name="invoiceAlternateRowColor" 
                    value={settings.invoiceAlternateRowColor || settings.invoiceColor} 
                    onChange={handleChange} 
                    className="w-12 h-12 rounded-lg cursor-pointer border-0 p-1 bg-slate-50" 
                  />
                  <span className="text-slate-500 font-mono text-sm">{settings.invoiceAlternateRowColor || settings.invoiceColor}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-slate-700">Intensitate / Transparență Rânduri Alternate: <span className="font-bold text-indigo-600">{settings.invoiceAlternateRowOpacity ?? 5}%</span></label>
              </div>
              <input 
                type="range" 
                name="invoiceAlternateRowOpacity" 
                min="0" 
                max="30" 
                step="1"
                value={settings.invoiceAlternateRowOpacity ?? 5} 
                onChange={handleChange} 
                className="w-full accent-indigo-600 cursor-pointer"
              />
              
              {/* Demo Previzualizare rânduri tabel */}
              <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden text-xs">
                <div className="bg-slate-100 px-3 py-1.5 font-bold text-slate-700">Previzualizare Rânduri Tabel Produse</div>
                <div className="px-3 py-1.5 bg-white text-slate-800 border-b border-slate-100">Rând 1: Produs 1 - £10.00 (Alb)</div>
                <div 
                  className="px-3 py-1.5 text-slate-800 transition-colors"
                  style={{ 
                    backgroundColor: `${settings.invoiceAlternateRowColor || settings.invoiceColor}${Math.round(((settings.invoiceAlternateRowOpacity ?? 5) / 100) * 255).toString(16).padStart(2, '0')}`
                  }}
                >
                  Rând 2: Produs 2 - £15.00 (Rând Alternat Nuanțat)
                </div>
                <div className="px-3 py-1.5 bg-white text-slate-800">Rând 3: Produs 3 - £8.50 (Alb)</div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 block mb-2">Logo Factură (Dreapta-Sus)</label>
              <div className="flex items-center gap-4">
                {settings.invoiceLogo ? (
                  <div className="relative border border-slate-200 rounded-lg p-2 bg-slate-50">
                    <img src={settings.invoiceLogo} alt="Logo" className="h-16 object-contain" />
                    <button onClick={removeLogo} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full w-6 h-6 text-xs font-bold hover:bg-rose-600 cursor-pointer">×</button>
                  </div>
                ) : (
                  <div className="w-24 h-16 bg-slate-50 border border-dashed border-slate-300 rounded-lg flex items-center justify-center text-slate-400">
                    <FileImage size={24} />
                  </div>
                )}
                <div className="flex-1">
                  <input 
                    type="file" 
                    accept="image/png, image/jpeg" 
                    onChange={handleLogoUpload} 
                    ref={fileInputRef}
                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                  />
                  <p className="text-xs text-slate-400 mt-1">Recomandat: PNG transparent sub 1MB.</p>
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Footer Notes / Terms (Opțional)</label>
              <textarea 
                name="invoiceFooter" 
                value={settings.invoiceFooter} 
                onChange={handleChange} 
                rows={3}
                placeholder="Ex: Company registered in England and Wales..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 text-sm" 
              />
            </div>
          </div>
        </div>
      </div>

      {/* Card Supabase */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm opacity-80 hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center">
            <Database size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Conexiune Lovable Cloud (Supabase)</h2>
            <p className="text-sm text-slate-500">Configurația API pentru citirea comenzilor de la distanță.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Supabase URL</label>
            <input type="text" name="supabaseUrl" value={settings.supabaseUrl} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Anon Key (Publishable)</label>
            <input type="text" name="supabaseKey" value={settings.supabaseKey} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Email Cont (Lovable Auth)</label>
            <input type="email" name="supabaseEmail" value={settings.supabaseEmail} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Parolă Cont</label>
            <input type="password" name="supabasePassword" value={settings.supabasePassword} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 text-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}

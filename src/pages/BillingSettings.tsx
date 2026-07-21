import React, { useState, useEffect, useRef } from 'react';
import { Save, Check, Key, Database, Building2, Palette, FileImage, FileText } from 'lucide-react';
import { api } from '../shared/api';

export function BillingSettings() {
  const [settings, setSettings] = useState({
    supabaseUrl: '',
    supabaseKey: '',
    supabaseEmail: '',
    supabasePassword: '',
    invoiceSeries: 'FACT',
    invoiceStartNumber: '1',
    issuerName: '',
    issuerCui: '',
    invoiceBankName: '',
    invoiceIban: '',
    invoiceFooter: '',
    invoiceColor: '#4F46E5',
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
      alert("Imaginea este prea mare! Alegeți o imagine sub 1MB.");
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
          <h2 className="text-xl font-bold text-slate-900">Salvare Setări</h2>
          <p className="text-sm text-slate-500">Apasă aici pentru a salva toate modificările de mai jos.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-md shadow-indigo-200"
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
              <h2 className="text-lg font-bold text-slate-900">Date Companie (Furnizor)</h2>
              <p className="text-sm text-slate-500">Apar pe facturile generate (partea stângă-sus).</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Denumire Firmă</label>
              <input type="text" name="issuerName" value={settings.issuerName} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">C.I.F. (CUI)</label>
              <input type="text" name="issuerCui" value={settings.issuerCui} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Banca (Opțional)</label>
              <input type="text" name="invoiceBankName" value={settings.invoiceBankName} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Cont IBAN (Opțional)</label>
              <input type="text" name="invoiceIban" value={settings.invoiceIban} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 font-mono text-sm uppercase" />
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
                <label className="text-sm font-medium text-slate-700">Seria Facturii</label>
                <input type="text" name="invoiceSeries" value={settings.invoiceSeries} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 uppercase font-bold" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Următorul Număr</label>
                <input type="number" name="invoiceStartNumber" value={settings.invoiceStartNumber} onChange={handleChange} className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 font-mono" />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 block mb-2">Culoare Principală Header</label>
              <div className="flex items-center gap-4">
                <input 
                  type="color" 
                  name="invoiceColor" 
                  value={settings.invoiceColor} 
                  onChange={handleChange} 
                  className="w-14 h-14 rounded-lg cursor-pointer border-0 p-1 bg-slate-50" 
                />
                <span className="text-slate-500 font-mono text-sm">{settings.invoiceColor}</span>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 block mb-2">Logo Factură (Dreapta-Sus)</label>
              <div className="flex items-center gap-4">
                {settings.invoiceLogo ? (
                  <div className="relative border border-slate-200 rounded-lg p-2 bg-slate-50">
                    <img src={settings.invoiceLogo} alt="Logo" className="h-16 object-contain" />
                    <button onClick={removeLogo} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full w-6 h-6 text-xs font-bold hover:bg-rose-600">×</button>
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
                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                  <p className="text-xs text-slate-400 mt-1">Recomandat: PNG transparent sub 1MB.</p>
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Text Subsol / Termeni (Opțional)</label>
              <textarea 
                name="invoiceFooter" 
                value={settings.invoiceFooter} 
                onChange={handleChange} 
                rows={3}
                placeholder="Ex: Factura este valabilă fără ștampilă conform legii..."
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

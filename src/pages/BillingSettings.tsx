import React, { useState, useEffect } from 'react';
import { Save, Check, Key, Database, Building2 } from 'lucide-react';
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
    issuerCui: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.billing.getSettings();
      setSettings(data);
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSettings(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Setări Facturare</h1>
          <p className="text-slate-500 mt-2">Conexiunea cu cloud-ul Lovable și detaliile firmei tale.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-all shadow-sm"
        >
          {showSaved ? <Check size={18} /> : <Save size={18} />}
          {showSaved ? 'Salvat' : 'Salvează Setările'}
        </button>
      </div>

      <div className="space-y-6">
        {/* Card Supabase */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
              <Database size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Conexiune Lovable Cloud (Supabase)</h2>
              <p className="text-sm text-slate-500">Găsești aceste date în proiectul tău Lovable.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Supabase URL</label>
              <input
                type="text"
                name="supabaseUrl"
                value={settings.supabaseUrl}
                onChange={handleChange}
                placeholder="https://kqjmnkhswyectpqnhllz.supabase.co"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Anon Key (Publishable)</label>
              <input
                type="text"
                name="supabaseKey"
                value={settings.supabaseKey}
                onChange={handleChange}
                placeholder="eyJhbGciOi..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all font-mono text-sm"
              />
            </div>
          </div>
        </div>

        {/* Card Auth */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
              <Key size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Autentificare (Service Role Alternative)</h2>
              <p className="text-sm text-slate-500">Un cont cu drepturi (ex. admin) pentru a citi toate comenzile din cloud.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Email Cont</label>
              <input
                type="email"
                name="supabaseEmail"
                value={settings.supabaseEmail}
                onChange={handleChange}
                placeholder="desktop@goodnessbaker.uk"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Parolă</label>
              <input
                type="password"
                name="supabasePassword"
                value={settings.supabasePassword}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Card Issuer Info */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center">
              <Building2 size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Date Emitent (Furnizor)</h2>
              <p className="text-sm text-slate-500">Acestea vor apărea sus pe facturile PDF generate.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Nume Companie (Ex: SC Patiserie SRL)</label>
              <input
                type="text"
                name="issuerName"
                value={settings.issuerName}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">CUI / CIF</label>
              <input
                type="text"
                name="issuerCui"
                value={settings.issuerCui}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Serie Factură</label>
              <input
                type="text"
                name="invoiceSeries"
                value={settings.invoiceSeries}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Număr de început</label>
              <input
                type="number"
                name="invoiceStartNumber"
                value={settings.invoiceStartNumber}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

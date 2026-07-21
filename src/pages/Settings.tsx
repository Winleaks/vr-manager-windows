import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Database, 
  Settings as SettingsIcon, 
  Cloud,
  FileText,
  Users
} from 'lucide-react';
import { SettingsSystem } from './SettingsSystem';
import { SettingsEntities } from './SettingsEntities';
import { BillingSettings } from './BillingSettings';

type Tab = 'system' | 'entities' | 'billing';

export function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('system');

  return (
    <div className="min-h-screen bg-slate-50 p-8 md:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-slate-800 text-white flex items-center justify-center shadow-sm flex-shrink-0">
              <SettingsIcon size={26} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Hub Setări</h1>
              <p className="text-slate-500 text-sm">Configurări globale pentru Stoc Fabrica, Facturare și Personal</p>
            </div>
          </div>

          <Link 
            to="/" 
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-colors shadow-sm"
          >
            <ArrowLeft size={18} />
            Înapoi la Hub
          </Link>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* Sidebar Menu */}
          <div className="w-full lg:w-72 flex-shrink-0">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-2 sticky top-8">
              <button
                onClick={() => setActiveTab('system')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all text-left ${
                  activeTab === 'system' 
                    ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm' 
                    : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                }`}
              >
                <div className={`p-2 rounded-lg ${activeTab === 'system' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                  <Cloud size={18} />
                </div>
                Sistem & Cloud
              </button>
              
              <button
                onClick={() => setActiveTab('billing')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all text-left ${
                  activeTab === 'billing' 
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-sm' 
                    : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                }`}
              >
                <div className={`p-2 rounded-lg ${activeTab === 'billing' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                  <FileText size={18} />
                </div>
                Facturare & Supabase
              </button>

              <button
                onClick={() => setActiveTab('entities')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all text-left ${
                  activeTab === 'entities' 
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm' 
                    : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                }`}
              >
                <div className={`p-2 rounded-lg ${activeTab === 'entities' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                  <Users size={18} />
                </div>
                Personal & Nomenclatoare
              </button>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1">
            {activeTab === 'system' && <SettingsSystem />}
            {activeTab === 'billing' && <BillingSettings />}
            {activeTab === 'entities' && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <SettingsEntities />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

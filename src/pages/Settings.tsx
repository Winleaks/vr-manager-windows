import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft,
  Cloud,
  FileText,
  Users,
  Settings as SettingsIcon,
  ShieldCheck
} from 'lucide-react';

export function Settings() {
  const navigate = useNavigate();

  const settingsModules = [
    {
      id: 'system',
      title: 'Sistem & Cloud',
      description: 'Copii de siguranță (Google Drive), backup local și actualizări de sistem.',
      icon: Cloud,
      color: 'bg-blue-500',
      hoverColor: 'hover:bg-blue-600',
      path: '/setari/sistem'
    },
    {
      id: 'billing',
      title: 'Facturare (UK) & Supabase',
      description: 'Design PDF, Logo, date firmă UK (CRN/VAT, Account No) și conexiune Cloud API.',
      icon: FileText,
      color: 'bg-indigo-500',
      hoverColor: 'hover:bg-indigo-600',
      path: '/setari/facturare'
    },
    {
      id: 'entities',
      title: 'Personal & Nomenclatoare',
      description: 'Gestiune șoferi, angajați, clienți, firme, magazine și categorii de bază.',
      icon: Users,
      color: 'bg-emerald-500',
      hoverColor: 'hover:bg-emerald-600',
      path: '/setari/personal'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-8 md:p-12">
      <div className="max-w-6xl mx-auto w-full">
        <header className="mb-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 text-white flex items-center justify-center shadow-lg shadow-slate-200 flex-shrink-0">
              <SettingsIcon size={30} />
            </div>
            <div>
              <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">
                Hub Setări
              </h1>
              <p className="text-slate-500 mt-2 text-lg">
                Selectează ramura de configurări pe care dorești să o modifici
              </p>
            </div>
          </div>
          <button 
            onClick={() => navigate('/')}
            className="mt-4 md:mt-0 flex items-center gap-2 bg-white text-slate-700 px-6 py-3 rounded-full font-bold shadow-sm border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft size={20} />
            Înapoi la Hub
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {settingsModules.map((mod) => (
            <div
              key={mod.id}
              onClick={() => navigate(mod.path)}
              className="relative overflow-hidden rounded-2xl p-6 transition-all duration-300 bg-white shadow-md hover:shadow-xl cursor-pointer border border-slate-100 hover:-translate-y-1 group"
            >
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-6 shadow-sm transition-colors ${mod.color}`}>
                <mod.icon className="w-7 h-7 text-white" />
              </div>
              
              <h3 className="text-xl font-bold mb-2 text-slate-800">
                {mod.title}
              </h3>
              
              <p className="text-sm leading-relaxed text-slate-500">
                {mod.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

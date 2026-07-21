import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Package, 
  Banknote, 
  TrendingUp, 
  Wallet, 
  Users, 
  Box, 
  Trash2,
  Lock,
  RefreshCw,
  Settings,
  Clock
} from 'lucide-react';
import { api } from '../shared/api';

const modules = [
  {
    id: 'stocuri',
    title: 'Stocuri / Producție',
    description: 'Management rețete, materii prime și producție zilnică.',
    icon: Package,
    color: 'bg-blue-500',
    hoverColor: 'hover:bg-blue-600',
    active: true,
    path: '/stoc/dashboard'
  },
  {
    id: 'cash',
    title: 'Daily Cash',
    description: 'Evidența banilor la zi (Încasări, Vânzări Directe, Plăți).',
    icon: Banknote,
    color: 'bg-emerald-500',
    hoverColor: 'hover:bg-emerald-600',
    active: true,
    path: '/daily-cash'
  },
  {
    id: 'vanzari',
    title: 'Vânzări Lunare',
    description: 'Statistici și rapoarte de vânzări (În construcție).',
    icon: TrendingUp,
    color: 'bg-indigo-500',
    hoverColor: 'hover:bg-indigo-600',
    active: false,
  },
  {
    id: 'incasari',
    title: 'Încasări Lunare',
    description: 'Urmărirea facturilor și a plăților (În construcție).',
    icon: Wallet,
    color: 'bg-teal-500',
    hoverColor: 'hover:bg-teal-600',
    active: false,
  },
  {
    id: 'salarii',
    title: 'Salarii',
    description: 'Gestiune angajați și state de plată (În construcție).',
    icon: Users,
    color: 'bg-violet-500',
    hoverColor: 'hover:bg-violet-600',
    active: false,
  },
  {
    id: 'lazi',
    title: 'Evidență Lăzi',
    description: 'Urmărire retur lăzi marfă (În construcție).',
    icon: Box,
    color: 'bg-orange-500',
    hoverColor: 'hover:bg-orange-600',
    active: false,
  },
  {
    id: 'rebuturi',
    title: 'Rebuturi',
    description: 'Managementul pierderilor și rebuturilor (În construcție).',
    icon: Trash2,
    color: 'bg-red-500',
    hoverColor: 'hover:bg-red-600',
    active: false,
  },
  {
    id: 'setari',
    title: 'Setări & Backup Bază de Date',
    description: 'Copii de siguranță (pentru tot Hub-ul), actualizări și preferințe.',
    icon: Settings,
    color: 'bg-slate-700',
    hoverColor: 'hover:bg-slate-800',
    active: true,
    path: '/setari'
  }
];

export function Hub() {
  const navigate = useNavigate();
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  useEffect(() => {
    fetchLastBackup();
    const unsubscribe = api.system.onBackupCompleted(() => {
      fetchLastBackup();
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const fetchLastBackup = async () => {
    const time = await api.system.getLastBackupTime();
    if (time) setLastBackup(time);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-8 md:p-12">
      <div className="max-w-6xl mx-auto w-full">
        <header className="mb-12 text-center md:text-left flex flex-col md:flex-row justify-between items-center">
          <div>
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">
              VR - Management Hub
            </h1>
            <p className="text-slate-500 mt-2 text-lg">
              Selectează modulul pe care dorești să îl accesezi
            </p>
          </div>
          <div className="mt-4 md:mt-0 flex items-center space-x-4">
            {lastBackup && (
              <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-medium border border-blue-100 shadow-sm">
                <Clock size={16} />
                Ultimul backup: {lastBackup}
              </div>
            )}
            <div className="flex items-center space-x-2 text-sm text-slate-400 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-100">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span>Sistem Online</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {modules.map((mod) => (
            <div
              key={mod.id}
              onClick={() => mod.active && mod.path && navigate(mod.path)}
              className={`relative overflow-hidden rounded-2xl p-6 transition-all duration-300 ${
                mod.active 
                  ? 'bg-white shadow-md hover:shadow-xl cursor-pointer border border-slate-100 hover:-translate-y-1 group' 
                  : 'bg-slate-100/50 cursor-not-allowed border border-slate-200/50'
              }`}
            >
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-6 shadow-sm transition-colors ${mod.active ? mod.color : 'bg-slate-300'}`}>
                <mod.icon className="w-7 h-7 text-white" />
              </div>
              
              <h3 className={`text-xl font-bold mb-2 ${mod.active ? 'text-slate-800' : 'text-slate-500'}`}>
                {mod.title}
              </h3>
              
              <p className={`text-sm leading-relaxed ${mod.active ? 'text-slate-500' : 'text-slate-400'}`}>
                {mod.description}
              </p>

              {!mod.active && (
                <div className="absolute top-6 right-6">
                  <Lock className="w-5 h-5 text-slate-300" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

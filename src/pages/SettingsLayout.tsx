import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings } from 'lucide-react';

export function SettingsLayout() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-8 md:p-12">
      <div className="max-w-6xl mx-auto w-full space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-slate-800 text-white flex items-center justify-center shadow-sm flex-shrink-0">
              <Settings size={26} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Setări</h1>
              <p className="text-slate-500 text-sm">Configurare avansată sistem</p>
            </div>
          </div>

          <button 
            onClick={() => navigate('/setari')}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-colors shadow-sm cursor-pointer"
          >
            <ArrowLeft size={18} />
            Înapoi la Hub Setări
          </button>
        </div>

        {/* Content Area */}
        <div className="bg-transparent">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

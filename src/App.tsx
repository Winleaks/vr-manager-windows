import React from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Wheat, CakeSlice, Settings, ArrowRightLeft, History } from 'lucide-react';
import RawMaterials from './pages/RawMaterials';
import FinishedProducts from './pages/FinishedProducts';
import Production from './pages/Production';
import StockMovements from './pages/StockMovements';

import Dashboard from './pages/Dashboard';
import { Hub } from './pages/Hub';
import { Settings as SettingsPage } from './pages/Settings';
import { DailyCash } from './pages/DailyCash';
import { DailyCashLayout } from './pages/DailyCashLayout';
import { Banknote } from 'lucide-react';

function Sidebar() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="w-64 bg-slate-900 text-white flex flex-col h-screen shadow-xl z-10 relative">
      <div className="p-6 text-xl font-bold border-b border-slate-800 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <Wheat size={18} className="text-white" />
        </div>
        Patiserie
      </div>
      <nav className="flex-1 p-4 space-y-1">
        <Link to="/" className="flex items-center gap-3 p-3 rounded-lg font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors mb-4">
          <Settings size={20} />
          Înapoi la Hub
        </Link>
        <Link to="/stoc/dashboard" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/stoc/dashboard') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <LayoutDashboard size={20} />
          Dashboard
        </Link>
        <Link to="/stoc/materii-prime" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/stoc/materii-prime') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <Wheat size={20} />
          Materii Prime
        </Link>
        <Link to="/stoc/produse-finite" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/stoc/produse-finite') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <CakeSlice size={20} />
          Produse Finite
        </Link>
        <Link to="/stoc/productie" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/stoc/productie') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <ArrowRightLeft size={20} />
          Producție
        </Link>
        <Link to="/stoc/miscari-stoc" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/stoc/miscari-stoc') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <History size={20} />
          Mișcări Stoc
        </Link>
      </nav>
    </div>
  );
}

function StocLayout() {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/materii-prime" element={<RawMaterials />} />
          <Route path="/produse-finite" element={<FinishedProducts />} />
          <Route path="/productie" element={<Production />} />
          <Route path="/miscari-stoc" element={<StockMovements />} />
          <Route path="*" element={<div className="p-8">În lucru...</div>} />
        </Routes>
      </main>
    </div>
  );
}


import { UpdateModal } from './components/UpdateModal';

export default function App() {
  return (
    <>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Hub />} />
          <Route path="/setari" element={<SettingsPage />} />
          <Route path="/daily-cash/*" element={<DailyCashLayout />} />
          <Route path="/stoc/*" element={<StocLayout />} />
        </Routes>
      </HashRouter>
      <UpdateModal />
    </>
  );
}

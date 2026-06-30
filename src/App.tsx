import React from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Wheat, CakeSlice, Settings, ArrowRightLeft, History } from 'lucide-react';
import RawMaterials from './pages/RawMaterials';
import FinishedProducts from './pages/FinishedProducts';
import Production from './pages/Production';
import StockMovements from './pages/StockMovements';

import Dashboard from './pages/Dashboard';

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
        <Link to="/" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <LayoutDashboard size={20} />
          Dashboard
        </Link>
        <Link to="/materii-prime" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/materii-prime') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <Wheat size={20} />
          Materii Prime
        </Link>
        <Link to="/produse-finite" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/produse-finite') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <CakeSlice size={20} />
          Produse Finite
        </Link>
        <Link to="/productie" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/productie') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <ArrowRightLeft size={20} />
          Producție
        </Link>
        <Link to="/miscari-stoc" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/miscari-stoc') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <History size={20} />
          Mișcări Stoc
        </Link>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/materii-prime" element={<RawMaterials />} />
            <Route path="/produse-finite" element={<FinishedProducts />} />
            <Route path="/productie" element={<Production />} />
            <Route path="/miscari-stoc" element={<StockMovements />} />
            <Route path="*" element={<div className="p-8">În lucru...</div>} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

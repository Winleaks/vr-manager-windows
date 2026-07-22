import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, FileText, Settings, ArrowLeft, Users, Receipt, Package } from 'lucide-react';
import { BillingDashboard } from './BillingDashboard';
import { BillingClients } from './BillingClients';
import { BillingInvoices } from './BillingInvoices';
import { BillingSettings } from './BillingSettings';
import { BillingProducts } from './BillingProducts';

function Sidebar() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="w-64 bg-slate-900 text-white flex flex-col h-screen shadow-xl z-10 relative">
      <div className="p-6 text-xl font-bold border-b border-slate-800 flex items-center gap-3">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
          <FileText size={18} className="text-white" />
        </div>
        Facturare
      </div>
      <nav className="flex-1 p-4 space-y-1">
        <Link to="/" className="flex items-center gap-3 p-3 rounded-lg font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors mb-4">
          <ArrowLeft size={20} />
          Înapoi la Hub
        </Link>
        <Link to="/facturare/dashboard" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/facturare/dashboard') ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <LayoutDashboard size={20} />
          Dashboard
        </Link>
        <Link to="/facturare/facturi" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/facturare/facturi') ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <Receipt size={20} />
          Facturi
        </Link>
        <Link to="/facturare/clienti" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/facturare/clienti') ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <Users size={20} />
          Clienți & Entități
        </Link>
        <Link to="/facturare/produse" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/facturare/produse') ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <Package size={20} />
          Produse
        </Link>
        <Link to="/facturare/setari" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/facturare/setari') ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <Settings size={20} />
          Setări Facturare
        </Link>
      </nav>
    </div>
  );
}

export function BillingLayout() {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/dashboard" element={<BillingDashboard />} />
          <Route path="/facturi" element={<BillingInvoices />} />
          <Route path="/clienti" element={<BillingClients />} />
          <Route path="/produse" element={<BillingProducts />} />
          <Route path="/setari" element={<BillingSettings />} />
          <Route path="*" element={<div className="p-8">În lucru...</div>} />
        </Routes>
      </main>
    </div>
  );
}

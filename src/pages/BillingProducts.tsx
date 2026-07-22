import React, { useState, useEffect } from 'react';
import { api } from '../shared/api';
import { Package, RefreshCw, AlertCircle, Tag } from 'lucide-react';

export function BillingProducts() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const data = await api.billing.getProducts();
      setProducts(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncWithServer = async () => {
    try {
      setSyncing(true);
      await api.billing.syncProducts();
      await fetchProducts();
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Produse Platformă</h1>
          <p className="text-slate-500 mt-2">Nomenclatorul complet cu produsele noastre preluate și sincronizate de pe site/server.</p>
        </div>
        <button 
          onClick={handleSyncWithServer}
          disabled={syncing}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium shadow-sm shadow-indigo-600/30 transition-colors"
        >
          <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
          Sincronizează cu Serverul
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <RefreshCw className="animate-spin text-indigo-500" size={32} />
        </div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
          <Package size={48} className="mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-bold text-slate-700 mb-2">Niciun produs găsit</h3>
          <p className="text-slate-500 max-w-md mx-auto mb-6">Nu există produse în baza de date locală. Apasă pe butonul de mai sus pentru a le descărca direct de pe server.</p>
          <button 
            onClick={handleSyncWithServer}
            disabled={syncing}
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium shadow-sm hover:bg-indigo-700 transition-colors"
          >
            <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
            Descarcă Produsele de pe Server
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <Package size={20} className="text-indigo-600" />
              Lista Produselor ({products.length})
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-medium">Denumire Produs</th>
                  <th className="px-6 py-4 font-medium">Categorie</th>
                  <th className="px-6 py-4 font-medium">Unitate Măsură</th>
                  <th className="px-6 py-4 font-medium text-right">Preț Referință</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-800">
                      {p.name}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-md text-xs font-medium">
                        <Tag size={12} />
                        {p.category || 'General'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {p.unit || 'buc'}
                    </td>
                    <td className="px-6 py-4 font-bold text-right text-emerald-600">
                      {p.price ? `£${Number(p.price).toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

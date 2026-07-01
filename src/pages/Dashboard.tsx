import { useState, useEffect } from 'react';
import { api } from '../shared/api';
import { exportToExcel, exportToPDF } from '../utils/exports';
import { Package, AlertTriangle, TrendingUp, Download } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalRawMaterials: 0,
    alerts: 0,
    productionsToday: 0
  });

  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [productions, setProductions] = useState<any[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const rm = await api.rawMaterials.getAll();
      const prod = await api.productions.getAll();
      
      setRawMaterials(rm);
      setProductions(prod);

      const alerts = rm.filter((r: any) => r.current_stock <= r.minimum_stock);
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayProd = prod.filter((p: any) => p.production_date === todayStr);

      setStats({
        totalRawMaterials: rm.length,
        alerts: alerts.length,
        productionsToday: todayProd.length
      });
    } catch (err) {
      console.error("Error loading dashboard data", err);
    }
  };

  const handleExportInventarExcel = () => {
    const data = rawMaterials.map(rm => ({
      'ID': rm.id,
      'Denumire': rm.name,
      'Categorie': rm.category_name || 'N/A',
      'Stoc Curent': rm.current_stock,
      'Stoc Minim': rm.minimum_stock,
      'Unitate': rm.unit,
      'Status': rm.current_stock <= rm.minimum_stock ? 'ALERTĂ' : 'OK'
    }));
    exportToExcel(data, `Inventar_${new Date().toISOString().slice(0, 10)}`);
  };

  const handleExportInventarPDF = () => {
    const headers = ['Denumire', 'Categorie', 'Stoc Curent', 'Stoc Minim', 'UM', 'Status'];
    const data = rawMaterials.map(rm => [
      rm.name,
      rm.category_name || '-',
      rm.current_stock.toString(),
      rm.minimum_stock.toString(),
      rm.unit,
      rm.current_stock <= rm.minimum_stock ? 'ALERTĂ' : 'OK'
    ]);
    exportToPDF(headers, data, `Inventar_${new Date().toISOString().slice(0, 10)}`, 'Raport Inventar Materii Prime');
  };

  const handleExportProductieExcel = () => {
    const data = productions.map(p => ({
      'Data': p.production_date,
      'Produs Finit': p.product_name,
      'Cantitate': p.quantity_produced,
      'UM': p.production_unit,
      'Note': p.notes || ''
    }));
    exportToExcel(data, `Productie_${new Date().toISOString().slice(0, 10)}`);
  };

  const handleExportProductiePDF = () => {
    const headers = ['Data', 'Produs Finit', 'Cantitate Produsă', 'UM', 'Note'];
    const data = productions.map(p => [
      p.production_date,
      p.product_name,
      p.quantity_produced.toString(),
      p.production_unit,
      p.notes || ''
    ]);
    exportToPDF(headers, data, `Productie_${new Date().toISOString().slice(0, 10)}`, 'Raport Producție');
  };

  const alertItems = rawMaterials.filter((r: any) => r.current_stock <= r.minimum_stock);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Dashboard & Rapoarte</h1>
          <p className="text-slate-500 mt-2">Privire de ansamblu asupra fabricii și generare rapoarte.</p>
        </div>
      </div>
      
      {/* Statistici */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-5">
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
            <Package size={28} />
          </div>
          <div>
            <p className="text-slate-500 text-sm font-medium uppercase tracking-wide">Materii Prime</p>
            <p className="text-3xl font-bold text-slate-800">{stats.totalRawMaterials}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100 flex items-center gap-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-2 h-full bg-red-500"></div>
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-red-600">
            <AlertTriangle size={28} />
          </div>
          <div>
            <p className="text-slate-500 text-sm font-medium uppercase tracking-wide">Alerte Stoc Minim</p>
            <p className="text-3xl font-bold text-red-600">{stats.alerts}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-5">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
            <TrendingUp size={28} />
          </div>
          <div>
            <p className="text-slate-500 text-sm font-medium uppercase tracking-wide">Producții Astăzi</p>
            <p className="text-3xl font-bold text-slate-800">{stats.productionsToday}</p>
          </div>
        </div>
      </div>

      {/* Alerte Stoc Minim - Lista Produse */}
      {alertItems.length > 0 ? (
        <div className="bg-red-50/60 border border-red-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center font-bold">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-red-900">Alerte Stoc Minim (Necesită Aprovizionare)</h2>
                <p className="text-sm text-red-700">Următoarele materii prime au ajuns la stocul minim sau sub acesta:</p>
              </div>
            </div>
            <span className="bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
              {alertItems.length} {alertItems.length === 1 ? 'produs' : 'produse'} în alertă
            </span>
          </div>

          <div className="bg-white rounded-xl border border-red-100 overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-red-50/60 text-red-900 border-b border-red-100 text-xs uppercase tracking-wider">
                  <th className="p-3.5 font-semibold">Materie Primă</th>
                  <th className="p-3.5 font-semibold">Categorie</th>
                  <th className="p-3.5 font-semibold text-right">Stoc Curent</th>
                  <th className="p-3.5 font-semibold text-right">Stoc Minim</th>
                  <th className="p-3.5 font-semibold">UM</th>
                  <th className="p-3.5 font-semibold text-center">Deficit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-50 text-sm">
                {alertItems.map((item, index) => {
                  const deficit = item.minimum_stock - item.current_stock;
                  return (
                    <tr key={index} className="hover:bg-red-50/30 transition-colors">
                      <td className="p-3.5 font-bold text-slate-800">{item.name}</td>
                      <td className="p-3.5 text-slate-600">
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-medium">
                          {item.category_name || '-'}
                        </span>
                      </td>
                      <td className="p-3.5 text-right font-extrabold text-red-600">
                        {item.current_stock}
                      </td>
                      <td className="p-3.5 text-right font-medium text-slate-600">
                        {item.minimum_stock}
                      </td>
                      <td className="p-3.5 text-slate-500 font-medium">{item.unit}</td>
                      <td className="p-3.5 text-center">
                        <span className="bg-red-100 text-red-800 font-bold px-2 py-0.5 rounded text-xs">
                          {deficit > 0 ? `-${deficit.toFixed(2)} ${item.unit}` : 'La limită'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-6 flex items-center gap-4 shadow-sm">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold flex-shrink-0">
            <TrendingUp size={24} />
          </div>
          <div>
            <h3 className="text-base font-bold text-emerald-900">Toate stocurile sunt în regulă!</h3>
            <p className="text-sm text-emerald-700">Nicio materie primă nu se află sub pragul de stoc minim.</p>
          </div>
        </div>
      )}

      {/* Rapoarte */}
      <h2 className="text-xl font-bold text-slate-800 pt-4">Generare Rapoarte</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Raport Inventar */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Raport Inventar</h3>
          <p className="text-slate-500 text-sm mb-6">Descarcă stadiul curent al stocului pentru materii prime.</p>
          <div className="flex gap-3">
            <button 
              onClick={handleExportInventarExcel}
              className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-lg font-medium transition-colors"
            >
              <Download size={18} /> Excel
            </button>
            <button 
              onClick={handleExportInventarPDF}
              className="flex-1 flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white py-2.5 rounded-lg font-medium transition-colors"
            >
              <Download size={18} /> PDF
            </button>
          </div>
        </div>

        {/* Raport Productie */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Raport Producție</h3>
          <p className="text-slate-500 text-sm mb-6">Descarcă istoricul complet al producțiilor înregistrate.</p>
          <div className="flex gap-3">
            <button 
              onClick={handleExportProductieExcel}
              className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-lg font-medium transition-colors"
            >
              <Download size={18} /> Excel
            </button>
            <button 
              onClick={handleExportProductiePDF}
              className="flex-1 flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white py-2.5 rounded-lg font-medium transition-colors"
            >
              <Download size={18} /> PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

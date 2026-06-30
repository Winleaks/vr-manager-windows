import { useState, useEffect } from 'react';
import { api } from '../shared/api';
import { exportToExcel, exportToPDF } from '../utils/exports';
import { Package, AlertTriangle, TrendingUp, Download, Upload, Clock } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalRawMaterials: 0,
    alerts: 0,
    productionsToday: 0
  });

  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [productions, setProductions] = useState<any[]>([]);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
    fetchLastBackup();

    api.system.onBackupCompleted(() => {
      fetchLastBackup();
    });
  }, []);

  const fetchLastBackup = async () => {
    const time = await api.system.getLastBackupTime();
    if (time) setLastBackup(time);
  };

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

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Dashboard & Rapoarte</h1>
          <p className="text-slate-500 mt-2">Privire de ansamblu asupra fabricii și generare rapoarte.</p>
        </div>
        
        {lastBackup && (
          <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-xl text-sm font-medium border border-blue-100 shadow-sm">
            <Clock size={16} />
            Ultimul backup automat: {lastBackup}
          </div>
        )}
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

        {/* Backup Bază de Date */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 md:col-span-2">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold text-slate-800 mb-1">Backup Bază de Date</h3>
              <p className="text-slate-500 text-sm">Creează o copie de siguranță (backup) a întregii baze de date pentru a preveni pierderea informațiilor. Alege tu folderul unde vrei să o salvezi (ex. pe un stick USB sau Google Drive).</p>
            </div>
            <div className="flex flex-col gap-3 ml-6 flex-shrink-0">
              <button 
                onClick={async () => {
                  const res = await api.system.manualBackup();
                  if (res.success) {
                    alert(`Backup creat cu succes la:\n${res.path}`);
                  } else if (!res.canceled) {
                    alert(`Eroare la creare backup: ${res.error}`);
                  }
                }}
                className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
              >
                <Download size={18} /> Salvează Backup
              </button>
              <button 
                onClick={async () => {
                  if (window.confirm('Ești sigur că vrei să încarci un backup? Această acțiune va suprascrie baza de date curentă și programul se va restarta.')) {
                    const res = await api.system.restoreBackup();
                    if (res.success) {
                      window.location.reload();
                    } else if (!res.canceled) {
                      alert('A apărut o eroare la restaurarea bazei de date.');
                    }
                  }
                }}
                className="flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-6 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
              >
                <Upload size={18} /> Încarcă Bază de Date
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { api } from '../shared/api';

export default function StockMovements() {
  const [movements, setMovements] = useState<any[]>([]);
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    raw_material_id: '',
    new_stock: '',
    reason: ''
  });

  const loadData = async () => {
    try {
      const [movs, mats] = await Promise.all([
        api.stockMovements.getAll(100),
        api.rawMaterials.getAll()
      ]);
      setMovements(movs);
      setRawMaterials(mats);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.raw_material_id || !formData.new_stock || !formData.reason) {
      alert("Completati toate campurile");
      return;
    }

    try {
      await api.stockMovements.adjustStock(
        Number(formData.raw_material_id),
        Number(formData.new_stock),
        formData.reason
      );
      setIsAdjustModalOpen(false);
      setFormData({ raw_material_id: '', new_stock: '', reason: '' });
      loadData();
    } catch (err) {
      alert("Eroare la ajustare!");
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-800">Istoric & Ajustare Stoc</h1>
        <button 
          onClick={() => setIsAdjustModalOpen(true)}
          className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded shadow-md transition-colors font-medium"
        >
          + Ajustare Manuală
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-lg font-semibold text-slate-700">Ultimele 100 de mișcări</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-sm uppercase tracking-wider">
                <th className="p-4 border-b">Data / Ora</th>
                <th className="p-4 border-b">Materia Primă</th>
                <th className="p-4 border-b">Tip Mișcare</th>
                <th className="p-4 border-b">Cantitate</th>
                <th className="p-4 border-b">Stoc Înainte</th>
                <th className="p-4 border-b">Stoc După</th>
                <th className="p-4 border-b">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    Nu există înregistrări.
                  </td>
                </tr>
              ) : (
                movements.map((mov) => (
                  <tr key={mov.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 text-sm text-slate-600">
                      {new Date(mov.created_at).toLocaleString('ro-RO')}
                    </td>
                    <td className="p-4 font-medium text-slate-800">
                      {mov.raw_material_name}
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        mov.movement_type === 'intrare' ? 'bg-green-100 text-green-800' :
                        mov.movement_type === 'consum' ? 'bg-blue-100 text-blue-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {mov.movement_type.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-4 text-slate-700">
                      {mov.quantity} {mov.unit}
                    </td>
                    <td className="p-4 text-slate-500">{mov.stock_before}</td>
                    <td className="p-4 font-semibold text-slate-700">{mov.stock_after}</td>
                    <td className="p-4 text-sm text-slate-500">{mov.notes}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Ajustare */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-slate-800">Ajustare Manuală Stoc</h2>
              <button 
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleAdjustSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Materia Primă</label>
                <select 
                  className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={formData.raw_material_id}
                  onChange={(e) => setFormData({...formData, raw_material_id: e.target.value})}
                  required
                >
                  <option value="">-- Selectează --</option>
                  {rawMaterials.map(rm => (
                    <option key={rm.id} value={rm.id}>
                      {rm.name} (Stoc curent: {rm.current_stock} {rm.unit})
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Noul Stoc (Realitate)</label>
                <input 
                  type="number" 
                  step="0.01"
                  className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={formData.new_stock}
                  onChange={(e) => setFormData({...formData, new_stock: e.target.value})}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Motiv / Notă</label>
                <textarea 
                  className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={formData.reason}
                  onChange={(e) => setFormData({...formData, reason: e.target.value})}
                  placeholder="Ex: Inventar, pierderi, expirare..."
                  required
                  rows={2}
                ></textarea>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
                >
                  Anulează
                </button>
                <button 
                  type="submit"
                  className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg shadow-sm transition-colors font-medium"
                >
                  Salvează Ajustarea
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { api } from '../shared/api';
import { Plus, Edit, Trash2, X } from 'lucide-react';

export default function RawMaterials() {
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  const [formData, setFormData] = useState({
    name: '',
    category_id: '',
    unit: 'kg',
    current_stock: 0,
    minimum_stock: 0,
    notes: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const data = await api.rawMaterials.getAll();
    setItems(data);
    const cats = await api.categories.get('raw_material');
    setCategories(cats);
  };

  const handleOpenModal = (item?: any) => {
    if (item) {
      setEditingItem(item);
      setFormData({
        name: item.name,
        category_id: item.category_id?.toString() || '',
        unit: item.unit,
        current_stock: item.current_stock,
        minimum_stock: item.minimum_stock,
        notes: item.notes || ''
      });
    } else {
      setEditingItem(null);
      setFormData({
        name: '',
        category_id: '',
        unit: 'kg',
        current_stock: 0,
        minimum_stock: 0,
        notes: ''
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...formData,
      category_id: formData.category_id ? parseInt(formData.category_id) : null,
      current_stock: parseFloat(formData.current_stock.toString()),
      minimum_stock: parseFloat(formData.minimum_stock.toString())
    };

    try {
      if (editingItem) {
        await api.rawMaterials.update(editingItem.id, payload);
      } else {
        await api.rawMaterials.add(payload);
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      alert("Eroare la salvare! Posibil nume duplicat.");
      console.error(err);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Materii Prime</h1>
          <p className="text-slate-500 mt-1">Gestionare stoc și ingrediente de bază</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-colors"
        >
          <Plus size={20} />
          Adaugă Materie Primă
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 text-sm uppercase tracking-wider">
              <th className="p-4 font-semibold">Nume</th>
              <th className="p-4 font-semibold">Categorie</th>
              <th className="p-4 font-semibold text-right">Stoc Curent</th>
              <th className="p-4 font-semibold">UM</th>
              <th className="p-4 font-semibold text-right">Stoc Minim</th>
              <th className="p-4 font-semibold text-center">Acțiuni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="p-4 font-medium text-slate-800">{item.name}</td>
                <td className="p-4 text-slate-600">
                  <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md text-xs font-medium">
                    {item.category_name || '-'}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <span className={`font-bold ${item.current_stock <= item.minimum_stock ? 'text-red-600' : 'text-green-600'}`}>
                    {item.current_stock}
                  </span>
                </td>
                <td className="p-4 text-slate-500">{item.unit}</td>
                <td className="p-4 text-right text-slate-500">{item.minimum_stock}</td>
                <td className="p-4 text-center">
                  <button 
                    onClick={() => handleOpenModal(item)}
                    className="p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <Edit size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  Nu există materii prime adăugate.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">
                {editingItem ? 'Editare Materie Primă' : 'Adaugă Materie Primă'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nume Materie Primă</label>
                <input 
                  type="text" required
                  value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Categorie</label>
                  <select 
                    value={formData.category_id} onChange={e => setFormData({...formData, category_id: e.target.value})}
                    className="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="">Fără categorie</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unitate Măsură</label>
                  <select 
                    value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})}
                    className="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="kg">Kilograme (kg)</option>
                    <option value="g">Grame (g)</option>
                    <option value="L">Litri (L)</option>
                    <option value="ml">Mililitri (ml)</option>
                    <option value="buc">Bucăți (buc)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Stoc Curent</label>
                  <input 
                    type="number" step="0.001" required
                    value={formData.current_stock} onChange={e => setFormData({...formData, current_stock: parseFloat(e.target.value)})}
                    className="w-full border border-slate-300 rounded-lg p-2.5 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Stoc Minim (Alertă)</label>
                  <input 
                    type="number" step="0.001" required
                    value={formData.minimum_stock} onChange={e => setFormData({...formData, minimum_stock: parseFloat(e.target.value)})}
                    className="w-full border border-slate-300 rounded-lg p-2.5 outline-none"
                  />
                </div>
              </div>
              <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">
                  Anulează
                </button>
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors shadow-sm">
                  Salvează
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

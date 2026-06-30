import React, { useState, useEffect } from 'react';
import { api } from '../shared/api';
import { Plus, Check, Factory } from 'lucide-react';

export default function Production() {
  const [productions, setProductions] = useState<any[]>([]);
  const [finishedProducts, setFinishedProducts] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [productionDate, setProductionDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ finished_product_id: '', quantity_produced: 1 }]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const prods = await api.productions.getAll();
    setProductions(prods);
    const fp = await api.finishedProducts.getAll();
    setFinishedProducts(fp);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter(i => i.finished_product_id);
    if (validItems.length === 0) {
      alert("Selectați cel puțin un produs finit!");
      return;
    }

    try {
      for (const item of validItems) {
        await api.productions.add(
          parseInt(item.finished_product_id),
          parseFloat(item.quantity_produced.toString()),
          productionDate,
          notes
        );
      }
      setIsModalOpen(false);
      loadData();
      alert("Producție înregistrată cu succes! Materiile prime au fost scăzute automat.");
    } catch (err: any) {
      alert(`Eroare: ${err.message || "A apărut o problemă la înregistrare."}`);
      console.error(err);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Producție Zilnică</h1>
          <p className="text-slate-500 mt-1">Înregistrează produsele fabricate și consumul de materii prime se calculează automat.</p>
        </div>
        <button 
          onClick={() => {
            setProductionDate(new Date().toISOString().split('T')[0]);
            setNotes('');
            setItems([{ finished_product_id: '', quantity_produced: 1 }]);
            setIsModalOpen(true);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-colors"
        >
          <Factory size={20} />
          Înregistrează Producție
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 text-sm uppercase tracking-wider">
              <th className="p-4 font-semibold">Data</th>
              <th className="p-4 font-semibold">Produs Finit</th>
              <th className="p-4 font-semibold text-right">Cantitate</th>
              <th className="p-4 font-semibold">UM</th>
              <th className="p-4 font-semibold">Note</th>
              <th className="p-4 font-semibold text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {productions.map((item, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="p-4 text-slate-800 font-medium">{item.production_date}</td>
                <td className="p-4 text-blue-700 font-semibold">{item.product_name}</td>
                <td className="p-4 text-right font-bold text-slate-800">{item.quantity_produced}</td>
                <td className="p-4 text-slate-500">{item.production_unit}</td>
                <td className="p-4 text-slate-500 text-sm">{item.notes || '-'}</td>
                <td className="p-4 text-center">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    <Check size={12} /> Confirmat
                  </span>
                </td>
              </tr>
            ))}
            {productions.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  Nu ai înregistrat încă nicio producție.
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
              <h2 className="text-xl font-bold text-slate-800">Înregistrare Producție</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                &times;
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Data Producției</label>
                <input 
                  type="date" required
                  value={productionDate} onChange={e => setProductionDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="block text-sm font-medium text-slate-700">Produse Fabricate</label>
                  <button 
                    type="button" 
                    onClick={() => setItems([...items, { finished_product_id: '', quantity_produced: 1 }])}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1"
                  >
                    <Plus size={16} /> Adaugă produs
                  </button>
                </div>
                
                {items.map((item, index) => (
                  <div key={index} className="flex gap-3 items-end p-3 bg-slate-50 border border-slate-100 rounded-lg">
                    <div className="flex-1">
                      <select 
                        required
                        value={item.finished_product_id} 
                        onChange={e => {
                          const newItems = [...items];
                          newItems[index].finished_product_id = e.target.value;
                          setItems(newItems);
                        }}
                        className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white text-sm"
                      >
                        <option value="">-- Produs --</option>
                        {finishedProducts.map(fp => (
                          <option key={fp.id} value={fp.id}>{fp.name} (UM: {fp.production_unit})</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-24">
                      <input 
                        type="number" step="0.01" min="0.01" required placeholder="Cant"
                        value={item.quantity_produced} 
                        onChange={e => {
                          const newItems = [...items];
                          newItems[index].quantity_produced = parseFloat(e.target.value);
                          setItems(newItems);
                        }}
                        className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      />
                    </div>
                    {items.length > 1 && (
                      <button 
                        type="button"
                        onClick={() => {
                          const newItems = items.filter((_, i) => i !== index);
                          setItems(newItems);
                        }}
                        className="text-red-500 hover:text-red-700 p-2 font-bold mb-1"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Note (Opțional, de ex. "Șarja 1 - Schimb de zi")</label>
                <textarea 
                  value={notes} onChange={e => setNotes(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none h-20"
                />
              </div>
              <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">
                  Anulează
                </button>
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors shadow-sm">
                  Înregistrează
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

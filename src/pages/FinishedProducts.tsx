import React, { useCallback, useState, useEffect } from 'react';
import { api } from '../shared/api';
import { Plus, BookOpen, X, Trash2, RefreshCw, CloudDownload } from 'lucide-react';
import { NumericInput } from '../components/NumericInput';

export default function FinishedProducts() {
  const [items, setItems] = useState<any[]>([]);
  const [deviceRole, setDeviceRole] = useState<'writer' | 'viewer'>('viewer');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');

  // Recipe Modal
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<any>(null);
  const [recipeData, setRecipeData] = useState<any>({ batch_size: 1, notes: '', items: [] });
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    const data = await api.finishedProducts.getAll();
    setItems(data);
  }, []);

  const loadRawMaterials = useCallback(async () => {
    const data = await api.rawMaterials.getAll();
    setRawMaterials(data);
  }, []);

  const synchronizeProducts = useCallback(async (showSuccess = true) => {
    setSyncing(true);
    setSyncError('');
    try {
      const response = await api.finishedProducts.syncFromVrBaker();
      if (!response.success) throw new Error(response.message);
      await loadData();
      if (showSuccess) setSyncMessage(response.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Produsele nu au putut fi actualizate.';
      setSyncError(message);
      if (showSuccess) window.alert(message);
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  useEffect(() => {
    const initialize = async () => {
      await Promise.all([loadData(), loadRawMaterials()]);
      try {
        const role = await api.system.getDeviceRole();
        setDeviceRole(role.role);
        if (role.role === 'writer') await synchronizeProducts(false);
      } catch (error) {
        console.error(error);
      }
    };
    void initialize();
  }, [loadData, loadRawMaterials, synchronizeProducts]);

  const handleOpenRecipe = async (product: any) => {
    setCurrentProduct(product);
    try {
      const recipe = await api.recipes.getByProductId(product.id);
      if (recipe) {
        setRecipeData({
          batch_size: recipe.batch_size,
          notes: recipe.notes || '',
          items: recipe.items || []
        });
      } else {
        setRecipeData({ batch_size: 1, notes: '', items: [] });
      }
      setIsRecipeModalOpen(true);
    } catch (err) {
      console.error("Failed to load recipe:", err);
    }
  };

  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.recipes.save(
        currentProduct.id,
        parseFloat(recipeData.batch_size),
        recipeData.notes,
        recipeData.items.map((i: any) => ({
          raw_material_id: parseInt(i.raw_material_id),
          quantity: parseFloat(i.quantity)
        }))
      );
      setIsRecipeModalOpen(false);
    } catch (err) {
      alert("Eroare la salvarea rețetei.");
      console.error(err);
    }
  };

  const addRecipeItem = () => {
    setRecipeData({
      ...recipeData,
      items: [...recipeData.items, { raw_material_id: '', quantity: 0 }]
    });
  };

  const updateRecipeItem = (index: number, field: string, value: any) => {
    const newItems = [...recipeData.items];
    newItems[index][field] = value;
    setRecipeData({ ...recipeData, items: newItems });
  };

  const removeRecipeItem = (index: number) => {
    const newItems = [...recipeData.items];
    newItems.splice(index, 1);
    setRecipeData({ ...recipeData, items: newItems });
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Produse Finite</h1>
          <p className="text-slate-500 mt-1">Produse sincronizate automat din VR Baker Platform și rețetele locale de producție</p>
        </div>
        {deviceRole === 'writer' && (
          <button
            type="button"
            onClick={() => void synchronizeProducts(true)}
            disabled={syncing}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-colors shadow-sm"
          >
            <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Se actualizează...' : 'Actualizează produse'}
          </button>
        )}
      </div>

      {syncMessage && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{syncMessage}</div>
      )}
      {syncError && (
        <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Catalogul local este disponibil, dar actualizarea automată a eșuat: {syncError}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 text-sm uppercase tracking-wider">
              <th className="p-4 font-semibold">Nume Produs</th>
              <th className="p-4 font-semibold">Categorie</th>
              <th className="p-4 font-semibold">UM</th>
              <th className="p-4 font-semibold text-right">Preț standard</th>
              <th className="p-4 font-semibold text-right">Stoc</th>
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
                <td className="p-4 text-slate-500">{item.production_unit}</td>
                <td className="p-4 text-right font-medium text-slate-600">£{Number(item.standard_price || 0).toFixed(2)}</td>
                <td className={`p-4 text-right font-bold ${Number(item.current_stock) < 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                  {Number(item.current_stock || 0).toFixed(2)}
                </td>
                <td className="p-4 text-center">
                  <div className="flex justify-center gap-2">
                    <button
                      onClick={() => handleOpenRecipe(item)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-orange-50 text-orange-600 hover:bg-orange-100 rounded-lg text-sm font-medium transition-colors"
                      title="Editare Rețetă"
                    >
                      <BookOpen size={16} /> Rețetă
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-10 text-center text-slate-500">
                  <CloudDownload size={36} className="mx-auto mb-3 text-slate-300" />
                  Nu există produse sincronizate din VR Baker Platform.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recipe Modal */}
      {isRecipeModalOpen && currentProduct && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50">
              <div>
                <h2 className="text-xl font-bold text-slate-800">
                  Rețetă: {currentProduct.name}
                </h2>
                <p className="text-sm text-slate-500 mt-1">Configurează ingredientele necesare pentru a produce o șarjă.</p>
              </div>
              <button onClick={() => setIsRecipeModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSaveRecipe} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto flex-1">
                <div className="flex items-center gap-4 mb-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <div className="flex-1">
                    <label className="block text-sm font-semibold text-blue-900 mb-1">Cantitate rezultată (Șarjă)</label>
                    <div className="flex items-center gap-2">
                      <NumericInput
                        decimalScale={2} required
                        value={recipeData.batch_size} onValueChange={batch_size => setRecipeData((current: any) => ({...current, batch_size}))}
                        className="w-32 border border-blue-200 rounded-lg p-2 outline-none focus:border-blue-500 bg-white"
                      />
                      <span className="font-medium text-blue-800">{currentProduct.production_unit}</span>
                    </div>
                  </div>
                  <div className="flex-1 text-sm text-blue-700">
                    Sistemul va calcula automat proporțiile atunci când produci mai mult sau mai puțin decât o șarjă.
                  </div>
                </div>

                <div className="mb-4 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800">Ingrediente Necesare</h3>
                  <button
                    type="button"
                    onClick={addRecipeItem}
                    className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1"
                  >
                    <Plus size={16} /> Adaugă Ingredient
                  </button>
                </div>

                <div className="space-y-3">
                  {recipeData.items.map((item: any, index: number) => (
                    <div key={index} className="flex items-center gap-3 bg-white border border-slate-200 p-3 rounded-lg">
                      <div className="flex-1">
                        <select
                          required
                          value={item.raw_material_id}
                          onChange={e => updateRecipeItem(index, 'raw_material_id', e.target.value)}
                          className="w-full border border-slate-200 rounded-md p-2 outline-none focus:border-blue-500"
                        >
                          <option value="">-- Alege Materia Primă --</option>
                          {rawMaterials.map(rm => (
                            <option key={rm.id} value={rm.id}>{rm.name} ({rm.unit})</option>
                          ))}
                        </select>
                      </div>
                      <div className="w-32">
                        <NumericInput
                          decimalScale={3} required placeholder="Cantitate"
                          value={item.quantity || ''}
                          onValueChange={value => updateRecipeItem(index, 'quantity', value)}
                          className="w-full border border-slate-200 rounded-md p-2 outline-none focus:border-blue-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRecipeItem(index)}
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}

                  {recipeData.items.length === 0 && (
                    <div className="text-center p-8 border-2 border-dashed border-slate-200 rounded-xl text-slate-500">
                      Nu ai adăugat niciun ingredient pentru această rețetă.
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
                <button type="button" onClick={() => setIsRecipeModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium transition-colors">
                  Închide
                </button>
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors shadow-sm">
                  Salvează Rețeta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

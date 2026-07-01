import React, { useState, useEffect } from 'react';
import { api } from './api';
import { Plus, Edit, Trash2, X, Check, Folder } from 'lucide-react';

interface CategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'raw_material' | 'finished_product';
  title: string;
}

export function CategoryModal({ isOpen, onClose, type, title }: CategoryModalProps) {
  const [categories, setCategories] = useState<any[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadCategories();
    }
  }, [isOpen]);

  const loadCategories = async () => {
    try {
      const cats = await api.categories.get(type);
      setCategories(cats);
    } catch (err) {
      console.error("Eroare la încărcarea categoriilor:", err);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      await api.categories.add(newCategoryName.trim(), type);
      setNewCategoryName('');
      loadCategories();
    } catch (err) {
      alert("Eroare la adăugarea categoriei! Posibil nume duplicat.");
      console.error(err);
    }
  };

  const handleUpdateCategory = async (id: number) => {
    if (!editingCategoryName.trim()) return;
    try {
      await api.categories.update(id, editingCategoryName.trim());
      setEditingCategoryId(null);
      setEditingCategoryName('');
      loadCategories();
    } catch (err) {
      alert("Eroare la modificarea categoriei! Posibil nume duplicat.");
      console.error(err);
    }
  };

  const handleDeleteCategory = async (id: number, name: string) => {
    if (window.confirm(`Sigur doriți să ștergeți categoria "${name}"? Produsele din această categorie vor rămâne neasociate.`)) {
      try {
        await api.categories.delete(id);
        loadCategories();
      } catch (err) {
        alert("Eroare la ștergerea categoriei!");
        console.error(err);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex justify-between items-center p-6 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Folder size={22} className="text-blue-600" />
            {title}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <form onSubmit={handleAddCategory} className="flex gap-2">
            <input 
              type="text"
              placeholder="Nume categorie nouă..."
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              className="flex-1 border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <button 
              type="submit"
              disabled={!newCategoryName.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-1 shadow-sm whitespace-nowrap"
            >
              <Plus size={18} />
              Adaugă
            </button>
          </form>

          <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
            {categories.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-sm">
                Nu există categorii definite. Adăugați prima categorie mai sus.
              </div>
            ) : (
              categories.map((cat) => (
                <div key={cat.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  {editingCategoryId === cat.id ? (
                    <div className="flex items-center gap-2 flex-1 mr-2">
                      <input 
                        type="text"
                        value={editingCategoryName}
                        onChange={e => setEditingCategoryName(e.target.value)}
                        className="flex-1 border border-slate-300 rounded-md p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleUpdateCategory(cat.id);
                          }
                          if (e.key === 'Escape') setEditingCategoryId(null);
                        }}
                      />
                      <button 
                        onClick={() => handleUpdateCategory(cat.id)}
                        className="p-1.5 text-green-600 hover:bg-green-50 rounded-md transition-colors"
                        title="Salvează"
                      >
                        <Check size={18} />
                      </button>
                      <button 
                        onClick={() => setEditingCategoryId(null)}
                        className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-md transition-colors"
                        title="Anulează"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="font-medium text-slate-800 text-sm flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        {cat.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => {
                            setEditingCategoryId(cat.id);
                            setEditingCategoryName(cat.name);
                          }}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Editează"
                        >
                          <Edit size={16} />
                        </button>
                        <button 
                          onClick={() => handleDeleteCategory(cat.id, cat.name)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Șterge"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button 
            type="button" 
            onClick={onClose} 
            className="px-5 py-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg font-medium transition-colors shadow-sm text-sm"
          >
            Închide
          </button>
        </div>
      </div>
    </div>
  );
}

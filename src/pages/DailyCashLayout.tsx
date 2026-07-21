import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { 
  Banknote, 
  Settings, 
  LayoutDashboard,
  PlusCircle,
  ShoppingCart,
  MinusCircle,
  Lock,
  XCircle
} from 'lucide-react';
import { api } from '../shared/api';
import { DailyCash } from './DailyCash';
import { TransactionHistoryPage, HistoricalZPage } from './DailyCashSubPages';
import { useCashStore } from '../store/cashStore';

function DailyCashSidebar() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  const { activeDay, drivers, employees, products, loadData, isModalOpen, openModal, closeModal } = useCashStore();

  // Form states
  const [inData, setInData] = useState({ category: 'driver_collection', amount: '', reference_id: '', notes: '' });
  const [outData, setOutData] = useState({ category: 'purchase', amount: '', notes: '' });
  const [collectionData, setCollectionData] = useState({ name: 'Emi', amount: '', notes: '' });
  const [saleData, setSaleData] = useState({ reference_id: '', reference_name: '', items: [] as {finished_product_id: number, quantity: number, unit_price: number}[] });
  const [currentSaleItem, setCurrentSaleItem] = useState({ finished_product_id: '', quantity: '', unit_price: '' });

  const handleCloseDay = async () => {
    if (!activeDay) return;
    if (window.confirm(`Ești sigur că vrei să închizi ziua cu soldul final de £${activeDay.current_balance}?`)) {
      await api.dailyCash.closeDay(activeDay.id, activeDay.current_balance);
      loadData(); 
    }
  };

  const handleInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inData.amount || !activeDay) return;
    await api.dailyCash.addTransaction({
      cash_day_id: activeDay.id,
      type: 'IN',
      category: inData.category,
      amount: parseFloat(inData.amount),
      reference_id: inData.reference_id ? parseInt(inData.reference_id) : null,
      notes: inData.notes
    });
    closeModal();
    setInData({ category: 'driver_collection', amount: '', reference_id: '', notes: '' });
    loadData();
  };

  const handleOutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outData.amount || !activeDay) return;
    await api.dailyCash.addTransaction({
      cash_day_id: activeDay.id,
      type: 'OUT',
      category: outData.category,
      amount: parseFloat(outData.amount),
      notes: outData.notes
    });
    closeModal();
    setOutData({ category: 'purchase', amount: '', notes: '' });
    loadData();
  };

  const handleCollectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectionData.amount || !activeDay) return;
    await api.dailyCash.addTransaction({
      cash_day_id: activeDay.id,
      type: 'OUT',
      category: 'cash_collection',
      amount: parseFloat(collectionData.amount),
      reference_name: collectionData.name,
      notes: collectionData.notes
    });
    closeModal();
    setCollectionData({ name: 'Emi', amount: '', notes: '' });
    loadData();
  };

  const addSaleItem = () => {
    if (!currentSaleItem.finished_product_id || !currentSaleItem.quantity || !currentSaleItem.unit_price) return;
    setSaleData({
      ...saleData,
      items: [...saleData.items, {
        finished_product_id: parseInt(currentSaleItem.finished_product_id),
        quantity: parseFloat(currentSaleItem.quantity),
        unit_price: parseFloat(currentSaleItem.unit_price)
      }]
    });
    setCurrentSaleItem({ finished_product_id: '', quantity: '', unit_price: '' });
  };

  const removeSaleItem = (idx: number) => {
    const newItems = [...saleData.items];
    newItems.splice(idx, 1);
    setSaleData({...saleData, items: newItems});
  };

  const handleSaleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saleData.items.length === 0) {
      alert('Adaugă cel puțin un produs!');
      return;
    }
    if (!activeDay) return;

    const totalAmount = saleData.items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    
    await api.dailyCash.addTransaction({
      cash_day_id: activeDay.id,
      type: 'IN',
      category: 'direct_sale',
      amount: totalAmount,
      reference_id: saleData.reference_id ? parseInt(saleData.reference_id) : null,
      reference_name: saleData.reference_name || null,
      items: saleData.items
    });
    
    closeModal();
    setSaleData({ reference_id: '', reference_name: '', items: [] });
    loadData();
  };

  return (
    <>
      <div className="w-72 bg-slate-900 text-white flex flex-col h-screen shadow-xl z-10 relative">
        <div className="p-6 text-xl font-bold border-b border-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
            <Banknote size={18} className="text-white" />
          </div>
          Daily Cash
        </div>
        
        <div className="flex-1 flex flex-col overflow-y-auto">
          <nav className="p-4 space-y-1">
            <Link to="/" className="flex items-center gap-3 p-3 rounded-lg font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors mb-4">
              <Settings size={20} />
              Înapoi la Hub
            </Link>
            <Link to="/daily-cash/dashboard" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/daily-cash/dashboard') ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              <LayoutDashboard size={20} />
              Dashboard
            </Link>

            <Link to="/daily-cash/incasari" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/daily-cash/incasari') ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              <PlusCircle size={20} />
              Încasări (Șoferi)
            </Link>

            <Link to="/daily-cash/colectari" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/daily-cash/colectari') ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              <MinusCircle size={20} className="text-orange-400" />
              Colectări
            </Link>

            <Link to="/daily-cash/vanzari" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/daily-cash/vanzari') ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              <ShoppingCart size={20} />
              Vânzări Directe
            </Link>

            <Link to="/daily-cash/plati" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/daily-cash/plati') ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              <MinusCircle size={20} />
              Plăți (Achiziții)
            </Link>

            <Link to="/daily-cash/istoric-z" className={`flex items-center gap-3 p-3 rounded-lg font-medium transition-colors ${isActive('/daily-cash/istoric-z') ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              <Lock size={20} />
              Istoric Z-uri
            </Link>
          </nav>
        </div>
      </div>

      {/* --- MODALE --- */}
      {/* Modal IN (Incasare Sofer) */}
      {isModalOpen === 'incasare' && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden text-slate-800">
            <div className="p-5 border-b border-slate-100 bg-emerald-50 flex justify-between items-center">
              <h3 className="font-bold text-emerald-800 flex items-center gap-2"><PlusCircle size={20}/> Încasare de la Șofer</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <form onSubmit={handleInSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Șofer</label>
                <select 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  value={inData.reference_id}
                  onChange={e => setInData({...inData, reference_id: e.target.value})}
                  required
                >
                  <option value="">-- Selectează Șofer --</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name} ({d.car_details})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Suma (£)</label>
                <input 
                  type="number" step="0.01" min="0" required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xl font-bold text-emerald-600 bg-white"
                  value={inData.amount}
                  onChange={e => setInData({...inData, amount: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Note (Opțional)</label>
                <input 
                  type="text"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  value={inData.notes}
                  onChange={e => setInData({...inData, notes: e.target.value})}
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg">Renunță</button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg">Încasează</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal OUT (Plati/Achizitii) */}
      {isModalOpen === 'plata' && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden text-slate-800">
            <div className="p-5 border-b border-slate-100 bg-rose-50 flex justify-between items-center">
              <h3 className="font-bold text-rose-800 flex items-center gap-2"><MinusCircle size={20}/> Plată / Achiziție</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <form onSubmit={handleOutSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Tip Cheltuială</label>
                <select 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  value={outData.category}
                  onChange={e => setOutData({...outData, category: e.target.value})}
                >
                  <option value="purchase">Achiziție Marfă / Materie Primă</option>
                  <option value="other_expense">Alte Cheltuieli</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Suma (£)</label>
                <input 
                  type="number" step="0.01" min="0" required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xl font-bold text-rose-600 bg-white"
                  value={outData.amount}
                  onChange={e => setOutData({...outData, amount: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Detalii (Obligatoriu)</label>
                <input 
                  type="text" required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  value={outData.notes}
                  onChange={e => setOutData({...outData, notes: e.target.value})}
                  placeholder="ex. Factură faina Moara, Combustibil etc."
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg">Renunță</button>
                <button type="submit" className="px-4 py-2 bg-rose-600 text-white font-medium rounded-lg">Plătește</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Colectare */}
      {isModalOpen === 'colectare' && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden text-slate-800">
            <div className="p-5 border-b border-slate-100 bg-orange-50 flex justify-between items-center">
              <h3 className="font-bold text-orange-800 flex items-center gap-2"><MinusCircle size={20}/> Colectare</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <form onSubmit={handleCollectionSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Către cine?</label>
                <select 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  value={collectionData.name}
                  onChange={e => setCollectionData({...collectionData, name: e.target.value})}
                >
                  <option value="Emi">Emi</option>
                  <option value="Cerasela">Cerasela</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Suma (£)</label>
                <input 
                  type="number" step="0.01" min="0" required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xl font-bold text-orange-600 bg-white"
                  value={collectionData.amount}
                  onChange={e => setCollectionData({...collectionData, amount: e.target.value})}
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg">Renunță</button>
                <button type="submit" className="px-4 py-2 bg-orange-600 text-white font-medium rounded-lg">Salvează</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Vanzare (POS) */}
      {isModalOpen === 'vanzare' && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-slate-800">
            <div className="p-5 border-b border-slate-100 bg-emerald-50 flex justify-between items-center">
              <h3 className="font-bold text-emerald-800 flex items-center gap-2"><ShoppingCart size={20}/> Vânzare Directă</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              {/* Partea Stanga: Client & Produse */}
              <div className="w-full md:w-2/3 p-5 border-r border-slate-100 overflow-y-auto space-y-6">
                
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <h4 className="font-bold text-slate-700 text-sm border-b border-slate-200 pb-2 mb-2">1. Client / Angajat</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Selectează Angajat</label>
                      <select 
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                        value={saleData.reference_id}
                        onChange={e => setSaleData({...saleData, reference_id: e.target.value, reference_name: ''})}
                      >
                        <option value="">-- Nu e angajat --</option>
                        {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">SAU Persoană Fizică (Nume)</label>
                      <input 
                        type="text" 
                        disabled={!!saleData.reference_id}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:bg-slate-100 bg-white"
                        value={saleData.reference_name}
                        onChange={e => setSaleData({...saleData, reference_name: e.target.value})}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-sm">
                  <h4 className="font-bold text-slate-700 text-sm border-b border-slate-200 pb-2 mb-2">2. Adaugă Produs pe Bon</h4>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-500 mb-1">Produs Finit</label>
                      <select 
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                        value={currentSaleItem.finished_product_id}
                        onChange={e => setCurrentSaleItem({...currentSaleItem, finished_product_id: e.target.value})}
                      >
                        <option value="">-- Alege Produs --</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name} (Stoc: {p.current_stock?.toFixed(2) || 0} {p.production_unit})</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-24">
                      <label className="block text-xs text-slate-500 mb-1">Cant.</label>
                      <input 
                        type="number" step="0.01" min="0.01"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                        value={currentSaleItem.quantity}
                        onChange={e => setCurrentSaleItem({...currentSaleItem, quantity: e.target.value})}
                      />
                    </div>
                    <div className="w-24">
                      <label className="block text-xs text-slate-500 mb-1">Preț unit.</label>
                      <input 
                        type="number" step="0.01" min="0"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                        value={currentSaleItem.unit_price}
                        onChange={e => setCurrentSaleItem({...currentSaleItem, unit_price: e.target.value})}
                      />
                    </div>
                    <button 
                      type="button" 
                      onClick={addSaleItem}
                      className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 px-4 py-2 rounded-lg font-medium transition-colors h-[38px] flex items-center justify-center"
                    >
                      <PlusCircle size={18} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Partea Dreapta: Bon / Receipt */}
              <div className="w-full md:w-1/3 bg-slate-50 p-5 flex flex-col justify-between border-t md:border-t-0 md:border-l border-slate-200">
                <div>
                  <h4 className="font-bold text-slate-700 text-center uppercase tracking-widest text-xs mb-4">Bon Vânzare</h4>
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {saleData.items.length === 0 ? (
                      <div className="text-center text-slate-400 text-sm italic mt-8">Bonul este gol</div>
                    ) : (
                      saleData.items.map((item, idx) => {
                        const prod = products.find(p => p.id === item.finished_product_id);
                        const rowTotal = item.quantity * item.unit_price;
                        return (
                          <div key={idx} className="flex justify-between items-center text-sm group">
                            <div>
                              <div className="font-medium text-slate-800">{prod?.name || 'Necunoscut'}</div>
                              <div className="text-xs text-slate-500">{item.quantity} x {item.unit_price.toFixed(2)} £</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-700">{rowTotal.toFixed(2)} £</span>
                              <button onClick={() => removeSaleItem(idx)} className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                <XCircle size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="mt-8 border-t border-slate-200 pt-4">
                  <div className="flex justify-between items-end mb-4">
                    <span className="text-slate-500 font-bold">TOTAL DE PLATĂ</span>
                    <span className="text-3xl font-bold text-indigo-700">
                      {saleData.items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0).toFixed(2)} 
                      <span className="text-base text-indigo-400 ml-1">£</span>
                    </span>
                  </div>
                  <button 
                    onClick={handleSaleSubmit}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold text-lg transition-colors flex justify-center items-center gap-2"
                  >
                    Încasează (Cash)
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function DailyCashLayout() {
  const { loadData } = useCashStore();

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <DailyCashSidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/dashboard" element={<DailyCash />} />
          <Route path="/incasari" element={<TransactionHistoryPage title="Încasări Traseu (Șoferi)" category="driver_collection" icon={<PlusCircle size={24}/>} color="emerald" modalType="incasare" />} />
          <Route path="/vanzari" element={<TransactionHistoryPage title="Vânzări Directe" category="direct_sale" icon={<ShoppingCart size={24}/>} color="emerald" modalType="vanzare" />} />
          <Route path="/plati" element={<TransactionHistoryPage title="Plăți (Achiziții / Cheltuieli)" category="purchase_or_expense" icon={<MinusCircle size={24}/>} color="rose" modalType="plata" />} />
          <Route path="/colectari" element={<TransactionHistoryPage title="Colectări" category="cash_collection" icon={<MinusCircle size={24}/>} color="orange" modalType="colectare" />} />
          <Route path="/istoric-z" element={<HistoricalZPage />} />
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

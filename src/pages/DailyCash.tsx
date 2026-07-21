import React, { useState, useEffect } from 'react';
import { api } from '../shared/api';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  PlusCircle, 
  MinusCircle, 
  Lock, 
  User, 
  Truck,
  ShoppingCart
} from 'lucide-react';

export function DailyCash() {
  const [activeDay, setActiveDay] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  
  // Modals state
  const [showInModal, setShowInModal] = useState(false);
  const [showOutModal, setShowOutModal] = useState(false);
  const [showSaleModal, setShowSaleModal] = useState(false);

  // Form states
  const [inData, setInData] = useState({ category: 'driver_collection', amount: '', reference_id: '', notes: '' });
  const [outData, setOutData] = useState({ category: 'purchase', amount: '', notes: '' });
  const [saleData, setSaleData] = useState({ reference_id: '', reference_name: '', items: [] as {finished_product_id: number, quantity: number, unit_price: number}[] });
  const [currentSaleItem, setCurrentSaleItem] = useState({ finished_product_id: '', quantity: '', unit_price: '' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const day = await api.dailyCash.getActiveDay();
    setActiveDay(day);
    if (day) {
      const trans = await api.dailyCash.getTransactions(day.id);
      setTransactions(trans);
    }
    const dr = await api.drivers.getAll();
    const emp = await api.employees.getAll();
    const prod = await api.finishedProducts.getAll();
    setDrivers(dr.filter((d: any) => d.is_active));
    setEmployees(emp.filter((e: any) => e.is_active));
    setProducts(prod.filter((p: any) => p.is_active));
  };

  const handleCloseDay = async () => {
    if (!activeDay) return;
    if (window.confirm(\`Ești sigur că vrei să închizi ziua cu soldul final de \${activeDay.current_balance} lei?\`)) {
      await api.dailyCash.closeDay(activeDay.id, activeDay.current_balance);
      loadData(); // va crea automat o zi nouă pe baza celei închise
    }
  };

  const handleInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inData.amount) return;
    await api.dailyCash.addTransaction({
      cash_day_id: activeDay.id,
      type: 'IN',
      category: inData.category,
      amount: parseFloat(inData.amount),
      reference_id: inData.reference_id ? parseInt(inData.reference_id) : null,
      notes: inData.notes
    });
    setShowInModal(false);
    setInData({ category: 'driver_collection', amount: '', reference_id: '', notes: '' });
    loadData();
  };

  const handleOutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outData.amount) return;
    await api.dailyCash.addTransaction({
      cash_day_id: activeDay.id,
      type: 'OUT',
      category: outData.category,
      amount: parseFloat(outData.amount),
      notes: outData.notes
    });
    setShowOutModal(false);
    setOutData({ category: 'purchase', amount: '', notes: '' });
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
    
    setShowSaleModal(false);
    setSaleData({ reference_id: '', reference_name: '', items: [] });
    loadData();
  };

  if (!activeDay) return <div className="p-8">Se încarcă datele...</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-8 md:p-12">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
              <Wallet size={26} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Daily Cash</h1>
              <p className="text-slate-500 text-sm">Gestiune Numerar • Ziua curentă: {activeDay.date}</p>
            </div>
          </div>
          <Link to="/" className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-colors">
            <ArrowLeft size={18} /> Înapoi la Hub
          </Link>
        </div>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="text-slate-500 text-sm font-medium mb-2">Sold Deschidere</div>
            <div className="text-2xl font-bold text-slate-800">{activeDay.opening_balance.toFixed(2)} <span className="text-sm font-normal text-slate-500">lei</span></div>
          </div>
          
          <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-100 shadow-sm flex flex-col justify-between">
            <div className="text-emerald-700 text-sm font-medium mb-2 flex items-center gap-1"><TrendingUp size={16}/> Total Intrări</div>
            <div className="text-2xl font-bold text-emerald-700">
              {transactions.filter(t => t.type === 'IN').reduce((sum, t) => sum + t.amount, 0).toFixed(2)} <span className="text-sm font-normal opacity-80">lei</span>
            </div>
          </div>

          <div className="bg-rose-50 p-5 rounded-2xl border border-rose-100 shadow-sm flex flex-col justify-between">
            <div className="text-rose-700 text-sm font-medium mb-2 flex items-center gap-1"><TrendingDown size={16}/> Total Ieșiri</div>
            <div className="text-2xl font-bold text-rose-700">
              {transactions.filter(t => t.type === 'OUT').reduce((sum, t) => sum + t.amount, 0).toFixed(2)} <span className="text-sm font-normal opacity-80">lei</span>
            </div>
          </div>

          <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700 shadow-lg flex flex-col justify-between relative overflow-hidden">
            <div className="text-slate-300 text-sm font-medium mb-2 relative z-10">Sold Curent (Casă)</div>
            <div className="text-3xl font-bold text-white relative z-10">{activeDay.current_balance.toFixed(2)} <span className="text-lg font-normal text-slate-400">lei</span></div>
            <Wallet className="absolute -right-4 -bottom-4 w-24 h-24 text-slate-700 opacity-50" />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setShowInModal(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-xl font-medium flex items-center gap-2 shadow-sm transition-transform hover:-translate-y-0.5">
            <PlusCircle size={20} /> Încasare Traseu (Șoferi)
          </button>
          <button onClick={() => setShowSaleModal(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-xl font-medium flex items-center gap-2 shadow-sm transition-transform hover:-translate-y-0.5">
            <ShoppingCart size={20} /> Vânzare Directă (Angajați/Casă)
          </button>
          <button onClick={() => setShowOutModal(true)} className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-3 rounded-xl font-medium flex items-center gap-2 shadow-sm transition-transform hover:-translate-y-0.5">
            <MinusCircle size={20} /> Plată (Achiziții / Cheltuieli)
          </button>
          <div className="flex-1"></div>
          <button onClick={handleCloseDay} className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-5 py-3 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-colors">
            <Lock size={20} /> Închide Ziua (Z)
          </button>
        </div>

        {/* Transactions Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50">
            <h2 className="font-bold text-slate-800">Istoric Tranzacții (Azi)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-medium">Ora</th>
                  <th className="px-6 py-4 font-medium">Tip</th>
                  <th className="px-6 py-4 font-medium">Categorie / Detalii</th>
                  <th className="px-6 py-4 font-medium">Suma</th>
                  <th className="px-6 py-4 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-500">Nicio tranzacție înregistrată azi.</td>
                  </tr>
                ) : (
                  transactions.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-slate-500">{new Date(t.created_at).toLocaleTimeString('ro-RO')}</td>
                      <td className="px-6 py-4">
                        {t.type === 'IN' 
                          ? <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-bold">IN</span>
                          : <span className="bg-rose-100 text-rose-700 px-2 py-1 rounded text-xs font-bold">OUT</span>
                        }
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-800">
                          {t.category === 'driver_collection' ? 'Încasare Șofer' : 
                           t.category === 'direct_sale' ? 'Vânzare Directă' : 
                           t.category === 'purchase' ? 'Achiziție Marfă' : 'Alte Cheltuieli'}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {t.driver_name && <span className="flex items-center gap-1"><Truck size={12}/> {t.driver_name}</span>}
                          {t.employee_name && <span className="flex items-center gap-1"><User size={12}/> {t.employee_name}</span>}
                          {t.reference_name && <span className="flex items-center gap-1"><User size={12}/> {t.reference_name}</span>}
                        </div>
                      </td>
                      <td className={\`px-6 py-4 font-bold \${t.type === 'IN' ? 'text-emerald-600' : 'text-rose-600'}\`}>
                        {t.type === 'IN' ? '+' : '-'}{t.amount.toFixed(2)} lei
                      </td>
                      <td className="px-6 py-4 text-slate-600">{t.notes}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* --- MODALE --- */}

      {/* Modal IN (Incasare Sofer) */}
      {showInModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-emerald-50 flex justify-between items-center">
              <h3 className="font-bold text-emerald-800 flex items-center gap-2"><PlusCircle size={20}/> Încasare Traseu</h3>
              <button onClick={() => setShowInModal(false)} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <form onSubmit={handleInSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Șofer</label>
                <select 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  value={inData.reference_id}
                  onChange={e => setInData({...inData, reference_id: e.target.value})}
                  required
                >
                  <option value="">-- Selectează Șofer --</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name} ({d.car_details})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Suma (lei)</label>
                <input 
                  type="number" step="0.01" min="0" required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xl font-bold text-emerald-600"
                  value={inData.amount}
                  onChange={e => setInData({...inData, amount: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Note (Opțional)</label>
                <input 
                  type="text"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  value={inData.notes}
                  onChange={e => setInData({...inData, notes: e.target.value})}
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowInModal(false)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg">Renunță</button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg">Încasează</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal OUT (Plati/Cheltuieli) */}
      {showOutModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-rose-50 flex justify-between items-center">
              <h3 className="font-bold text-rose-800 flex items-center gap-2"><MinusCircle size={20}/> Plată / Cheltuială</h3>
              <button onClick={() => setShowOutModal(false)} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <form onSubmit={handleOutSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Tip Cheltuială</label>
                <select 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  value={outData.category}
                  onChange={e => setOutData({...outData, category: e.target.value})}
                >
                  <option value="purchase">Achiziție Marfă / Materie Primă</option>
                  <option value="other_expense">Alte Cheltuieli</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Suma (lei)</label>
                <input 
                  type="number" step="0.01" min="0" required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xl font-bold text-rose-600"
                  value={outData.amount}
                  onChange={e => setOutData({...outData, amount: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Detalii (Obligatoriu)</label>
                <input 
                  type="text" required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  value={outData.notes}
                  onChange={e => setOutData({...outData, notes: e.target.value})}
                  placeholder="ex. Factură faina Moara, Combustibil etc."
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowOutModal(false)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg">Renunță</button>
                <button type="submit" className="px-4 py-2 bg-rose-600 text-white font-medium rounded-lg">Plătește</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Vanzare (POS) */}
      {showSaleModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 bg-indigo-50 flex justify-between items-center">
              <h3 className="font-bold text-indigo-800 flex items-center gap-2"><ShoppingCart size={20}/> POS - Vânzare Directă</h3>
              <button onClick={() => setShowSaleModal(false)} className="text-slate-400 hover:text-slate-600">&times;</button>
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
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
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
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:bg-slate-100"
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
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
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
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                        value={currentSaleItem.quantity}
                        onChange={e => setCurrentSaleItem({...currentSaleItem, quantity: e.target.value})}
                      />
                    </div>
                    <div className="w-24">
                      <label className="block text-xs text-slate-500 mb-1">Preț unit.</label>
                      <input 
                        type="number" step="0.01" min="0"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
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
                              <div className="text-xs text-slate-500">{item.quantity} x {item.unit_price.toFixed(2)} lei</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-700">{rowTotal.toFixed(2)} lei</span>
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
                      <span className="text-base text-indigo-400 ml-1">lei</span>
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

    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { api } from '../shared/api';
import { Users, Truck, UserPlus, CheckCircle2, XCircle } from 'lucide-react';

export function SettingsEntities() {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [newDriver, setNewDriver] = useState({ name: '', phone: '', car_details: '' });
  const [newEmployee, setNewEmployee] = useState({ name: '', role: '' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const d = await api.drivers.getAll();
    const e = await api.employees.getAll();
    setDrivers(d);
    setEmployees(e);
  };

  const handleAddDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriver.name) return;
    await api.drivers.create(newDriver);
    setNewDriver({ name: '', phone: '', car_details: '' });
    loadData();
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmployee.name) return;
    await api.employees.create(newEmployee);
    setNewEmployee({ name: '', role: '' });
    loadData();
  };

  const handleToggleDriver = async (id: number, isActive: boolean) => {
    await api.drivers.toggleActive(id, !isActive);
    loadData();
  };

  const handleToggleEmployee = async (id: number, isActive: boolean) => {
    await api.employees.toggleActive(id, !isActive);
    loadData();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      {/* Casetă Șoferi */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
          <Truck className="w-6 h-6 text-orange-500" />
          <div>
            <h2 className="text-lg font-bold text-slate-800">Gestiune Șoferi</h2>
            <p className="text-xs text-slate-500">Adaugă șoferi pentru preluarea încasărilor</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <form onSubmit={handleAddDriver} className="flex flex-col gap-2">
            <input 
              type="text" 
              placeholder="Nume Șofer..." 
              value={newDriver.name}
              onChange={e => setNewDriver({...newDriver, name: e.target.value})}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              required
            />
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Telefon..." 
                value={newDriver.phone}
                onChange={e => setNewDriver({...newDriver, phone: e.target.value})}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <input 
                type="text" 
                placeholder="Mașină (ex. B-10-ABC)..." 
                value={newDriver.car_details}
                onChange={e => setNewDriver({...newDriver, car_details: e.target.value})}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
              <UserPlus size={16} /> Adaugă Șofer
            </button>
          </form>

          <div className="max-h-60 overflow-y-auto space-y-2 mt-4">
            {drivers.map(d => (
              <div key={d.id} className={\`flex items-center justify-between p-3 rounded-lg border \${d.is_active ? 'bg-slate-50 border-slate-200' : 'bg-slate-100 border-slate-200 opacity-60'}\`}>
                <div>
                  <div className="font-medium text-slate-800">{d.name}</div>
                  <div className="text-xs text-slate-500">{d.phone} • {d.car_details}</div>
                </div>
                <button 
                  onClick={() => handleToggleDriver(d.id, d.is_active)}
                  className={\`p-1.5 rounded-md \${d.is_active ? 'text-emerald-600 hover:bg-emerald-100' : 'text-rose-600 hover:bg-rose-100'}\`}
                  title={d.is_active ? "Dezactivează" : "Activează"}
                >
                  {d.is_active ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Casetă Angajați */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
          <Users className="w-6 h-6 text-purple-500" />
          <div>
            <h2 className="text-lg font-bold text-slate-800">Gestiune Angajați</h2>
            <p className="text-xs text-slate-500">Angajați pentru vânzările directe (Cash)</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <form onSubmit={handleAddEmployee} className="flex flex-col gap-2">
            <input 
              type="text" 
              placeholder="Nume Angajat..." 
              value={newEmployee.name}
              onChange={e => setNewEmployee({...newEmployee, name: e.target.value})}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
            <input 
              type="text" 
              placeholder="Rol / Funcție..." 
              value={newEmployee.role}
              onChange={e => setNewEmployee({...newEmployee, role: e.target.value})}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <button type="submit" className="bg-purple-500 hover:bg-purple-600 text-white font-medium py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
              <UserPlus size={16} /> Adaugă Angajat
            </button>
          </form>

          <div className="max-h-60 overflow-y-auto space-y-2 mt-4">
            {employees.map(e => (
              <div key={e.id} className={\`flex items-center justify-between p-3 rounded-lg border \${e.is_active ? 'bg-slate-50 border-slate-200' : 'bg-slate-100 border-slate-200 opacity-60'}\`}>
                <div>
                  <div className="font-medium text-slate-800">{e.name}</div>
                  <div className="text-xs text-slate-500">{e.role}</div>
                </div>
                <button 
                  onClick={() => handleToggleEmployee(e.id, e.is_active)}
                  className={\`p-1.5 rounded-md \${e.is_active ? 'text-emerald-600 hover:bg-emerald-100' : 'text-rose-600 hover:bg-rose-100'}\`}
                  title={e.is_active ? "Dezactivează" : "Activează"}
                >
                  {e.is_active ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

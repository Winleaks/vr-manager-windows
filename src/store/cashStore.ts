import { create } from 'zustand';
import { api } from '../shared/api';

interface CashStore {
  activeDay: any;
  transactions: any[]; // These remain the active day transactions (for Modals)
  drivers: any[];
  employees: any[];
  products: any[];
  isModalOpen: 'incasare' | 'vanzare' | 'plata' | 'colectare' | 'z' | null;
  dateFilter: { startDate: string; endDate: string };
  openModal: (type: 'incasare' | 'vanzare' | 'plata' | 'colectare' | 'z') => void;
  closeModal: () => void;
  setDateFilter: (startDate: string, endDate: string) => void;
  loadData: () => Promise<void>;
}

export const useCashStore = create<CashStore>((set) => ({
  activeDay: null,
  transactions: [],
  drivers: [],
  employees: [],
  products: [],
  isModalOpen: null,
  dateFilter: { 
    startDate: new Date().toISOString().split('T')[0], 
    endDate: new Date().toISOString().split('T')[0] 
  },
  openModal: (type) => set({ isModalOpen: type }),
  closeModal: () => set({ isModalOpen: null }),
  setDateFilter: (startDate, endDate) => set({ dateFilter: { startDate, endDate } }),
  loadData: async () => {
    const day = await api.dailyCash.getActiveDay();
    let trans = [];
    if (day) {
      trans = await api.dailyCash.getTransactions(day.id);
    }
    const dr = await api.drivers.getAll();
    const emp = await api.employees.getAll();
    const prod = await api.finishedProducts.getAll();
    
    set({
      activeDay: day,
      transactions: trans,
      drivers: dr.filter((d: any) => d.is_active),
      employees: emp.filter((e: any) => e.is_active),
      products: prod.filter((p: any) => p.is_active)
    });
  }
}));

import { ipcMain } from 'electron';
import { driverRepo } from '../database/repositories/driverRepo';
import { employeeRepo } from '../database/repositories/employeeRepo';
import { cashRepo } from '../database/repositories/cashRepo';

export function registerDailyCashHandlers() {
  // Drivers
  ipcMain.handle('get-drivers', () => {
    return driverRepo.getAll();
  });
  ipcMain.handle('create-driver', (_e, data) => {
    return driverRepo.create(data.name, data.phone, data.car_details);
  });
  ipcMain.handle('update-driver', (_e, data) => {
    return driverRepo.update(data.id, data.name, data.phone, data.car_details);
  });
  ipcMain.handle('toggle-driver', (_e, id, isActive) => {
    return driverRepo.toggleActive(id, isActive);
  });

  // Employees
  ipcMain.handle('get-employees', () => {
    return employeeRepo.getAll();
  });
  ipcMain.handle('create-employee', (_e, data) => {
    return employeeRepo.create(data.name, data.role);
  });
  ipcMain.handle('update-employee', (_e, data) => {
    return employeeRepo.update(data.id, data.name, data.role);
  });
  ipcMain.handle('toggle-employee', (_e, id, isActive) => {
    return employeeRepo.toggleActive(id, isActive);
  });

  // Cash Transactions
  ipcMain.handle('get-active-cash-day', () => {
    return cashRepo.getActiveDay();
  });
  ipcMain.handle('get-cash-transactions', (_e, dayId) => {
    return cashRepo.getTransactions(dayId);
  });
  ipcMain.handle('add-cash-transaction', (_e, data) => {
    return cashRepo.addTransaction(data);
  });
  ipcMain.handle('close-cash-day', (_e, dayId, finalBalance) => {
    return cashRepo.closeDay(dayId, finalBalance);
  });
  ipcMain.handle('get-cash-transactions-by-date', (_e, startDate, endDate, category) => {
    return cashRepo.getTransactionsByDateRange(startDate, endDate, category);
  });
  ipcMain.handle('get-historical-z-reports', (_e, startDate, endDate) => {
    return cashRepo.getHistoricalZReports(startDate, endDate);
  });
  ipcMain.handle('delete-cash-transaction', (_e, transactionId) => {
    return cashRepo.deleteTransaction(transactionId);
  });
}

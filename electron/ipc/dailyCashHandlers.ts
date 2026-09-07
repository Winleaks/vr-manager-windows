import { app, shell } from 'electron';
import { driverRepo } from '../database/repositories/driverRepo';
import { employeeRepo } from '../database/repositories/employeeRepo';
import { cashRepo } from '../database/repositories/cashRepo';
import { handleTrustedIpc } from './trustedHandler';
import { getDeviceRole } from '../device/deviceRole';
import { generateDailyCashPdf } from '../reports/dailyCashPdf';
import { saveDailyCashReportPdf } from '../reports/dailyCashDelivery';
import { buildWhatsAppLaunchTargets } from '../security/whatsapp';
import { openWindowsShareSheet } from '../reports/windowsShare';

export function registerDailyCashHandlers() {
  // Drivers
  handleTrustedIpc('get-drivers', () => {
    return driverRepo.getAll();
  });
  handleTrustedIpc('create-driver', (_e, data) => {
    return driverRepo.create(data.name, data.phone, data.car_details);
  });
  handleTrustedIpc('update-driver', (_e, data) => {
    return driverRepo.update(data.id, data.name, data.phone, data.car_details);
  });
  handleTrustedIpc('toggle-driver', (_e, id, isActive) => {
    return driverRepo.toggleActive(id, isActive);
  });

  // Employees
  handleTrustedIpc('get-employees', () => {
    return employeeRepo.getAll();
  });
  handleTrustedIpc('create-employee', (_e, data) => {
    return employeeRepo.create(data.name, data.role);
  });
  handleTrustedIpc('update-employee', (_e, data) => {
    return employeeRepo.update(data.id, data.name, data.role);
  });
  handleTrustedIpc('toggle-employee', (_e, id, isActive) => {
    return employeeRepo.toggleActive(id, isActive);
  });

  // Cash Transactions
  handleTrustedIpc('get-active-cash-day', () => {
    return cashRepo.getActiveDay(getDeviceRole() === 'writer');
  });
  handleTrustedIpc('get-cash-transactions', (_e, dayId) => {
    return cashRepo.getTransactions(dayId);
  });
  handleTrustedIpc('add-cash-transaction', (_e, data) => {
    return cashRepo.addTransaction(data);
  });
  handleTrustedIpc('close-cash-day', (_e, dayId) => {
    return cashRepo.closeDay(dayId);
  });
  handleTrustedIpc('reopen-cash-day', (_e, dayId) => {
    return cashRepo.reopenDay(dayId);
  });
  handleTrustedIpc('initialize-cash-balance', (_e, dayId, actualBalance) => {
    return cashRepo.initializeBalance(dayId, actualBalance);
  });
  handleTrustedIpc('update-cash-receipt', (_e, data) => {
    return cashRepo.updateReceipt(data);
  });
  handleTrustedIpc('get-cash-transactions-by-date', (_e, startDate, endDate, category) => {
    return cashRepo.getTransactionsByDateRange(startDate, endDate, category);
  });
  handleTrustedIpc('get-historical-z-reports', (_e, startDate, endDate) => {
    return cashRepo.getHistoricalZReports(startDate, endDate);
  });
  handleTrustedIpc('get-daily-cash-report', (_e, date) => {
    return cashRepo.getDailyReport(date);
  });
  handleTrustedIpc('prepare-daily-cash-whatsapp', async (_e, date) => {
    const report = cashRepo.getDailyReport(date);
    if (!report) throw new Error('Nu există o zi de casă pentru data selectată.');
    const targets = buildWhatsAppLaunchTargets();
    const pdf = generateDailyCashPdf(report);
    const filePath = saveDailyCashReportPdf(app.getPath('documents'), report.date, pdf);
    cashRepo.recordReportPrepared(report.dayId, report.balance);

    const sharedWithAttachment = await openWindowsShareSheet(filePath);
    if (sharedWithAttachment) {
      return { success: true, filePath, deliveryMethod: 'windows-share' };
    }

    shell.showItemInFolder(filePath);
    let usedWebFallback = false;
    try {
      await shell.openExternal(targets.appUrl);
    } catch {
      usedWebFallback = true;
      await shell.openExternal(targets.webUrl);
    }
    return { success: true, filePath, deliveryMethod: 'explorer-fallback', usedWebFallback };
  });
  handleTrustedIpc('delete-cash-transaction', (_e, transactionId) => {
    return cashRepo.deleteTransaction(transactionId);
  });
}

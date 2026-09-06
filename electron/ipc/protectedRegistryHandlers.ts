import { handleTrustedIpc } from './trustedHandler.ts';
import {
  cancelProtectedInvoice,
  changeProtectedRegistryPin,
  clearProtectedRegistryTestFinancialData,
  configureProtectedRegistry,
  createProtectedManualInvoice,
  createProtectedWeeklyInvoices,
  createProtectedWeeklyInvoicesByZone,
  createAllProtectedWeeklyInvoices,
  deleteProtectedTestInvoice,
  getProtectedManualInvoiceData,
  getProtectedRegistryOverview,
  listProtectedInvoices,
  listProtectedPayments,
  listProtectedCreditNotes,
  listProtectedRegistryCompanies,
  lockProtectedRegistry,
  previewProtectedWeeklyInvoices,
  protectedRegistryStatus,
  recordProtectedPayment,
  reissueProtectedInvoice,
  reverseProtectedPayment,
  getProtectedCreditNoteDraft,
  createProtectedCreditNote,
  cancelProtectedCreditNote,
  applyProtectedCredit,
  reverseProtectedCredit,
  getProtectedCreditBalances,
  listProtectedCreditApplications,
  openProtectedDocument,
  shareProtectedDocument,
  exportProtectedRegistryMonth,
  deleteProtectedTestCreditNote,
  recoverProtectedRegistry,
  setProtectedRegistryAssignment,
  setProtectedRegistryMode,
  touchProtectedRegistrySession,
  unlockProtectedRegistry,
} from '../protectedRegistry/service.ts';

export function registerProtectedRegistryHandlers() {
  handleTrustedIpc('protectedRegistry:status', (event) => protectedRegistryStatus(event.sender.id));
  handleTrustedIpc('protectedRegistry:configure', (event, data) => configureProtectedRegistry(event.sender.id, data?.pin, data?.pinConfirmation));
  handleTrustedIpc('protectedRegistry:unlock', (event, pin) => unlockProtectedRegistry(event.sender.id, pin));
  handleTrustedIpc('protectedRegistry:lock', (event) => lockProtectedRegistry(event.sender.id));
  handleTrustedIpc('protectedRegistry:touch', (event) => touchProtectedRegistrySession(event.sender.id));
  handleTrustedIpc('protectedRegistry:recover', (event, data) => recoverProtectedRegistry(event.sender.id, data?.recoveryKey, data?.newPin, data?.newPinConfirmation));
  handleTrustedIpc('protectedRegistry:changePin', (event, data) => changeProtectedRegistryPin(event.sender.id, data?.currentPin, data?.newPin, data?.newPinConfirmation));
  handleTrustedIpc('protectedRegistry:getOverview', (event) => getProtectedRegistryOverview(event.sender.id));
  handleTrustedIpc('protectedRegistry:getCompanies', (event) => listProtectedRegistryCompanies(event.sender.id));
  handleTrustedIpc('protectedRegistry:setAssignment', (event, data) => setProtectedRegistryAssignment(event.sender.id, data?.companyId, data?.assigned, data?.operationId));
  handleTrustedIpc('protectedRegistry:setMode', (event, data) => setProtectedRegistryMode(event.sender.id, data?.mode, data?.confirmation, data?.operationId));
  handleTrustedIpc('protectedRegistry:clearTestFinancialData', (event, data) => clearProtectedRegistryTestFinancialData(event.sender.id, data?.confirmation, data?.operationId));
  handleTrustedIpc('protectedRegistry:previewWeekly', (event, startDate, endDate) => previewProtectedWeeklyInvoices(event.sender.id, startDate, endDate));
  handleTrustedIpc('protectedRegistry:createWeekly', (event, data) => createProtectedWeeklyInvoices(event.sender.id, data?.startDate, data?.endDate, data?.storeExternalIds, data?.operationId));
  handleTrustedIpc('protectedRegistry:createWeeklyByZone', (event, data) => createProtectedWeeklyInvoicesByZone(event.sender.id, data?.startDate, data?.endDate, data?.zoneId ?? null, data?.operationId));
  handleTrustedIpc('protectedRegistry:createAllWeekly', (event, data) => createAllProtectedWeeklyInvoices(event.sender.id, data?.startDate, data?.endDate, data?.operationId));
  handleTrustedIpc('protectedRegistry:getManualData', (event) => getProtectedManualInvoiceData(event.sender.id));
  handleTrustedIpc('protectedRegistry:createManualInvoice', (event, data) => createProtectedManualInvoice(event.sender.id, data, data?.operationId));
  handleTrustedIpc('protectedRegistry:getInvoices', (event) => listProtectedInvoices(event.sender.id));
  handleTrustedIpc('protectedRegistry:cancelInvoice', (event, data) => cancelProtectedInvoice(event.sender.id, data?.invoiceId, data?.reason, data?.operationId));
  handleTrustedIpc('protectedRegistry:reissueInvoice', (event, data) => reissueProtectedInvoice(event.sender.id, data?.invoiceId, data?.operationId));
  handleTrustedIpc('protectedRegistry:deleteTestInvoice', (event, data) => deleteProtectedTestInvoice(event.sender.id, data?.invoiceId, data?.confirmation, data?.operationId));
  handleTrustedIpc('protectedRegistry:recordPayment', (event, data) => recordProtectedPayment(event.sender.id, data, data?.operationId));
  handleTrustedIpc('protectedRegistry:getPayments', (event) => listProtectedPayments(event.sender.id));
  handleTrustedIpc('protectedRegistry:reversePayment', (event, data) => reverseProtectedPayment(event.sender.id, data?.id, data?.reason, data?.operationId));
  handleTrustedIpc('protectedRegistry:getCreditNoteDraft', (event) => getProtectedCreditNoteDraft(event.sender.id));
  handleTrustedIpc('protectedRegistry:createCreditNote', (event, data) => createProtectedCreditNote(event.sender.id, data, data?.operationId));
  handleTrustedIpc('protectedRegistry:getCreditNotes', (event) => listProtectedCreditNotes(event.sender.id));
  handleTrustedIpc('protectedRegistry:cancelCreditNote', (event, data) => cancelProtectedCreditNote(event.sender.id, data?.id, data?.reason, data?.acknowledgeAccountingRisk, data?.operationId));
  handleTrustedIpc('protectedRegistry:deleteTestCreditNote', (event, data) => deleteProtectedTestCreditNote(event.sender.id, data?.id, data?.confirmation, data?.operationId));
  handleTrustedIpc('protectedRegistry:applyCredit', (event, data) => applyProtectedCredit(event.sender.id, data, data?.operationId));
  handleTrustedIpc('protectedRegistry:reverseCredit', (event, data) => reverseProtectedCredit(event.sender.id, data?.id, data?.reason, data?.operationId));
  handleTrustedIpc('protectedRegistry:getCreditBalances', (event) => getProtectedCreditBalances(event.sender.id));
  handleTrustedIpc('protectedRegistry:getCreditApplications', (event) => listProtectedCreditApplications(event.sender.id));
  handleTrustedIpc('protectedRegistry:openDocument', (event, data) => openProtectedDocument(event.sender.id, data?.type, data?.id));
  handleTrustedIpc('protectedRegistry:shareDocument', (event, data) => shareProtectedDocument(event.sender.id, data?.type, data?.id));
  handleTrustedIpc('protectedRegistry:exportMonth', (event, month) => exportProtectedRegistryMonth(event.sender.id, month));
}

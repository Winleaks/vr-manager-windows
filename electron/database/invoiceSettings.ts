import * as billingRepo from "./repositories/billingRepo";
export function getInvoiceSettings() {
  return {
    invoiceDriveFolderId: billingRepo.getAppSetting("invoice_drive_folder_id") || "",
    invoiceSeries: billingRepo.getAppSetting("invoice_series") || "FACT",
    invoiceStartNumber: billingRepo.getAppSetting("invoice_start_number") ||
      "1",
    issuerName: billingRepo.getAppSetting("issuer_name") || "",
    issuerAddress: billingRepo.getAppSetting("issuer_address") || "",
    issuerCrn: billingRepo.getAppSetting("issuer_crn") || "",
    issuerVat: billingRepo.getAppSetting("issuer_vat") || "",
    invoiceBankName1: billingRepo.getAppSetting("invoice_bank_name_1") ||
      billingRepo.getAppSetting("invoice_bank_name") || "",
    invoiceAccountNumber: billingRepo.getAppSetting("invoice_account_number") ||
      "",
    invoiceSortCode: billingRepo.getAppSetting("invoice_sort_code") || "",
    invoiceBankName2: billingRepo.getAppSetting("invoice_bank_name_2") || "",
    invoiceAccountNumber2:
      billingRepo.getAppSetting("invoice_account_number_2") || "",
    invoiceSortCode2: billingRepo.getAppSetting("invoice_sort_code_2") || "",
    invoiceFooter: billingRepo.getAppSetting("invoice_footer") || "",
    invoiceColor: billingRepo.getAppSetting("invoice_color") || "#4F46E5",
    invoiceAlternateRowColor:
      billingRepo.getAppSetting("invoice_alternate_row_color") || "#4F46E5",
    invoiceAlternateRowOpacity: Number(
      billingRepo.getAppSetting("invoice_alternate_row_opacity") || 5,
    ),
    invoiceLogo: billingRepo.getAppSetting("invoice_logo") || "",
  };
}

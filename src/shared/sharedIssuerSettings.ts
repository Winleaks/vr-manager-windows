/** Common document configuration only; never carries register numbering or financial data. */
export interface SharedIssuerSettingsInput {
  id: number;
  legalName: string;
  address: string;
  companyNumber: string;
  vatNumber: string;
  bankName1: string;
  accountNumber1: string;
  sortCode1: string;
  bankName2: string;
  accountNumber2: string;
  sortCode2: string;
  footer: string;
  color: string;
  alternateRowColor: string;
  alternateRowOpacity: number;
  invoiceLogo: string;
}

export function sharedIssuerSettingsInput(form: SharedIssuerSettingsInput, invoiceLogo: string): SharedIssuerSettingsInput {
  const { id, legalName, address, companyNumber, vatNumber, bankName1, accountNumber1,
    sortCode1, bankName2, accountNumber2, sortCode2, footer, color, alternateRowColor,
    alternateRowOpacity } = form;
  return { id, legalName, address, companyNumber, vatNumber, bankName1, accountNumber1,
    sortCode1, bankName2, accountNumber2, sortCode2, footer, color, alternateRowColor,
    alternateRowOpacity, invoiceLogo };
}

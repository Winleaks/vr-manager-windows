export const PROTECTED_REGISTRY_VERSION = 1 as const;

export type ProtectedRegistryMode = 'test' | 'live';
export type ProtectedIssuerCode = 'goodness' | 'vatra';
export type ProtectedInvoiceSeries = 'TGBL' | 'VRL';
export type ProtectedCreditNoteSeries = 'CN-TGBL' | 'CN-VRL';

export interface ProtectedAssignment {
  companyKey: string;
  localCompanyId: number;
  companyName: string;
  assignedAt: string;
}

export interface ProtectedInvoiceItem {
  id: string;
  externalProductId: string | null;
  finishedProductId: number | null;
  productName: string;
  productNameRo: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  productOrder: number | null;
}

export interface ProtectedInvoice {
  id: string;
  operationId: string;
  reference: string;
  series: ProtectedInvoiceSeries;
  sequenceNumber: number;
  invoiceDate: string;
  companyKey: string;
  companyId: number;
  companyName: string;
  companySnapshot: Record<string, unknown>;
  storeExternalId: string | null;
  storeId: number | null;
  storeName: string;
  storeSnapshot: Record<string, unknown>;
  issuerId: number;
  issuerCode: ProtectedIssuerCode;
  issuerSnapshot: Record<string, unknown>;
  items: ProtectedInvoiceItem[];
  sourceOrderIds: string[];
  sourceFingerprint: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalAmount: number;
  paidAmount: number;
  creditedAmount: number;
  status: 'unpaid' | 'partial' | 'paid' | 'cancelled';
  testDocument: boolean;
  createdAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  replacesInvoiceId: string | null;
  replacedByInvoiceId: string | null;
}

export interface ProtectedPayment {
  id: string;
  operationId: string;
  companyKey: string;
  issuerCode: ProtectedIssuerCode;
  invoiceId: string | null;
  amount: number;
  paymentDate: string;
  method: string;
  notes: string | null;
  createdAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
  testEntry: boolean;
}

export interface ProtectedCreditNoteItem extends ProtectedInvoiceItem {
  sourceInvoiceId: string;
  sourceInvoiceItemId: string;
  returnToStock: boolean;
  stockReturnApplied: boolean;
}

export interface ProtectedCreditNote {
  id: string;
  operationId: string;
  reference: string;
  series: ProtectedCreditNoteSeries;
  sequenceNumber: number;
  issueDate: string;
  companyKey: string;
  companyId: number;
  companyName: string;
  issuerId: number;
  issuerCode: ProtectedIssuerCode;
  issuerSnapshot: Record<string, unknown>;
  reason: string;
  backdateReason: string | null;
  sourceInvoiceIds: string[];
  items: ProtectedCreditNoteItem[];
  totalAmount: number;
  status: 'issued' | 'cancelled';
  testDocument: boolean;
  createdAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export interface ProtectedCreditApplication {
  id: string;
  operationId: string;
  companyKey: string;
  issuerCode: ProtectedIssuerCode;
  invoiceId: string;
  amount: number;
  allocations: Array<{ creditEntryId: string; amount: number }>;
  reason: string;
  createdAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
  testEntry: boolean;
}

export interface ProtectedCreditEntry {
  id: string;
  companyKey: string;
  issuerCode: ProtectedIssuerCode;
  sourceType: 'payment_overpayment' | 'credit_note_overpayment';
  sourceId: string;
  originalAmount: number;
  availableAmount: number;
  createdAt: string;
  testEntry: boolean;
}

export interface ProtectedAuditEvent {
  id: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  operationId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ProtectedRegistryVault {
  version: typeof PROTECTED_REGISTRY_VERSION;
  revision: number;
  createdAt: string;
  updatedAt: string;
  mode: ProtectedRegistryMode;
  liveStartedAt: string | null;
  counters: {
    TGBL: number;
    VRL: number;
    'CN-TGBL': number;
    'CN-VRL': number;
  };
  assignments: ProtectedAssignment[];
  invoices: ProtectedInvoice[];
  payments: ProtectedPayment[];
  creditNotes: ProtectedCreditNote[];
  creditApplications: ProtectedCreditApplication[];
  creditEntries: ProtectedCreditEntry[];
  audit: ProtectedAuditEvent[];
  processedOperations: string[];
}

export interface ProtectedRoutingManifest {
  version: 1;
  vaultRevision: number;
  companyHashes: string[];
  protectedOrderHashes: string[];
  updatedAt: string;
}

export function createEmptyProtectedVault(now = new Date().toISOString()): ProtectedRegistryVault {
  return {
    version: PROTECTED_REGISTRY_VERSION,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    mode: 'test',
    liveStartedAt: null,
    counters: { TGBL: 2930, VRL: 2930, 'CN-TGBL': 1, 'CN-VRL': 1 },
    assignments: [],
    invoices: [],
    payments: [],
    creditNotes: [],
    creditApplications: [],
    creditEntries: [],
    audit: [],
    processedOperations: [],
  };
}

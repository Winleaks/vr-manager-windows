export interface InvoicePreviewRow {
  billingState?: string;
  issuerId?: number | null;
  issuerInvoiceSeries?: string | null;
  issuerNextInvoiceNumber?: number | null;
  estimatedInvoiceReference?: string | null;
  [key: string]: unknown;
}

/**
 * Assigns a display-only sequence in the same row order used by batch issuance.
 * It never persists or advances an issuer counter.
 */
export function assignEstimatedInvoiceReferences<T extends InvoicePreviewRow>(rows: T[]): T[] {
  const startingNumberByIssuer = new Map<number, number>();
  for (const row of rows) {
    const issuerId = Number(row.issuerId);
    const nextNumber = Number(row.issuerNextInvoiceNumber);
    if (!Number.isSafeInteger(issuerId) || issuerId <= 0 || !Number.isSafeInteger(nextNumber) || nextNumber <= 0) continue;
    startingNumberByIssuer.set(issuerId, Math.max(startingNumberByIssuer.get(issuerId) || 0, nextNumber));
  }

  const nextByIssuer = new Map(startingNumberByIssuer);
  return rows.map((row) => {
    if (row.billingState !== 'ready') return row;
    const issuerId = Number(row.issuerId);
    const series = typeof row.issuerInvoiceSeries === 'string' ? row.issuerInvoiceSeries.trim() : '';
    const next = nextByIssuer.get(issuerId);
    if (!series || next === undefined) return { ...row, estimatedInvoiceReference: null };
    nextByIssuer.set(issuerId, next + 1);
    return { ...row, estimatedInvoiceReference: `${series}-${next}` };
  });
}

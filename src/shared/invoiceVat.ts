export type OneOffVatRate = 0 | 20;

export function calculateOneOffVat(items: ReadonlyArray<{ quantity: number; unitPrice: number }>, rate: OneOffVatRate) {
  if (rate !== 0 && rate !== 20) throw new Error('Cota VAT este invalidă.');
  const lines = items.map(({ quantity, unitPrice }) => {
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error('Cantitatea sau prețul este invalid.');
    }
    const totalPence = Math.round(quantity * unitPrice * 100);
    if (!Number.isSafeInteger(totalPence) || totalPence < 0) throw new Error('Valoarea produsului depășește limita acceptată.');
    const netPence = rate === 0 ? totalPence : Math.round(totalPence * 100 / (100 + rate));
    const vatPence = totalPence - netPence;
    return { netPence, vatPence, totalPence };
  });
  const netPence = lines.reduce((sum, line) => sum + line.netPence, 0);
  const vatPence = lines.reduce((sum, line) => sum + line.vatPence, 0);
  if (!Number.isSafeInteger(netPence + vatPence)) throw new Error('Totalul facturii depășește limita acceptată.');
  return {
    lines: lines.map(line => ({ netAmount: line.netPence / 100, vatAmount: line.vatPence / 100, totalAmount: line.totalPence / 100 })),
    netAmount: netPence / 100,
    vatAmount: vatPence / 100,
    totalAmount: (netPence + vatPence) / 100,
  };
}

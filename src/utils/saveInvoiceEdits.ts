export async function saveInvoiceEdits(
  input: { id: number; invoiceDate: string; items: any[] },
  dependencies: {
    update: (input: { id: number; invoiceDate: string; items: any[] }) => Promise<{ invoice: any }>;
    prepare: (invoiceId: number) => Promise<Uint8Array>;
    upload: (invoiceId: number, buffer: Uint8Array) => Promise<{ success: boolean; error?: string }>;
    onCommitted: (invoice: any) => void;
  },
  cloudTimeoutMs = 12_000,
) {
  const { invoice } = await dependencies.update(input);
  dependencies.onCommitted(invoice);
  const prefix = `Factura #${invoice.invoice_number} a fost salvată.`;
  let buffer: Uint8Array;
  try {
    buffer = await dependencies.prepare(invoice.id);
  } catch (error) {
    return { invoice, warning: true, message: `${prefix} PDF-ul trebuie regenerat: ${error instanceof Error ? error.message : 'eroare locală'}` };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const cloud = await Promise.race([
      dependencies.upload(invoice.id, buffer),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Confirmarea Google Drive întârzie.')), cloudTimeoutMs); }),
    ]);
    if (!cloud.success) throw new Error(cloud.error || 'Google Drive nu a confirmat încărcarea.');
    return { invoice, warning: false, message: `${prefix} PDF-ul este actualizat local și în Google Drive.` };
  } catch (error) {
    return { invoice, warning: true, message: `${prefix} PDF-ul este actualizat local, dar Google Drive nu este confirmat. ${error instanceof Error ? error.message : ''}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

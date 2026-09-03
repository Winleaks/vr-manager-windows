import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fixRomanianDiacritics, registerFonts } from '../../src/utils/fonts/arialFonts.ts';

function money(value: number) { return `£${Number(value).toFixed(2)}`; }
function text(value: unknown) { return fixRomanianDiacritics(String(value || '-')); }
function displayDate(value: string) { const [year, month, day] = value.split('-'); return `${day}.${month}.${year}`; }

export function creditNoteProductDescription(item: { product_name?: string; product_name_ro?: string }) {
  return text([item.product_name, item.product_name_ro].filter(Boolean).join('\n'));
}

export function generateCreditNotePdf(note: any): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  registerFonts(doc);
  const issuer = note.issuerSnapshot;
  const customer = note.customerSnapshot;
  const accent = /^#[0-9a-f]{6}$/i.test(issuer.invoiceColor || '') ? issuer.invoiceColor : '#4F46E5';
  const rgb = [Number.parseInt(accent.slice(1, 3), 16), Number.parseInt(accent.slice(3, 5), 16), Number.parseInt(accent.slice(5, 7), 16)] as [number, number, number];
  doc.setFillColor(...rgb); doc.rect(0, 0, 210, 6, 'F');
  doc.setFont('Arial', 'bold'); doc.setTextColor(15, 23, 42); doc.setFontSize(21); doc.text('CREDIT NOTE', 14, 22);
  doc.setFontSize(12); doc.text(text(note.reference), 14, 30);
  doc.setFont('Arial', 'normal'); doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(`Data emiterii: ${displayDate(note.issue_date)}`, 14, 37);
  doc.text(`Creat în sistem: ${new Date(note.created_at).toLocaleString('ro-RO')}`, 14, 42);
  if (note.status === 'cancelled') { doc.setTextColor(190, 18, 60); doc.setFont('Arial', 'bold'); doc.text('ANULAT INTERN — NUMĂR PĂSTRAT ÎN REGISTRU', 14, 49); }

  doc.setFont('Arial', 'bold'); doc.setTextColor(15, 23, 42); doc.setFontSize(10); doc.text('EMITENT', 14, 60); doc.text('CLIENT', 112, 60);
  doc.setFont('Arial', 'normal'); doc.setFontSize(8.5);
  const issuerLines = [issuer.issuerName, issuer.issuerAddress, `Company No: ${issuer.issuerCrn}`, issuer.vatRegistered ? `VAT No: ${issuer.issuerVat}` : 'Not VAT registered'];
  const customerLines = [customer.companyName, customer.companyAddress, customer.companyRegistrationNumber ? `Company No: ${customer.companyRegistrationNumber}` : '', customer.companyVatNumber ? `VAT No: ${customer.companyVatNumber}` : ''].filter(Boolean);
  issuerLines.forEach((line, i) => doc.text(text(line), 14, 67 + i * 5));
  customerLines.forEach((line, i) => doc.text(text(line), 112, 67 + i * 5));

  const invoiceRefs = note.invoices.map((invoice: any) => `${invoice.invoice_number} (${displayDate(invoice.invoice_date)})`).join(', ');
  doc.setFont('Arial', 'bold'); doc.text('Facturi originale:', 14, 91); doc.setFont('Arial', 'normal'); doc.text(text(invoiceRefs), 45, 91, { maxWidth: 150 });
  doc.setFont('Arial', 'bold'); doc.text('Motiv:', 14, 101); doc.setFont('Arial', 'normal'); doc.text(text(note.reason), 28, 101, { maxWidth: 167 });
  if (note.backdate_reason) { doc.setFont('Arial', 'bold'); doc.text('Motiv antedatare:', 14, 111); doc.setFont('Arial', 'normal'); doc.text(text(note.backdate_reason), 43, 111, { maxWidth: 152 }); }

  autoTable(doc, {
    startY: note.backdate_reason ? 120 : 110,
    head: [['Factura', 'Magazin', 'Produs', 'Cant.', 'Preț creditat', 'VAT', 'Total']],
    body: note.items.map((item: any) => [
      note.invoices.find((invoice: any) => invoice.id === item.source_invoice_id)?.invoice_number || '-',
      text(item.store_name),
      creditNoteProductDescription(item),
      `${Number(item.quantity).toFixed(2)} ${item.unit || ''}`,
      money(item.unit_amount),
      issuer.vatRegistered ? `${Number(item.vat_rate).toFixed(0)}% / ${money(item.vat_amount)}` : 'N/A',
      money(item.total_amount),
    ]),
    theme: 'striped',
    styles: { font: 'Arial', fontSize: 7.2, cellPadding: 1.7, overflow: 'linebreak' },
    headStyles: { font: 'Arial', fontStyle: 'bold', fillColor: rgb, textColor: [255, 255, 255] },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 24 }, 2: { cellWidth: 47 }, 3: { halign: 'right', cellWidth: 18 }, 4: { halign: 'right', cellWidth: 23 }, 5: { halign: 'right', cellWidth: 22 }, 6: { halign: 'right', cellWidth: 26 } },
    margin: { left: 14, right: 14, bottom: 28 },
    didDrawPage: () => {
      doc.setFont('Arial', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
      doc.text(`VR - Hub Management • Credit Note ${text(note.reference)}`, 14, 290);
      doc.text(`Pagina ${doc.getNumberOfPages()}`, 196, 290, { align: 'right' });
    },
  });
  const y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 150) + 8;
  doc.setFont('Arial', 'normal'); doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(`Subtotal creditat: ${money(note.net_amount)}`, 196, y, { align: 'right' });
  doc.text(issuer.vatRegistered ? `VAT creditat (0%): ${money(note.vat_amount)}` : 'Emitent neînregistrat VAT', 196, y + 6, { align: 'right' });
  doc.setFont('Arial', 'bold'); doc.setTextColor(15, 23, 42); doc.setFontSize(12); doc.text(`TOTAL CREDITAT: ${money(note.total_amount)}`, 196, y + 14, { align: 'right' });
  doc.setFont('Arial', 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105);
  doc.text(text('Acest document ajustează facturile originale enumerate mai sus. Păstrați-l împreună cu documentele sursă.'), 14, y + 26, { maxWidth: 182 });
  return new Uint8Array(doc.output('arraybuffer'));
}

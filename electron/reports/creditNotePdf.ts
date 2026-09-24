import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fixRomanianDiacritics, registerFonts } from '../../src/utils/fonts/arialFonts.ts';
import { drawPdfFooters, formatPdfDate, preparePdfFooter } from '../../src/utils/pdfDocumentHelpers.ts';

function money(value: number) { return `£${Number(value).toFixed(2)}`; }
function text(value: unknown) { return fixRomanianDiacritics(String(value || '-')); }

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
  doc.setFillColor(...rgb); doc.rect(0, 0, 210, 4, 'F');
  doc.setFont('Arial', 'bold'); doc.setTextColor(15, 23, 42); doc.setFontSize(21); doc.text('CREDIT NOTE', 14, 22);
  doc.setFontSize(12); doc.text(text(note.reference), 14, 30);
  doc.setFont('Arial', 'normal'); doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(`Issue date: ${formatPdfDate(note.issue_date)}`, 14, 37);
  doc.text(`Created in system: ${new Date(note.created_at).toLocaleString('en-GB')}`, 14, 42);
  if (note.status === 'cancelled') { doc.setTextColor(190, 18, 60); doc.setFont('Arial', 'bold'); doc.text('CANCELLED INTERNALLY - NUMBER RETAINED IN REGISTER', 14, 49); }

  doc.setFont('Arial', 'bold'); doc.setTextColor(15, 23, 42); doc.setFontSize(10); doc.text('ISSUER', 14, 60); doc.text('CUSTOMER', 112, 60);
  doc.setFont('Arial', 'normal'); doc.setFontSize(8.5);
  const issuerLines = [issuer.issuerName, issuer.issuerAddress, `Company No: ${issuer.issuerCrn}`, issuer.vatRegistered ? `VAT No: ${issuer.issuerVat}` : 'Not VAT registered'];
  const customerLines = [customer.companyName, customer.companyAddress, customer.companyRegistrationNumber ? `Company No: ${customer.companyRegistrationNumber}` : '', customer.companyVatNumber ? `VAT No: ${customer.companyVatNumber}` : ''].filter(Boolean);
  issuerLines.forEach((line, i) => doc.text(text(line), 14, 67 + i * 5));
  customerLines.forEach((line, i) => doc.text(text(line), 112, 67 + i * 5));

  const invoiceRefs = note.invoices.map((invoice: any) => `${invoice.invoice_number} (${formatPdfDate(invoice.invoice_date)})`).join(', ');
  doc.setFont('Arial', 'bold'); doc.text('Original invoices:', 14, 91); doc.setFont('Arial', 'normal'); doc.text(text(invoiceRefs), 45, 91, { maxWidth: 150 });
  doc.setFont('Arial', 'bold'); doc.text('Reason:', 14, 101); doc.setFont('Arial', 'normal'); doc.text(text(note.reason), 28, 101, { maxWidth: 167 });
  if (note.backdate_reason) { doc.setFont('Arial', 'bold'); doc.text('Backdating reason:', 14, 111); doc.setFont('Arial', 'normal'); doc.text(text(note.backdate_reason), 46, 111, { maxWidth: 149 }); }

  const footerLayout = preparePdfFooter(doc, `VR - Hub Management - Credit Note ${text(note.reference)}`);
  const totalsReservedHeight = 38;
  autoTable(doc, {
    startY: note.backdate_reason ? 120 : 110,
    head: [['Invoice', 'Store', 'Product', 'Qty', 'Unit credit', 'VAT', 'Total']],
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
    styles: { font: 'Arial', fontSize: 7.2, cellPadding: 1.7, overflow: 'linebreak', valign: 'middle', lineWidth: 0 },
    headStyles: { font: 'Arial', fontStyle: 'bold', fillColor: rgb, textColor: [255, 255, 255], halign: 'center', valign: 'middle', lineWidth: 0 },
    columnStyles: { 0: { cellWidth: 22, halign: 'center' }, 1: { cellWidth: 24 }, 2: { cellWidth: 47 }, 3: { halign: 'center', cellWidth: 18 }, 4: { halign: 'center', cellWidth: 23 }, 5: { halign: 'center', cellWidth: 22 }, 6: { halign: 'center', cellWidth: 26 } },
    margin: { left: 14, right: 14, bottom: footerLayout.reservedBottom + totalsReservedHeight },
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    tableLineWidth: 0,
  });
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerTop = pageHeight - footerLayout.reservedBottom;
  let y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 150) + 8;
  if (y + 34 > footerTop - 2) {
    doc.addPage();
    y = 18;
  }
  doc.setFont('Arial', 'normal'); doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(`Credited subtotal: ${money(note.net_amount)}`, 196, y, { align: 'right' });
  doc.text(issuer.vatRegistered ? `VAT credited: ${money(note.vat_amount)}` : 'Issuer not VAT registered', 196, y + 6, { align: 'right' });
  doc.setFont('Arial', 'bold'); doc.setTextColor(15, 23, 42); doc.setFontSize(12); doc.text(`TOTAL CREDITED: ${money(note.total_amount)}`, 196, y + 14, { align: 'right' });
  doc.setFont('Arial', 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105);
  doc.text('This document adjusts the original invoices listed above. Keep it with the source documents.', 14, y + 26, { maxWidth: 182 });
  drawPdfFooters(doc, footerLayout);
  if (note.testDocument === true) {
    for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
      doc.setPage(page); doc.setFont('Arial', 'bold'); doc.setFontSize(28); doc.setTextColor(220, 38, 38);
      doc.text('TEST - NOT A TAX INVOICE', 105, 148, { align: 'center', angle: 35 });
    }
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

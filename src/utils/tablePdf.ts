import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { registerFonts } from './fonts/arialFonts.ts';

/** Document-only rendering: callers provide English headings and original business data. */
export function generateTablePdf(headers: string[], data: any[][], title: string, generatedAt = new Date()) {
  const doc = new jsPDF();
  registerFonts(doc);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(18);
  doc.text(title, 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Generated on: ${generatedAt.toLocaleString('en-GB')}`, 14, 30);
  autoTable(doc, {
    startY: 40,
    head: [headers],
    body: data,
    theme: 'striped',
    styles: { font: 'Arial' },
    headStyles: { fillColor: [15, 23, 42] },
  });
  return new Uint8Array(doc.output('arraybuffer'));
}

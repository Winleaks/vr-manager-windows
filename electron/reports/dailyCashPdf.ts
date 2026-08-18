import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DailyCashReportSnapshot } from '../database/dailyCashReport.ts';
import { fixRomanianDiacritics, registerFonts } from '../../src/utils/fonts/arialFonts.ts';

function pounds(value: number) {
  return `£${Number(value).toFixed(2)}`;
}

function displayDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function text(value: string) {
  return fixRomanianDiacritics(value || '-');
}

export function generateDailyCashPdf(report: DailyCashReportSnapshot): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  registerFonts(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(5, 150, 105);
  doc.rect(0, 0, pageWidth, 5, 'F');
  doc.setFont('Arial', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text('VR - Hub Management', 14, 18);
  doc.setFontSize(13);
  doc.text('Raport Daily Cash', 14, 25);

  const statusColor: [number, number, number] = report.isClosed ? [5, 150, 105] : [217, 119, 6];
  doc.setFillColor(...statusColor);
  doc.roundedRect(160, 12, 36, 10, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text(report.status, 178, 18.5, { align: 'center' });

  doc.setFont('Arial', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(9);
  doc.text(`Ziua: ${displayDate(report.date)}`, 14, 32);
  doc.text(`Generat: ${new Date(report.generatedAt).toLocaleString('ro-RO')}`, 14, 37);

  const cards = [
    ['Sold deschidere', pounds(report.openingBalance)],
    ['Total intrări', pounds(report.totalIn)],
    ['Total ieșiri', pounds(report.totalOut)],
    [report.isClosed ? 'Sold final' : 'Sold curent', pounds(report.balance)],
  ];
  cards.forEach(([label, value], index) => {
    const x = 14 + index * 46;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, 44, 42, 20, 2, 2, 'FD');
    doc.setFont('Arial', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7.5);
    doc.text(text(label), x + 3, 51);
    doc.setFont('Arial', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.text(value, x + 3, 59);
  });

  doc.setFont('Arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Flux net: ${report.netCashFlow >= 0 ? '+' : ''}${pounds(report.netCashFlow)}`, 14, 72);
  doc.text(`Tranzacții: ${report.transactionCount}`, 92, 72);

  autoTable(doc, {
    startY: 78,
    head: [['Categorie', 'Tip', 'Total']],
    body: report.categoryTotals.length > 0
      ? report.categoryTotals.map((item) => [text(item.label), item.type, pounds(item.amount)])
      : [['Fără tranzacții', '-', pounds(0)]],
    theme: 'grid',
    styles: { font: 'Arial', fontSize: 8, cellPadding: 2 },
    headStyles: { font: 'Arial', fontStyle: 'bold', fillColor: [30, 41, 59], textColor: [255, 255, 255] },
    columnStyles: { 1: { halign: 'center', cellWidth: 25 }, 2: { halign: 'right', cellWidth: 35 } },
    margin: { left: 14, right: 14 },
  });

  const categoryTable = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  const transactionStartY = (categoryTable?.finalY || 90) + 9;
  doc.setFont('Arial', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('Tranzacții detaliate', 14, transactionStartY - 3);

  autoTable(doc, {
    startY: transactionStartY,
    head: [['Ora', 'Tip', 'Categorie', 'Referință / Detalii', 'Sumă']],
    body: report.transactions.length > 0
      ? report.transactions.map((item) => [
          item.time,
          item.type,
          text(item.categoryLabel),
          text([item.reference, item.notes].filter(Boolean).join(' — ')),
          `${item.type === 'IN' ? '+' : '-'}${pounds(item.amount)}`,
        ])
      : [['-', '-', 'Fără tranzacții', '-', pounds(0)]],
    theme: 'striped',
    styles: { font: 'Arial', fontSize: 7.5, cellPadding: 1.8, overflow: 'linebreak' },
    headStyles: { font: 'Arial', fontStyle: 'bold', fillColor: [5, 150, 105], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 15 },
      1: { halign: 'center', cellWidth: 13 },
      2: { cellWidth: 34 },
      3: { cellWidth: 92 },
      4: { halign: 'right', cellWidth: 28 },
    },
    margin: { left: 14, right: 14, top: 15, bottom: 14 },
    didDrawPage: () => {
      const pageNumber = doc.getNumberOfPages();
      doc.setFont('Arial', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`VR - Hub Management • Daily Cash • ${displayDate(report.date)}`, 14, 290);
      doc.text(`Pagina ${pageNumber}`, 196, 290, { align: 'right' });
    },
  });

  return new Uint8Array(doc.output('arraybuffer'));
}

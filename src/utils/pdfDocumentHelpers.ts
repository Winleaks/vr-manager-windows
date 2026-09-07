import type { jsPDF } from 'jspdf';
import { fixRomanianDiacritics } from './fonts/arialFonts.ts';

export const PDF_DEVELOPER_CREDIT = 'Billing system developed by Razvan Cristofor - www.razvancristofor.ro';

export function formatPdfDate(value: string) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || '');
}

function comparisonText(value: string) {
  return value.toLocaleUpperCase('en-GB').replace(/[^A-Z0-9]/g, '');
}

export function formatAddressWithPostcode(address?: string, postcode?: string) {
  const cleanAddress = String(address || '')
    .trim()
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/^,\s*|,\s*$/g, '');
  const cleanPostcode = String(postcode || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-GB');
  if (!cleanPostcode) return cleanAddress;
  if (!cleanAddress) return cleanPostcode;
  if (comparisonText(cleanAddress).includes(comparisonText(cleanPostcode))) return cleanAddress;
  return `${cleanAddress}, ${cleanPostcode}`;
}

export interface PdfFooterLayout {
  lines: string[];
  reservedBottom: number;
}

export function preparePdfFooter(doc: jsPDF, primaryText: string): PdfFooterLayout {
  const text = fixRomanianDiacritics(primaryText.trim());
  const lines = text ? doc.splitTextToSize(text, 135) as string[] : [];
  return {
    lines,
    reservedBottom: Math.max(20, 14 + lines.length * 3.2),
  };
}

export function drawPdfFooters(
  doc: jsPDF,
  layout: PdfFooterLayout,
  options: { pageWord?: string } = {},
) {
  const pageWord = options.pageWord || 'Page';
  const totalPages = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  const creditY = pageHeight - 7;
  const lineY = pageHeight - layout.reservedBottom + 2;
  const primaryY = lineY + 4;

  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(14, lineY, 196, lineY);

    doc.setFont('Arial', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    if (layout.lines.length) doc.text(layout.lines, 14, primaryY);

    doc.setFontSize(6.8);
    doc.setTextColor(148, 163, 184);
    doc.text(PDF_DEVELOPER_CREDIT, 14, creditY);
    doc.text(`${pageWord} ${page} of ${totalPages}`, 196, creditY, { align: 'right' });
  }
}

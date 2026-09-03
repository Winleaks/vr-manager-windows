import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { registerFonts, fixRomanianDiacritics } from "./fonts/arialFonts.ts";
import {
  drawPdfFooters,
  formatAddressWithPostcode,
  formatPdfDate,
  preparePdfFooter,
} from './pdfDocumentHelpers.ts';

// Helper pentru conversie Hex în RGB
function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [79, 70, 229]; // Indigo-600 implicit
}

export function invoiceProductDescription(item: { productName?: string; name_ro?: string }) {
  const english = fixRomanianDiacritics(item.productName || 'Product').toLocaleUpperCase('en-GB');
  return item.name_ro
    ? `${english}\n${fixRomanianDiacritics(item.name_ro).toLocaleUpperCase('ro-RO')}`
    : english;
}

export const INVOICE_VAT_COLUMN_WIDTHS = [8, 95, 13, 12, 24, 12, 18] as const;
export const INVOICE_NON_VAT_COLUMN_WIDTHS = [8, 107, 13, 12, 24, 18] as const;

export function generateInvoicePDF(
  settings: any,
  invoiceData: {
    invoiceNumber: string;
    invoiceDate: string; 
    client: {
      name: string;
      cui?: string; // VAT Number client
      regCom?: string; // CRN client
      address?: string;
      postcode?: string;
      county?: string;
      city?: string;
      phone?: string;
    };
    store?: {
      name: string;
      address?: string;
      postcode?: string;
      phone?: string;
    };
    items: Array<{
      productName: string;
      name_ro?: string;
      variant_label?: string;
      unit?: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }>;
    totalAmount: number;
  }
): Uint8Array {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Înregistrare font Arial cu suport Unicode diacritice limba română (ș, ț, ă, î, â)
  registerFonts(doc);
  
  const primaryColor = hexToRgb(settings.invoiceColor || '#4F46E5');
  const [r, g, b] = primaryColor;

  // --- TOP ACCENT BAR ---
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, 210, 4, 'F');

  // --- HEADER SECTION ---
  let currentY = 9;

  if (settings.invoiceLogo) {
    try {
      doc.addImage(settings.invoiceLogo, 'PNG', 14, currentY, 16, 16, undefined, 'FAST');
    } catch (e) {
      console.warn("Logo-ul nu a putut fi atașat pe PDF:", e);
    }
  }

  // Titlu "INVOICE" & Badge Serie/Număr
  doc.setFont("Arial", "bold");
  doc.setFontSize(18);
  doc.setTextColor(r, g, b);
  doc.text("INVOICE", 196, currentY + 4, { align: "right" });

  doc.setFontSize(8.5);
  doc.setFont("Arial", "normal");
  doc.setTextColor(100, 116, 139); // Slate-500
  const series = settings.invoiceSeries || 'INV';
  const invoiceReference = invoiceData.invoiceNumber.startsWith(`${series}-`)
    ? invoiceData.invoiceNumber
    : `${series}-${invoiceData.invoiceNumber}`;
  const referenceLabel = 'Ref: ';
  const referenceValue = `#${invoiceReference}`;
  const referenceLabelWidth = doc.getTextWidth(referenceLabel);
  doc.setFont('Arial', 'bold');
  const referenceValueWidth = doc.getTextWidth(referenceValue);
  const referenceX = 196 - referenceLabelWidth - referenceValueWidth;
  doc.setFont('Arial', 'normal');
  doc.text(referenceLabel, referenceX, currentY + 8.5);
  doc.setFont('Arial', 'bold');
  doc.text(referenceValue, referenceX + referenceLabelWidth, currentY + 8.5);
  doc.setFont('Arial', 'normal');
  doc.text(`Date: ${formatPdfDate(invoiceData.invoiceDate)}`, 196, currentY + 12.5, { align: "right" });

  currentY += 18;

  // --- SEPARATOR LINE ---
  doc.setDrawColor(226, 232, 240); // Slate-200
  doc.setLineWidth(0.3);
  doc.line(14, currentY, 196, currentY);

  currentY += 4;

  // --- CARDS SECTION: ISSUER (FROM) & CLIENT (BILL TO) ---
  const leftX = 14;
  const rightX = 110;
  const cardWidth = 86;

  // Header "FROM"
  doc.setFontSize(8);
  doc.setFont("Arial", "bold");
  doc.setTextColor(r, g, b);
  doc.text("ISSUER (FROM)", leftX, currentY);
  
  // Header "BILL TO"
  doc.text("BILL TO (CUSTOMER)", rightX, currentY);

  currentY += 4;

  // Nume Issuer & Nume Client
  doc.setFontSize(9);
  doc.setFont("Arial", "bold");
  doc.setTextColor(15, 23, 42); // Slate-900
  const issuerName = fixRomanianDiacritics(settings.issuerName || "VATRA ROMANEASCA BAKERY SRL");
  doc.text(issuerName, leftX, currentY, { maxWidth: cardWidth });
  doc.text(fixRomanianDiacritics(invoiceData.client.name), rightX, currentY, { maxWidth: cardWidth });

  currentY += 4.2;

  doc.setFontSize(8);
  doc.setFont("Arial", "normal");
  doc.setTextColor(71, 85, 105); // Slate-600

  // Detalii Issuer
  let issuerY = currentY;
  if (settings.issuerAddress) {
    const addrLines = doc.splitTextToSize(fixRomanianDiacritics(`Address: ${settings.issuerAddress}`), cardWidth);
    doc.text(addrLines, leftX, issuerY);
    issuerY += (addrLines.length * 3.6);
  }
  if (settings.issuerCrn) {
    doc.text(`CRN: ${settings.issuerCrn}`, leftX, issuerY);
    issuerY += 3.6;
  }
  if (settings.vatRegistered !== false && settings.issuerVat) {
    doc.text(`VAT No: ${settings.issuerVat}`, leftX, issuerY);
    issuerY += 3.6;
  } else if (settings.vatRegistered === false) {
    doc.text('Not VAT registered', leftX, issuerY);
    issuerY += 3.6;
  }

  // Cont Bancar 1
  const bank1Name = settings.invoiceBankName1 || settings.invoiceBankName;
  if (bank1Name || settings.invoiceAccountNumber || settings.invoiceSortCode) {
    if (bank1Name) {
      doc.text(fixRomanianDiacritics(`Bank: ${bank1Name}`), leftX, issuerY);
      issuerY += 3.6;
    }
    if (settings.invoiceAccountNumber) {
      doc.text(`Account: ${settings.invoiceAccountNumber}`, leftX, issuerY);
      issuerY += 3.6;
    }
    if (settings.invoiceSortCode) {
      doc.text(`Sort Code: ${settings.invoiceSortCode}`, leftX, issuerY);
      issuerY += 3.6;
    }
  }

  // Cont Bancar 2 (Opțional)
  if (settings.invoiceBankName2 || settings.invoiceAccountNumber2 || settings.invoiceSortCode2) {
    if (settings.invoiceBankName2) {
      doc.text(fixRomanianDiacritics(`Bank 2: ${settings.invoiceBankName2}`), leftX, issuerY);
      issuerY += 3.6;
    }
    if (settings.invoiceAccountNumber2) {
      doc.text(`Account 2: ${settings.invoiceAccountNumber2}`, leftX, issuerY);
      issuerY += 3.6;
    }
    if (settings.invoiceSortCode2) {
      doc.text(`Sort Code 2: ${settings.invoiceSortCode2}`, leftX, issuerY);
      issuerY += 3.6;
    }
  }

  // Detalii Client & Magazin Livrare
  let clientY = currentY;
  if (invoiceData.client.cui) {
    doc.text(`VAT No: ${invoiceData.client.cui}`, rightX, clientY);
    clientY += 3.6;
  }
  if (invoiceData.client.regCom) {
    doc.text(`CRN: ${invoiceData.client.regCom}`, rightX, clientY);
    clientY += 3.6;
  }
  if (invoiceData.client.address || invoiceData.client.postcode) {
    const addressWithCity = `${invoiceData.client.address}${invoiceData.client.city ? `, ${invoiceData.client.city}` : ''}`;
    const addressStr = fixRomanianDiacritics(formatAddressWithPostcode(addressWithCity, invoiceData.client.postcode));
    const lines = doc.splitTextToSize(`Address: ${addressStr}`, cardWidth);
    doc.text(lines, rightX, clientY);
    clientY += (lines.length * 3.6);
  }
  if (invoiceData.client.phone) {
    doc.text(`Phone: ${invoiceData.client.phone}`, rightX, clientY);
    clientY += 3.6;
  }
  if (invoiceData.store && invoiceData.store.name) {
    clientY += 1;
    doc.setFont("Arial", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(fixRomanianDiacritics(`Delivery Store: ${invoiceData.store.name}`), rightX, clientY, { maxWidth: cardWidth });
    doc.setFont("Arial", "normal");
    doc.setTextColor(71, 85, 105);
    clientY += 3.6;
    if (invoiceData.store.address) {
      const storeAddress = formatAddressWithPostcode(invoiceData.store.address, invoiceData.store.postcode);
      const locLines = doc.splitTextToSize(fixRomanianDiacritics(`Location: ${storeAddress}`), cardWidth);
      doc.text(locLines, rightX, clientY);
      clientY += (locLines.length * 3.6);
    } else if (invoiceData.store.postcode) {
      doc.text(fixRomanianDiacritics(`Location: ${formatAddressWithPostcode('', invoiceData.store.postcode)}`), rightX, clientY);
      clientY += 3.6;
    }
    if (invoiceData.store.phone) {
      doc.text(fixRomanianDiacritics(`Store Phone: ${invoiceData.store.phone}`), rightX, clientY);
      clientY += 3.6;
    }
  }

  currentY = Math.max(issuerY, clientY) + 3;

  // --- TABEL PRODUSE COMPACT ---
  const includesVat = settings.vatRegistered !== false;
  const tableColumn = includesVat
    ? ["#", "Description", "Unit", "Qty", "Unit Price (£)", "VAT", "Total (£)"]
    : ["#", "Description", "Unit", "Qty", "Unit Price (£)", "Total (£)"];
  const tableRows: any[] = [];

  invoiceData.items.forEach((item, index) => {
    const descriptionText = invoiceProductDescription(item);

    const row = [
      (index + 1).toString(),
      descriptionText,
      fixRomanianDiacritics(item.unit || "buc"),
      item.quantity.toString(),
      item.unitPrice.toFixed(2),
    ];
    if (includesVat) row.push('0%');
    row.push(item.totalPrice.toFixed(2));
    tableRows.push(row);
  });

  // Calcul nuanță rânduri alternate bazat pe culoare și opacitate din setări
  const targetHex = settings.invoiceAlternateRowColor || settings.invoiceColor || '#4F46E5';
  const [tr, tg, tb] = hexToRgb(targetHex);
  const rawOpacity = settings.invoiceAlternateRowOpacity !== undefined ? Number(settings.invoiceAlternateRowOpacity) : 5;
  const alpha = Math.max(0, Math.min(100, rawOpacity)) / 100;

  // Calcul amestec peste fundalul alb [255, 255, 255]
  const altR = Math.round(255 * (1 - alpha) + tr * alpha);
  const altG = Math.round(255 * (1 - alpha) + tg * alpha);
  const altB = Math.round(255 * (1 - alpha) + tb * alpha);

  const footerLayout = preparePdfFooter(doc, settings.invoiceFooter || 'Thank you for your business!');
  const summaryHeight = 18;
  const summaryGap = 4;

  autoTable(doc, {
    startY: currentY,
    head: [tableColumn],
    body: tableRows,
    theme: 'striped',
    styles: {
      font: 'Arial',
      fontSize: 7.5,
      cellPadding: 1.5,
      valign: 'middle',
      lineWidth: 0,
    },
    headStyles: {
      font: 'Arial',
      fontStyle: 'bold',
      fillColor: [r, g, b],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      cellPadding: { top: 2, right: 1.2, bottom: 2, left: 1.2 },
      valign: 'middle',
    },
    bodyStyles: {
      font: 'Arial',
      fontStyle: 'normal',
      textColor: [30, 41, 59], // Slate-800
      fontSize: 7.5,
      cellPadding: 1.5,
      valign: 'middle',
    },
    alternateRowStyles: {
      fillColor: [altR, altG, altB]
    },
    columnStyles: includesVat ? {
      0: { halign: 'center', cellWidth: INVOICE_VAT_COLUMN_WIDTHS[0] },
      1: { halign: 'left', cellWidth: INVOICE_VAT_COLUMN_WIDTHS[1] },
      2: { halign: 'center', cellWidth: INVOICE_VAT_COLUMN_WIDTHS[2] },
      3: { halign: 'center', cellWidth: INVOICE_VAT_COLUMN_WIDTHS[3] },
      4: { halign: 'center', cellWidth: INVOICE_VAT_COLUMN_WIDTHS[4] },
      5: { halign: 'center', cellWidth: INVOICE_VAT_COLUMN_WIDTHS[5] },
      6: { halign: 'center', cellWidth: INVOICE_VAT_COLUMN_WIDTHS[6] }
    } : {
      0: { halign: 'center', cellWidth: INVOICE_NON_VAT_COLUMN_WIDTHS[0] },
      1: { halign: 'left', cellWidth: INVOICE_NON_VAT_COLUMN_WIDTHS[1] },
      2: { halign: 'center', cellWidth: INVOICE_NON_VAT_COLUMN_WIDTHS[2] },
      3: { halign: 'center', cellWidth: INVOICE_NON_VAT_COLUMN_WIDTHS[3] },
      4: { halign: 'center', cellWidth: INVOICE_NON_VAT_COLUMN_WIDTHS[4] },
      5: { halign: 'center', cellWidth: INVOICE_NON_VAT_COLUMN_WIDTHS[5] }
    },
    margin: { left: 14, right: 14, bottom: footerLayout.reservedBottom + summaryHeight + summaryGap },
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    tableLineWidth: 0,
  });

  // --- SUMMARY CARD (TOTAL DE PLATĂ) ---
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerTop = pageHeight - footerLayout.reservedBottom;
  let finalTableY = ((doc as any).lastAutoTable?.finalY || currentY + 30) + summaryGap;
  if (finalTableY + summaryHeight > footerTop - 2) {
    doc.addPage();
    finalTableY = 14;
  }
  
  const summaryBoxWidth = 68;
  const summaryBoxX = 196 - summaryBoxWidth;

  doc.setFillColor(241, 245, 249); // Slate-100
  doc.roundedRect(summaryBoxX, finalTableY, summaryBoxWidth, 18, 2, 2, 'F');

  doc.setFontSize(7.5);
  doc.setFont("Arial", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("Subtotal:", summaryBoxX + 5, finalTableY + 4.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`£${invoiceData.totalAmount.toFixed(2)}`, 191, finalTableY + 4.5, { align: "right" });

  doc.setTextColor(100, 116, 139);
  doc.text(includesVat ? "VAT (0%):" : "VAT:", summaryBoxX + 5, finalTableY + 9);
  doc.setTextColor(15, 23, 42);
  doc.text(includesVat ? "£0.00" : "Not charged", 191, finalTableY + 9, { align: "right" });

  doc.setFontSize(9);
  doc.setFont("Arial", "bold");
  doc.setTextColor(r, g, b);
  doc.text("Total Due:", summaryBoxX + 5, finalTableY + 14.5);
  doc.text(`£${invoiceData.totalAmount.toFixed(2)}`, 191, finalTableY + 14.5, { align: "right" });

  // Footerul este desenat după ce numărul total de pagini este cunoscut.
  drawPdfFooters(doc, footerLayout);

  // Returnare Uint8Array
  const arrayBuffer = doc.output('arraybuffer');
  return new Uint8Array(arrayBuffer);
}

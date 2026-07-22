import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Helper pentru conversie Hex în RGB
function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [79, 70, 229]; // Indigo-600 implicit
}

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
      county?: string;
      city?: string;
    };
    store?: {
      name: string;
      address?: string;
    };
    items: Array<{
      productName: string;
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
  
  const primaryColor = hexToRgb(settings.invoiceColor || '#4F46E5');
  const [r, g, b] = primaryColor;

  // --- TOP ACCENT BAR (Modern Enterprise Design 2026) ---
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, 210, 4, 'F');

  // --- HEADER SECTION ---
  let currentY = 16;

  if (settings.invoiceLogo) {
    try {
      doc.addImage(settings.invoiceLogo, 'PNG', 14, currentY, 32, 32, undefined, 'FAST');
    } catch (e) {
      console.warn("Logo-ul nu a putut fi atașat pe PDF:", e);
    }
  }

  // Titlu "INVOICE" & Badge Serie/Număr
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(r, g, b);
  doc.text("INVOICE", 196, currentY + 6, { align: "right" });

  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139); // Slate-500
  const series = settings.invoiceSeries || 'INV';
  doc.text(`Ref: ${series} - #${invoiceData.invoiceNumber}`, 196, currentY + 12, { align: "right" });
  doc.text(`Date: ${invoiceData.invoiceDate}`, 196, currentY + 17, { align: "right" });

  currentY += 34;

  // --- SEPARATOR LINE ---
  doc.setDrawColor(226, 232, 240); // Slate-200
  doc.setLineWidth(0.4);
  doc.line(14, currentY, 196, currentY);

  currentY += 7;

  // --- CARDS SECTION: ISSUER (FROM) & CLIENT (BILL TO) ---
  const leftX = 14;
  const rightX = 110;
  const cardWidth = 86;

  // Header "FROM"
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(r, g, b);
  doc.text("ISSUER (FROM)", leftX, currentY);
  
  // Header "BILL TO"
  doc.text("BILL TO (CUSTOMER)", rightX, currentY);

  currentY += 5;

  // Nume Issuer & Nume Client
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42); // Slate-900
  const issuerName = settings.issuerName || "VATRA ROMANEASCA BAKERY SRL";
  doc.text(issuerName, leftX, currentY, { maxWidth: cardWidth });
  doc.text(invoiceData.client.name, rightX, currentY, { maxWidth: cardWidth });

  currentY += 5;

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105); // Slate-600

  // Detalii Issuer
  let issuerY = currentY;
  if (settings.issuerCrn) {
    doc.text(`CRN: ${settings.issuerCrn}`, leftX, issuerY);
    issuerY += 4.2;
  }
  if (settings.issuerVat) {
    doc.text(`VAT No: ${settings.issuerVat}`, leftX, issuerY);
    issuerY += 4.2;
  }
  if (settings.invoiceAccountNumber) {
    doc.text(`Account No: ${settings.invoiceAccountNumber}`, leftX, issuerY);
    issuerY += 4.2;
  }
  if (settings.invoiceSortCode) {
    doc.text(`Sort Code: ${settings.invoiceSortCode}`, leftX, issuerY);
    issuerY += 4.2;
  }

  // Detalii Client & Magazin Livrare
  let clientY = currentY;
  if (invoiceData.client.cui) {
    doc.text(`VAT No: ${invoiceData.client.cui}`, rightX, clientY);
    clientY += 4.2;
  }
  if (invoiceData.client.regCom) {
    doc.text(`CRN: ${invoiceData.client.regCom}`, rightX, clientY);
    clientY += 4.2;
  }
  if (invoiceData.client.address) {
    const addressStr = `${invoiceData.client.address}${invoiceData.client.city ? ', ' + invoiceData.client.city : ''}`;
    const lines = doc.splitTextToSize(`Address: ${addressStr}`, cardWidth);
    doc.text(lines, rightX, clientY);
    clientY += (lines.length * 4.2);
  }
  if (invoiceData.store && invoiceData.store.name) {
    clientY += 1.5;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(`Delivery Store: ${invoiceData.store.name}`, rightX, clientY, { maxWidth: cardWidth });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    clientY += 4.2;
    if (invoiceData.store.address) {
      const locLines = doc.splitTextToSize(`Location: ${invoiceData.store.address}`, cardWidth);
      doc.text(locLines, rightX, clientY);
      clientY += (locLines.length * 4.2);
    }
  }

  currentY = Math.max(issuerY, clientY) + 6;

  // --- TABEL PRODUSE MODERN (Stripe / Enterprise Style) ---
  const tableColumn = ["#", "Description", "Unit", "Qty", "Unit Price (£)", "Total (£)"];
  const tableRows: any[] = [];

  invoiceData.items.forEach((item, index) => {
    let mainTitle = item.productName || 'Produs';
    if (item.variant_label) {
      mainTitle += ` [${item.variant_label}]`;
    }
    
    let descriptionText = mainTitle;
    if (item.name_ro) {
      descriptionText += `\n${item.name_ro}`;
    }

    tableRows.push([
      (index + 1).toString(),
      descriptionText,
      item.unit || "buc",
      item.quantity.toString(),
      item.unitPrice.toFixed(2),
      item.totalPrice.toFixed(2)
    ]);
  });

  autoTable(doc, {
    startY: currentY,
    head: [tableColumn],
    body: tableRows,
    theme: 'striped',
    headStyles: {
      fillColor: [r, g, b],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: 3.5
    },
    bodyStyles: {
      textColor: [30, 41, 59], // Slate-800
      fontSize: 8.5,
      cellPadding: 3
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252] // Slate-50
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { cellWidth: 80 },
      2: { halign: 'center', cellWidth: 16 },
      3: { halign: 'right', cellWidth: 20 },
      4: { halign: 'right', cellWidth: 26 },
      5: { halign: 'right', cellWidth: 28 }
    },
    margin: { left: 14, right: 14 }
  });

  // --- SUMMARY CARD (TOTAL DE PLATĂ) ---
  const finalTableY = ((doc as any).lastAutoTable?.finalY || currentY + 30) + 6;
  
  const summaryBoxWidth = 72;
  const summaryBoxX = 196 - summaryBoxWidth;

  doc.setFillColor(241, 245, 249); // Slate-100
  doc.roundedRect(summaryBoxX, finalTableY, summaryBoxWidth, 18, 2, 2, 'F');

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("Subtotal:", summaryBoxX + 6, finalTableY + 6);
  doc.setTextColor(15, 23, 42);
  doc.text(`£ ${invoiceData.totalAmount.toFixed(2)}`, 190, finalTableY + 6, { align: "right" });

  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(r, g, b);
  doc.text("Total Due:", summaryBoxX + 6, finalTableY + 13);
  doc.text(`£ ${invoiceData.totalAmount.toFixed(2)}`, 190, finalTableY + 13, { align: "right" });

  // --- FOOTER & PAYMENT TERMS ---
  const pageHeight = doc.internal.pageSize.height;
  const footerY = pageHeight - 16;

  doc.setDrawColor(226, 232, 240);
  doc.line(14, footerY - 5, 196, footerY - 5);

  if (settings.invoiceFooter) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 116, 139);
    const lines = doc.splitTextToSize(settings.invoiceFooter, 150);
    doc.text(lines, 14, footerY);
  } else {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184); // Slate-400
    doc.text("Thank you for your business!", 14, footerY);
  }

  // Număr Pagină
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text("Page 1 of 1", 196, footerY, { align: "right" });

  // Returnare Uint8Array
  const arrayBuffer = doc.output('arraybuffer');
  return new Uint8Array(arrayBuffer);
}

import { jsPDF } from "jspdf";
import "jspdf-autotable";

// Helper for converting hex to RGB
function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [79, 70, 229]; // Default Indigo-600
}

export function generateInvoicePDF(
  settings: any,
  invoiceData: {
    invoiceNumber: string;
    invoiceDate: string; 
    client: {
      name: string;
      cui?: string; // VAT Number for client
      regCom?: string; // CRN for client
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
  const doc = new jsPDF();
  
  // Font styles
  doc.setFont("helvetica");

  const primaryColor = hexToRgb(settings.invoiceColor || '#4F46E5');

  // --- HEADER: ISSUER ---
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("FROM", 14, 20);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const issuerName = settings.issuerName || "VATRA ROMANEASCA BAKERY SRL";
  const issuerCrn = settings.issuerCrn || "";
  const issuerVat = settings.issuerVat || "";
  
  doc.text(`Company Name: ${issuerName}`, 14, 28);
  
  let nextYFurnizor = 34;
  if (issuerCrn) {
    doc.text(`CRN: ${issuerCrn}`, 14, nextYFurnizor);
    nextYFurnizor += 6;
  }
  if (issuerVat) {
    doc.text(`VAT Number: ${issuerVat}`, 14, nextYFurnizor);
    nextYFurnizor += 6;
  }

  // Bank details
  if (settings.invoiceAccountNumber) {
    doc.text(`Account No: ${settings.invoiceAccountNumber}`, 14, nextYFurnizor);
    nextYFurnizor += 6;
  }
  if (settings.invoiceSortCode) {
    doc.text(`Sort Code: ${settings.invoiceSortCode}`, 14, nextYFurnizor);
  }

  // --- LOGO ---
  if (settings.invoiceLogo) {
    try {
      doc.addImage(settings.invoiceLogo, 'PNG', 85, 12, 40, 40, undefined, 'FAST');
    } catch (e) {
      console.warn("Failed to add logo to PDF:", e);
    }
  }

  // --- HEADER: CUSTOMER ---
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("BILL TO", 130, 20);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  
  doc.text(`Name: ${invoiceData.client.name}`, 130, 28, { maxWidth: 65 });
  
  let currentY = 34;
  if (invoiceData.client.cui) { // Mapped as VAT for clients in UK context
    doc.text(`VAT No: ${invoiceData.client.cui}`, 130, currentY);
    currentY += 6;
  }
  if (invoiceData.client.regCom) { // Mapped as CRN for clients
    doc.text(`CRN: ${invoiceData.client.regCom}`, 130, currentY);
    currentY += 6;
  }
  if (invoiceData.client.address) {
    const addressStr = `${invoiceData.client.address}, ${invoiceData.client.city || ''}, ${invoiceData.client.county || ''}`.replace(/,\s*,/g, ',');
    doc.text(`Address: ${addressStr}`, 130, currentY, { maxWidth: 65 });
    currentY += 10;
  } else {
    currentY += 4;
  }
  
  if (invoiceData.store) {
    doc.setFont("helvetica", "bold");
    doc.text(`Delivery to: ${invoiceData.store.name}`, 130, currentY, { maxWidth: 65 });
    doc.setFont("helvetica", "normal");
    currentY += 5;
    if (invoiceData.store.address) {
      doc.text(`Location: ${invoiceData.store.address}`, 130, currentY, { maxWidth: 65 });
    }
  }

  // --- FACTURA DETALII ---
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("INVOICE", 105, 75, { align: "center" });

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Prefix: ${settings.invoiceSeries || 'INV'}  No: ${invoiceData.invoiceNumber}`, 105, 83, { align: "center" });
  doc.text(`Date: ${invoiceData.invoiceDate}`, 105, 89, { align: "center" });

  // --- TABEL PRODUSE ---
  const tableColumn = ["No.", "Description", "Unit", "Qty", "Unit Price", "Total"];
  const tableRows: any[] = [];

  invoiceData.items.forEach((item, index) => {
    const rowData = [
      (index + 1).toString(),
      item.productName,
      "pcs",
      item.quantity.toString(),
      item.unitPrice.toFixed(2),
      item.totalPrice.toFixed(2)
    ];
    tableRows.push(rowData);
  });

  (doc as any).autoTable({
    startY: 100,
    head: [tableColumn],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: primaryColor },
    styles: { font: "helvetica", fontSize: 10 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 15 },
      1: { cellWidth: 80 },
      2: { halign: 'center', cellWidth: 15 },
      3: { halign: 'right', cellWidth: 20 },
      4: { halign: 'right', cellWidth: 25 },
      5: { halign: 'right', cellWidth: 30 }
    }
  });

  // --- TOTALURI ---
  const finalY = (doc as any).lastAutoTable.finalY + 10;
  
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(`Total Amount Due: ${invoiceData.totalAmount.toFixed(2)}`, 195, finalY, { align: "right" });

  // --- FOOTER ---
  if (settings.invoiceFooter) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    const lines = doc.splitTextToSize(settings.invoiceFooter, 180);
    const pageHeight = doc.internal.pageSize.height;
    doc.text(lines, 14, pageHeight - 15);
  }

  // Generate buffer
  const arrayBuffer = doc.output('arraybuffer');
  return new Uint8Array(arrayBuffer);
}

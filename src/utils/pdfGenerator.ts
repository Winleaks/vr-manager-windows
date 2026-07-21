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
      cui?: string;
      regCom?: string;
      address?: string;
      county?: string;
      city?: string;
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

  // --- HEADER: FURNIZOR ---
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("FURNIZOR", 14, 20);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const issuerName = settings.issuerName || "VATRA ROMANEASCA BAKERY SRL";
  const issuerCui = settings.issuerCui || "RO12345678";
  
  doc.text(`Denumire: ${issuerName}`, 14, 28);
  doc.text(`C.I.F.: ${issuerCui}`, 14, 34);

  // Bank details
  let nextYFurnizor = 40;
  if (settings.invoiceBankName) {
    doc.text(`Banca: ${settings.invoiceBankName}`, 14, nextYFurnizor);
    nextYFurnizor += 6;
  }
  if (settings.invoiceIban) {
    doc.text(`IBAN: ${settings.invoiceIban}`, 14, nextYFurnizor);
  }

  // --- LOGO ---
  if (settings.invoiceLogo) {
    try {
      // settings.invoiceLogo should be a base64 string
      doc.addImage(settings.invoiceLogo, 'PNG', 85, 12, 40, 40, undefined, 'FAST');
    } catch (e) {
      console.warn("Failed to add logo to PDF:", e);
    }
  }

  // --- HEADER: CUMPARATOR ---
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("CUMPARATOR", 130, 20);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  
  doc.text(`Denumire: ${invoiceData.client.name}`, 130, 28, { maxWidth: 65 });
  
  let currentY = 34;
  if (invoiceData.client.cui) {
    doc.text(`C.I.F.: ${invoiceData.client.cui}`, 130, currentY);
    currentY += 6;
  }
  if (invoiceData.client.regCom) {
    doc.text(`Reg. Com.: ${invoiceData.client.regCom}`, 130, currentY);
    currentY += 6;
  }
  if (invoiceData.client.address) {
    const addressStr = `${invoiceData.client.address}, ${invoiceData.client.city || ''}, ${invoiceData.client.county || ''}`.replace(/,\s*,/g, ',');
    doc.text(`Sediul: ${addressStr}`, 130, currentY, { maxWidth: 65 });
  }

  // --- FACTURA DETALII ---
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURA FISCALA", 105, 75, { align: "center" });

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Seria: ${settings.invoiceSeries || 'FACT'}  Nr: ${invoiceData.invoiceNumber}`, 105, 83, { align: "center" });
  doc.text(`Data emiterii: ${invoiceData.invoiceDate}`, 105, 89, { align: "center" });

  // --- TABEL PRODUSE ---
  const tableColumn = ["Nr.", "Denumire Produse / Servicii", "U.M.", "Cantitate", "Pret Unitar\n(RON)", "Valoare\n(RON)"];
  const tableRows: any[] = [];

  invoiceData.items.forEach((item, index) => {
    const rowData = [
      (index + 1).toString(),
      item.productName,
      "buc",
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
  doc.text(`Total de Plata: ${invoiceData.totalAmount.toFixed(2)} RON`, 195, finalY, { align: "right" });

  // --- FOOTER ---
  if (settings.invoiceFooter) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    const lines = doc.splitTextToSize(settings.invoiceFooter, 180);
    // Put footer at the bottom of the page
    const pageHeight = doc.internal.pageSize.height;
    doc.text(lines, 14, pageHeight - 15);
  }

  // Generate buffer
  const arrayBuffer = doc.output('arraybuffer');
  return new Uint8Array(arrayBuffer);
}

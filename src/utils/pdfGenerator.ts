import { jsPDF } from "jspdf";
import "jspdf-autotable";

export function generateInvoicePDF(
  settings: any,
  invoiceData: {
    invoiceNumber: string;
    invoiceDate: string; // "DD.MM.YYYY"
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
  
  // Font sizes & styles
  doc.setFont("helvetica");

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

  // --- HEADER: CUMPARATOR ---
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("CUMPARATOR", 120, 20);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  
  doc.text(`Denumire: ${invoiceData.client.name}`, 120, 28, { maxWidth: 75 });
  
  let currentY = 34;
  if (invoiceData.client.cui) {
    doc.text(`C.I.F.: ${invoiceData.client.cui}`, 120, currentY);
    currentY += 6;
  }
  if (invoiceData.client.regCom) {
    doc.text(`Reg. Com.: ${invoiceData.client.regCom}`, 120, currentY);
    currentY += 6;
  }
  if (invoiceData.client.address) {
    const addressStr = `${invoiceData.client.address}, ${invoiceData.client.city || ''}, ${invoiceData.client.county || ''}`.replace(/,\s*,/g, ',');
    doc.text(`Sediul: ${addressStr}`, 120, currentY, { maxWidth: 75 });
  }

  // --- FACTURA DETALII ---
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURA FISCALA", 105, 70, { align: "center" });

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Seria: ${settings.invoiceSeries || 'FACT'}  Nr: ${invoiceData.invoiceNumber}`, 105, 78, { align: "center" });
  doc.text(`Data emiterii: ${invoiceData.invoiceDate}`, 105, 84, { align: "center" });

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
    startY: 95,
    head: [tableColumn],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229] }, // Indigo-600
    styles: { font: "helvetica", fontSize: 10 },
    columnStyles: {
      0: { cellWidth: 15, halign: 'center' },
      1: { cellWidth: 70 },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 20, halign: 'center' },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 30, halign: 'right' }
    }
  });

  // --- TOTALS ---
  const finalY = (doc as any).lastAutoTable.finalY + 10;
  
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL DE PLATA:", 135, finalY);
  doc.text(`${invoiceData.totalAmount.toFixed(2)} RON`, 190, finalY, { align: "right" });

  // Semnatura
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Semnatura si stampila\nfurnizorului", 14, finalY + 10);
  doc.text("Semnatura de primire", 120, finalY + 10);

  // Return ca buffer (Uint8Array)
  const arrayBuffer = doc.output('arraybuffer');
  return new Uint8Array(arrayBuffer);
}

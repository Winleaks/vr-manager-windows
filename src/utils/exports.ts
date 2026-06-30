import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../shared/api';

export async function exportToExcel(data: any[], filename: string, sheetName: string = 'Sheet1') {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  
  // Generate buffer
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  
  // Save via IPC
  const res = await api.system.saveFile({
    buffer: new Uint8Array(excelBuffer),
    defaultPath: `${filename}.xlsx`,
    filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
  });
  
  if (res.success) {
    alert(`Fișier salvat cu succes la:\n${res.filePath}`);
  }
}

export async function exportToPDF(
  headers: string[], 
  data: any[][], 
  filename: string, 
  title: string
) {
  const doc = new jsPDF();
  
  // Title
  doc.setFontSize(18);
  doc.text(title, 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Generat la: ${new Date().toLocaleString('ro-RO')}`, 14, 30);
  
  // Table
  autoTable(doc, {
    startY: 40,
    head: [headers],
    body: data,
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42] } // slate-900
  });
  
  const pdfBuffer = doc.output('arraybuffer');
  
  const res = await api.system.saveFile({
    buffer: new Uint8Array(pdfBuffer),
    defaultPath: `${filename}.pdf`,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  
  if (res.success) {
    alert(`Fișier salvat cu succes la:\n${res.filePath}`);
  }
}

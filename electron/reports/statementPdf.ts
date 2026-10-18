import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { registerFonts, fixRomanianDiacritics } from '../../src/utils/fonts/arialFonts.ts';
interface StatementReport {
  company: { name: string };
  issuer: { legal_name: string };
  from: string; to: string; opening: number; closing: number; legacyCredit: number;
  rows: Array<{ date: string; kind: string; reference: string; debit: number; credit: number; balance: number; store_name: string }>;
  scopeLabel?: string;
  accountNote?: string;
}

export function generateStatementPdf(report: StatementReport) {
  const doc = new jsPDF();
  registerFonts(doc);
  const text = (value: string) => fixRomanianDiacritics(value);
  const money = (value: number) => `£${value.toFixed(2)}`;
  doc.setFont('Arial','bold'); doc.setFontSize(19); doc.text('STATEMENT OF ACCOUNT',14,21);
  doc.setFontSize(10);
  const title = doc.splitTextToSize(text(`${report.issuer.legal_name}\n${report.company.name}${report.scopeLabel ? '\n' + report.scopeLabel : ''}`),180);
  doc.text(title,14,31);
  const y = 35 + title.length * 5;
  doc.setFont('Arial','normal'); doc.setFontSize(9);
  doc.text(`${report.from} - ${report.to} | GBP`,14,y);
  doc.text(`Opening balance: ${money(report.opening)}`,14,y+7);
  if(report.legacyCredit > 0) doc.text(`Includes migrated opening credit: ${money(report.legacyCredit)}`,14,y+12);
  let startY = y+(report.legacyCredit>0?18:12);
  if (report.accountNote) {
    const lines = doc.splitTextToSize(text(report.accountNote),180);
    doc.text(lines,14,startY); startY += lines.length * 4 + 4;
  }
  autoTable(doc,{
    startY, margin:{top:15,bottom:28,left:14,right:14},
    head:[['Date','Document / Store','Reference','Debit','Credit','Balance']],
    body:report.rows.map(row=>[row.date,text(`${row.kind}${row.store_name ? '\n'+row.store_name : ''}`),text(row.reference),money(row.debit),money(row.credit),money(row.balance)]),
    foot:[['','Closing balance','','','',money(report.closing)]], showFoot:'lastPage',
    styles:{font:'Arial',fontSize:8,cellPadding:2.5,halign:'center',valign:'middle'}, headStyles:{fillColor:[79,70,229]},
    columnStyles:{0:{cellWidth:24},1:{cellWidth:37},2:{cellWidth:46},3:{cellWidth:25},4:{cellWidth:25},5:{cellWidth:25}},
    rowPageBreak:'avoid',
  });
  for(let page=1;page<=doc.getNumberOfPages();page++){
    doc.setPage(page); doc.setFont('Arial','normal'); doc.setFontSize(8); doc.setTextColor(100);
    doc.text('Based on current ledger records. Negative balance means credit. Not a tax invoice.',14,282);
    doc.text(`${page} / ${doc.getNumberOfPages()}`,196,289,{align:'right'});
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

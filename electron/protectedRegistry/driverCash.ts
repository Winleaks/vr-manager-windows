import {randomUUID} from 'node:crypto';
import {companyPaymentDate,driverCashRequest,driverCashRequestMatches,type DriverCashCommand} from '../database/driverCash.ts';
import type {ProtectedInvoice,ProtectedIssuerCode,ProtectedRegistryVault} from './types.ts';

const duePence=(vault:ProtectedRegistryVault,invoice:ProtectedInvoice)=>Math.max(0,
  Math.round(invoice.totalAmount*100)-Math.round(invoice.paidAmount*100)-Math.round(invoice.creditedAmount*100)-
  vault.creditApplications.filter(row=>row.invoiceId===invoice.id&&!row.reversedAt).reduce((sum,row)=>sum+Math.round(row.amount*100),0));
const updateStatus=(vault:ProtectedRegistryVault,invoice:ProtectedInvoice)=>{
  if(invoice.status==='cancelled') return;
  invoice.status=duePence(vault,invoice)===0?'paid':duePence(vault,invoice)<Math.round(invoice.totalAmount*100)?'partial':'unpaid';
};

/** Mutates a clone only. Caller durably seals and commits it before applying cash/ack. */
export function applyProtectedDriverCash(vault:ProtectedRegistryVault,c:DriverCashCommand,issuerCode:ProtectedIssuerCode,previousZero?:{operationId:string;revision:number}) {
  if (vault.mode !== 'live') throw Object.assign(new Error('Sincronizarea încasării este în așteptare. Verifică configurarea facturării pe Writer.'),{retryable:true});
  const roots = vault.driverCashReceipts ??= [];
  let root = roots.find(row=>row.rootId===c.root_operation_id);
  const prior = root?.operations.find(row=>row.operationId===c.operation_id);
  if (prior) {
    if (!driverCashRequestMatches(prior.request,c)) throw new Error('Operație retrimisă cu alte date.');
    return;
  }
  const latest = root?.operations.at(-1);
  if (latest ? latest.operationId!==c.previous_operation_id || c.revision!==latest.revision+1 : c.revision!==1 &&
    (!previousZero || previousZero.operationId!==c.previous_operation_id || previousZero.revision+1!==c.revision))
    throw new Error('Încasarea a fost modificată sau lipsește operația anterioară.');
  const key = `vrbaker:${c.company_id}`;
  if (!c.company_id || root && (root.companyKey!==key || root.issuerCode!==issuerCode)) throw new Error('Asocierea încasării s-a modificat.');
  if (!root) {
    // A receipt that previously contained only zero revisions acquires its financial binding here.
    root={rootId:c.root_operation_id,companyKey:key,issuerCode,amountPence:0,operations:[],paymentIds:[]};
    roots.push(root);
  }
  if (root.amountPence!==c.amount_pence) {
    const payments = root.paymentIds.map(id=>vault.payments.find(row=>row.id===id));
    if (payments.some(row=>!row || row.reversedAt)) throw new Error('Alocările încasării necesită verificare.');
    const credits = vault.creditEntries.filter(row=>row.sourceType==='payment_overpayment' && root!.paymentIds.includes(row.sourceId));
    if (credits.some(row=>Math.round(row.availableAmount*100)!==Math.round(row.originalAmount*100)))
      throw new Error('Creditul încasării a fost deja utilizat. Verifică alocările înainte de corectare.');
    for (const payment of payments) {
      if (payment!.invoiceId) {
        const invoice=vault.invoices.find(row=>row.id===payment!.invoiceId);
        if (!invoice || Math.round(invoice.paidAmount*100)<Math.round(payment!.amount*100)) throw new Error('Factura încasării necesită verificare.');
        invoice.paidAmount=Math.round((invoice.paidAmount-payment!.amount)*100)/100;
        updateStatus(vault,invoice);
      }
      payment!.reversedAt=new Date().toISOString();payment!.reversalReason='Corectare încasare șofer';
    }
    // Preserve the original credit amount for audit; the source payment records its reversal.
    for (const credit of credits) credit.availableAmount=0;
    root.paymentIds=[];
    let remaining=c.amount_pence;
    const createdAt=new Date().toISOString(),paymentDate=companyPaymentDate(c.collected_at_ms??c.recorded_at_ms);
    const addPayment=(invoiceId:string|null,pence:number)=>{
      const payment={id:randomUUID(),operationId:c.operation_id,companyKey:key,issuerCode,invoiceId,amount:pence/100,paymentDate,
        method:'cash',notes:`Aplicație șofer · ${c.root_operation_id}`,createdAt,reversedAt:null,reversalReason:null,testEntry:false};
      vault.payments.push(payment);root!.paymentIds.push(payment.id);return payment;
    };
    const invoices=vault.invoices.filter(row=>row.companyKey===key && row.issuerCode===issuerCode && !row.testDocument && row.status!=='cancelled')
      .sort((a,b)=>a.invoiceDate.localeCompare(b.invoiceDate)||a.reference.localeCompare(b.reference));
    for (const invoice of invoices) {
      if (!remaining) break;
      const pence=Math.min(remaining,duePence(vault,invoice));
      if (pence<=0) continue;
      addPayment(invoice.id,pence);invoice.paidAmount=Math.round(invoice.paidAmount*100+pence)/100;
      updateStatus(vault,invoice);remaining-=pence;
    }
    if (remaining) {
      const payment=addPayment(null,remaining);
      vault.creditEntries.push({id:randomUUID(),companyKey:key,issuerCode,sourceType:'payment_overpayment',sourceId:payment.id,
        originalAmount:remaining/100,availableAmount:remaining/100,createdAt,testEntry:false});
    }
  }
  root.amountPence=c.amount_pence;
  root.operations.push({operationId:c.operation_id,request:driverCashRequest(c),revision:c.revision,amountPence:c.amount_pence});
}

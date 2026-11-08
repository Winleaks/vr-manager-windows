import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
const state={calls:[] as any[],fail:false,exports:[] as any[]};(window as any).__invoices=state;
(window as any).desktopApi={billing:{getInvoicePage:async(q:any)=>{state.calls.push(q);await new Promise(r=>setTimeout(r,q.search==='slow'?800:100));if(state.fail)throw Error('Eroare de test');const total=q.search?1:10000;return {total,page:q.search?1:q.page,pageSize:50,rows:Array.from({length:q.search?1:50},(_,i)=>({id:(q.page-1)*50+i+1,invoice_number:q.search||`TEST-${(q.page-1)*50+i+1}`,invoice_date:'2026-11-01',company_id:1,store_id:1,total_amount:100,paid_amount:20,outstanding:60,appliedCredit:20,status:'partial',store_name:'Magazin test',company_name:'Companie test',issuer_id:1}))};},getIssuers:async()=>[],getTestMode:async()=>({enabled:false})},system:{saveFile:async(options:any)=>{state.exports.push({name:options.defaultPath,bytes:Array.from(options.buffer)});return {success:false};},getDeviceRole:async()=>({role:'viewer'})}};
const {BillingInvoices}=await import('../../src/pages/BillingInvoices');
createRoot(document.getElementById('root')!).render(<BillingInvoices/>);

(window as any).__testExports=async()=>{const {exportToExcel,exportToPDF}=await import('../../src/utils/exports');await exportToExcel([{Name:'Test',Amount:12.5}],'fixture');await exportToPDF(['Name','Amount'],[['Test',12.5]],'fixture','Test');};

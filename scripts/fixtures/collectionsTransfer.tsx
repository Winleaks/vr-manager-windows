import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
const state={calls:[] as any[],fail:false};(window as any).__collections=state;
(window as any).desktopApi={drivers:{getAll:async()=>[{id:1,name:'Șofer A'},{id:2,name:'Șofer B'}]},dailyCash:{getDriverCollectionsReport:async(startDate:string,endDate:string,driverId:number)=>{await new Promise(resolve=>setTimeout(resolve,50));if(state.fail)throw Error('offline');return {startDate,endDate,driverId,totalPence:driverId===1?4250:0,stores:driverId===1?[{storeId:1,storeName:'Magazin A',amountPence:3000,receipts:2},{storeId:2,storeName:'Magazin B',amountPence:1250,receipts:1}]:[]};}},protectedRegistry:{getTransferPreview:async()=>({invoice:{id:'invoice',reference:'TGBL-1',companyName:'Company',storeName:'Shop',issuerCode:'goodness',totalAmount:100,paidAmount:30,invoiceDate:'2026-11-01'},appliedCredit:20,expectedVersion:'snapshot',blockedReason:null,payments:[],invoiceDate:'2026-11-07'}),transferInvoice:async(input:any)=>{state.calls.push(input);return {success:true,invoiceId:42,invoiceNumber:'TGB-42'};}}};
const { DriverCollectionsReport }=await import('../../src/components/DriverCollectionsReport');
const { ProtectedTransferModal }=await import('../../src/components/ProtectedTransferModal');
function Fixture(){const [open,setOpen]=useState(false);return <main className="p-5 max-w-3xl mx-auto"><DriverCollectionsReport startDate="2026-11-07" endDate="2026-11-07" refreshKey={0}/><button onClick={()=>setOpen(true)}>Transfer test</button>{open&&<ProtectedTransferModal invoiceId="invoice" onClose={()=>setOpen(false)} onChanged={()=>{}}/>}</main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);

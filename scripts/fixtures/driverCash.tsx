// Synthetic fixture: no Electron database or external requests.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
const calls:unknown[]=[];
let fail=true;
const status={error:null,conflicts:[{operation_id:'conflict',result:JSON.stringify({error:'Credit deja utilizat.'})}],officeRequests:[],invalidReports:[{date:'2026-10-07'}],receipts:[{root_id:'root',revision:4,driver_name:'Șofer test',store_name:'Magazin test',recorded_at_ms:1791378000000,amount_pence:12550}]};
(window as any).__cashTest={calls,setFail:(value:boolean)=>{fail=value;}};
(window as any).desktopApi={dailyCash:{getDriverCashStatus:async()=>structuredClone(status),syncDriverCash:async()=>{},retryDriverCashConflict:async(id:string)=>{calls.push({retry:id});},correctDriverReceipt:async(payload:any)=>{calls.push(payload);await new Promise(r=>setTimeout(r,200));if(fail)throw new Error('Conflict de versiune. Reîncarcă încasarea.');status.receipts[0].amount_pence=Math.round(payload.amount*100);status.receipts[0].revision++;}}};
const {DriverCashStatus}=await import('../../src/components/DriverCashStatus');
const refresh=async()=>{};
createRoot(document.getElementById('root')!).render(<DriverCashStatus writer={new URLSearchParams(location.search).get('role')!=='viewer'} onChanged={refresh}/>);

import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
const state={mode:'clean',calls:0};(window as any).__sync=state;
(window as any).desktopApi={billing:{getPublicationStatus:async()=>({writer:true,publishing:state.mode==='running',protectedPending:false,identity:{source_id:'fixture'},invoiceCount:1100,folderId:'fixture',lastConfirmedAt:Date.now(),excluded:[],pending:['blocked','temporary','pending'].includes(state.mode)?[{company_id:1,name:'Magazin test',state:state.mode==='blocked'?'association_required':state.mode==='temporary'?'temporary_error':'pending',reason:state.mode==='blocked'?'Compania nu are o asociere VR Baker validă.':'Conexiunea nu a confirmat datele.',stores:state.mode==='blocked'?[{name:'Magazin test'}]:[],nextAttemptAt:state.mode==='blocked'?null:Date.now()+5000}]:[]}),publishNow:async()=>{state.calls++;state.mode='clean';}}};
const {FinancialSyncBanner}=await import('../../src/components/FinancialSyncBanner');
const {BillingPublicationSettings}=await import('../../src/components/BillingPublicationSettings');
createRoot(document.getElementById('root')!).render(<><FinancialSyncBanner/><main className="max-w-4xl p-6"><BillingPublicationSettings isWriter={true}/></main></>);

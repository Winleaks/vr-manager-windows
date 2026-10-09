import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ExternalApiRequestError,parseBoundedInteger,requireUuid} from '../../supabase/functions/_shared/external-api-security.ts';
import {resolveStoreCompany,storeCompanyColumns} from '../../supabase/functions/_shared/store-company.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const source=readFileSync(new URL('../../supabase/functions/external-api/index.ts',import.meta.url),'utf8');
function actions(section:string,supabaseAdmin:any) {
 const code=ts.transpileModule(`const actions={${section}};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const bindings={ExternalApiRequestError,parseBoundedInteger,requireUuid,supabaseAdmin,resolveStoreCompany,storeCompanyColumns,
  ensureDatabaseSuccess:(error:any)=>{if(error)throw error;},ensureCashDatabaseSuccess:(error:any)=>{if(error)throw error;}};
 return new Function(...Object.keys(bindings),code+';return actions;')(...Object.values(bindings));
}
test('actual external API keeps default v1 RPCs and opts pending/ack into bounded v2 only',async()=>{
 const calls:any[]=[];
 const api=actions(source.slice(source.indexOf('"driver.cash.pending":'),source.indexOf('"driver.cash.correct":')),
  {rpc:async(name:string,payload:any)=>{calls.push({name,payload});return {data:true,error:null};}});
 for(const v of [undefined,1,2]) {
  const payload={source_id:id(1),operation_id:id(2),state:'PROCESSED',result:{revision:1},protocol_version:v};
  await api['driver.cash.pending'].handler(payload);await api['driver.cash.ack'].handler(payload);
 }
 assert.deepEqual(calls.map(x=>x.name),['hub_driver_cash_pending','hub_driver_cash_ack','hub_driver_cash_pending','hub_driver_cash_ack','hub_driver_cash_pending_v2','hub_driver_cash_ack_v2']);
 for(const v of [0,3,1.5,'garbage'])await assert.rejects(api['driver.cash.pending'].handler({source_id:id(1),protocol_version:v}));
 assert.equal(calls.length,6);
});
test('scoped store export excludes an unrelated contradictory association while the full export fails closed',async()=>{
 const company={id:id(1),name:'Company'};const owner={id:id(2),client_company_id:company.id,client_company:company};
 const good={id:id(3),name:'Store',owner_id:owner.id,company_owner:owner,client_company_id:null,client_company:null};
 const bad={...good,id:id(4),client_company_id:id(5),client_company:{id:id(5),name:'Other'}};
 const aliases=[{old_store_id:id(6),store_id:good.id},{old_store_id:id(7),store_id:bad.id}];
 const adapter={from:(table:string)=>{
  let rows:any[]=table==='client_store'?[good,bad]:aliases;
  const query={select:()=>query,order:()=>query,limit:()=>query,
   in:(key:string,ids:string[])=>{rows=rows.filter(r=>ids.includes(r[key]));return query;},
   then:(resolve:any)=>Promise.resolve(resolve({data:rows,count:rows.length,error:null}))};return query;
 }};
 const api=actions(source.slice(source.indexOf('"stores.list":'),source.indexOf('"orders.weekly_export":')),adapter);
 await assert.rejects(api['stores.list'].handler({include_meta:true}));
 const result=await api['stores.list'].handler({include_meta:true,store_ids:[good.id]});
 assert.equal(result.complete,true);assert.equal(result.count,1);assert.equal(result.rows[0].client_company_id,company.id);
 assert.deepEqual(result.merges,[aliases[0]]);assert.equal('company_owner' in result.rows[0],false);
 for(const selection of [[],['invalid'],new Array(51).fill(good.id)])await assert.rejects(api['stores.list'].handler({store_ids:selection}));
});

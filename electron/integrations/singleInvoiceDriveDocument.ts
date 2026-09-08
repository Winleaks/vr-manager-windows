import { createHash } from 'node:crypto';
import { InvoiceDriveDocumentError, updateInvoiceDriveDocument } from './invoiceDriveDocument.ts';
import {validatePdfFilename} from '../security/fileValidation.ts';

const options = {timeout:30_000,retry:false};
const fields = 'id,name,parents,mimeType,trashed,md5Checksum,size';
export type InvoicePdfCopy = {id:string;name:string;parents:string[];md5Checksum:string;size:string};
const validId=(id:string)=>/^[A-Za-z0-9_-]{10,200}$/.test(id);
const quote=(name:string)=>name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
function scopedAncestry(drive:any,rootId:string) {
  if(!validId(rootId))throw new InvoiceDriveDocumentError('Folderul facturilor este invalid.');
  const cache=new Map<string,boolean>([[rootId,true]]);
  const check=async(parents:string[],seen=new Set<string>()):Promise<boolean>=>{
    if(parents.length!==1||!validId(parents[0])||seen.size>6||seen.has(parents[0]))throw new InvoiceDriveDocumentError('Structura folderelor facturii nu poate fi verificată.');
    const id=parents[0];if(cache.has(id))return cache.get(id)!;seen.add(id);
    const {data}=await drive.files.get({fileId:id,fields:'id,parents,mimeType,trashed',supportsAllDrives:true},options);
    if(data.id!==id||data.trashed||data.mimeType!=='application/vnd.google-apps.folder')throw new InvoiceDriveDocumentError('Folderul facturii nu poate fi verificat.');
    const result=data.parents?.length?await check(data.parents,seen):false;cache.set(id,result);return result;
  };
  return check;
}

/** Select one canonical PDF. Old technical names are recognized only by the
 * exact Writer + invoice identity, never by a company-name similarity. */
export async function syncSingleInvoicePdf(drive:any, input:{
  rootId:string;parentId:string;filenames:string[];buffer:Uint8Array;
  sourceId:string;invoiceId:number;fileId?:string|null;
  previousCopies?:InvoicePdfCopy[];
  assertCurrent:()=>void;
  remember:(fileId:string|null,copies:InvoicePdfCopy[])=>void;
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.sourceId) || !Number.isSafeInteger(input.invoiceId) || input.invoiceId<=0) {
    throw new InvoiceDriveDocumentError('Identitatea facturii pentru Drive este invalidă.');
  }
  const prefix=`Invoice_${input.sourceId}_${input.invoiceId}_`;
  if(!input.filenames.length||!input.buffer.byteLength||input.buffer.byteLength>25*1024*1024||Buffer.from(input.buffer).subarray(0,5).toString()!=='%PDF-') throw new InvoiceDriveDocumentError('PDF-ul facturii nu este valid.');
  input.filenames.forEach(validatePdfFilename);
  const technical=(name:string)=>name.startsWith(prefix) && /^\d+_[0-9a-f]{16}\.pdf$/.test(name.slice(prefix.length));
  const inRoot=scopedAncestry(drive,input.rootId);
  // Search just this invoice, not every client's folders on each retry.
  const response=await drive.files.list({q:`trashed=false and (${input.filenames.map(name=>`name='${quote(name)}'`).join(' or ')} or name contains '${quote(prefix)}')`,fields:`files(${fields}),nextPageToken`,pageSize:100},options);
  if(response.data.nextPageToken)throw new InvoiceDriveDocumentError('Prea multe copii ale facturii; este necesară verificarea manuală.');
  const candidates=(response.data.files||[]).filter((f:any)=>input.filenames.includes(f.name)||typeof f.name==='string'&&technical(f.name));
  const rows:InvoicePdfCopy[]=[];
  for(const candidate of candidates) {
    if(!validId(candidate.id||''))throw new InvoiceDriveDocumentError('Identitatea PDF-ului este invalidă.');
    const {data}=await drive.files.get({fileId:candidate.id,fields,supportsAllDrives:true},options);
    if(data.id!==candidate.id||data.name!==candidate.name||data.trashed||data.mimeType!=='application/pdf'||
      !/^[a-f0-9]{32}$/.test(data.md5Checksum||'')||!Array.isArray(data.parents)||data.parents.length!==1) {
      throw new InvoiceDriveDocumentError('Metadatele copiei facturii nu pot fi verificate.');
    }
    if(await inRoot(data.parents))rows.push(data);
  }
  if (input.fileId && !rows.some(f=>f.id===input.fileId)) throw new InvoiceDriveDocumentError('PDF-ul asociat lipsește sau a fost mutat/redenumit. Verifică asocierea înainte de sincronizare.');
  const readable=rows.filter(f=>input.filenames.includes(f.name));
  const snapshots=rows.filter(f=>technical(f.name)).sort((a,b)=>Number(b.name.slice(prefix.length).split('_')[0])-Number(a.name.slice(prefix.length).split('_')[0]));
  if(readable.filter(f=>f.id!==input.fileId).length>1) throw new InvoiceDriveDocumentError('Există mai multe PDF-uri cu numărul facturii. Verifică duplicatele.');
  const existing=rows.find(f=>f.id===input.fileId)||snapshots[0]||readable[0];
  const checksum=createHash('md5').update(input.buffer).digest('hex');
  // A human-readable file is not intrinsically application-owned. Consolidate it
  // only if its bytes match a proven technical copy or the new official PDF.
  for(const copy of readable.filter(f=>f.id!==existing?.id)) {
    const remembered=input.previousCopies?.some(c=>c.id===copy.id&&c.name===copy.name&&c.md5Checksum===copy.md5Checksum&&String(c.size)===String(copy.size)&&JSON.stringify(c.parents)===JSON.stringify(copy.parents));
    if(!remembered && copy.md5Checksum!==checksum && !snapshots.some(s=>s.md5Checksum===copy.md5Checksum&&s.size===copy.size)) {
      throw new InvoiceDriveDocumentError('Copia cu numele scurt are conținut diferit. Verifică factura înainte de unificare.');
    }
  }
  input.assertCurrent();
  input.remember(existing?.id||null,rows.filter(f=>f.id!==existing?.id));
  const result=await updateInvoiceDriveDocument(drive,{
    rootId:input.rootId,parentId:input.parentId,buffer:input.buffer,assertCurrent:input.assertCurrent,
    fileId:existing?.id,filenames:existing?[existing.name]:input.filenames,
    canonicalName:input.filenames[0],
  });
  input.remember(result.fileId,rows.filter(f=>f.id!==existing?.id));
  return result;
}

// Called only AFTER the company publication is acknowledged. Never permanently
// delete: recoverable trash, exact captured metadata, same scoped invoice tree.
export async function trashConfirmedInvoiceCopy(drive:any, rootId:string, copy:InvoicePdfCopy, assertCurrent:()=>void) {
  const {data}=await drive.files.get({fileId:copy.id,fields,supportsAllDrives:true},options);
  if(data.trashed) return;
  if(data.name!==copy.name||data.md5Checksum!==copy.md5Checksum||String(data.size)!==String(copy.size)||
    data.mimeType!=='application/pdf'||JSON.stringify(data.parents)!==JSON.stringify(copy.parents)) {
    throw new InvoiceDriveDocumentError('O copie a facturii s-a schimbat în Drive; curățarea a fost oprită.');
  }
  if(!await scopedAncestry(drive,rootId)(data.parents||[])) {
    throw new InvoiceDriveDocumentError('Copia facturii nu mai este în folderul configurat.');
  }
  assertCurrent();
  await drive.files.update({fileId:copy.id,requestBody:{trashed:true},fields:'id,trashed',supportsAllDrives:true},options);
  if(!(await drive.files.get({fileId:copy.id,fields:'id,trashed',supportsAllDrives:true},options)).data.trashed) {
    throw new InvoiceDriveDocumentError('Drive nu a confirmat mutarea copiei în coș.');
  }
  assertCurrent();
}

import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ProtectedBillingDelivery } from './billingPublication.ts';

const AAD = Buffer.from('vr-hub-protected-publication-receipts:v1');
const MAX_BYTES = 1024 * 1024;
type Receipts = { version: 1; scope: string; confirmed: Record<string,string> };
export interface PublicationReceipts {
  has(data: ProtectedBillingDelivery): boolean;
  confirm(data: ProtectedBillingDelivery): void;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function publicationFingerprint(data: ProtectedBillingDelivery) {
  return digest({...data,invoices:[...data.invoices].sort((a,b)=>a.id.localeCompare(b.id)),deleted:[...data.deleted].sort()});
}

/** Derived confirmations only. Never stores money, documents or unacknowledged work. */
export class ProtectedPublicationReceipts {
  private filename: string;
  private key: () => Buffer;
  constructor(filename: string, key: () => Buffer) { this.filename=filename; this.key=key; }
  clear() {
    try { fs.unlinkSync(this.filename); } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  forScope(scope: string): PublicationReceipts {
    const scopeHash=digest(scope);
    const identity=(data: ProtectedBillingDelivery)=>digest([data.source_id,data.company_id]);
    return {
      has: data => this.read(scopeHash).confirmed[identity(data)]===publicationFingerprint(data),
      confirm: data => {
        const state=this.read(scopeHash);
        state.confirmed[identity(data)]=publicationFingerprint(data);
        this.write(state);
      },
    };
  }
  private read(scope: string): Receipts {
    const empty: Receipts={version:1,scope,confirmed:{}};
    try {
      const stat=fs.lstatSync(this.filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size>MAX_BYTES) return empty;
      const raw=JSON.parse(fs.readFileSync(this.filename,'utf8'));
      if (raw.version!==1) return empty;
      const decipher=createDecipheriv('aes-256-gcm',this.key(),Buffer.from(raw.iv,'base64'));
      decipher.setAAD(AAD);decipher.setAuthTag(Buffer.from(raw.tag,'base64'));
      const value=JSON.parse(Buffer.concat([decipher.update(Buffer.from(raw.ciphertext,'base64')),decipher.final()]).toString('utf8'));
      if(value.version!==1 || value.scope!==scope || !value.confirmed || typeof value.confirmed!=='object' || Array.isArray(value.confirmed)) return empty;
      if(Object.entries(value.confirmed).some(([k,v])=>! /^[a-f0-9]{64}$/.test(k) || typeof v!=='string' || !/^[a-f0-9]{64}$/.test(v))) return empty;
      return value;
    } catch { return empty; } // Unreadable confirmation means retry, never assume success.
  }
  private write(value: Receipts) {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key(),iv);cipher.setAAD(AAD);
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    const bytes=Buffer.from(JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));
    if(bytes.length>MAX_BYTES) throw Error('Confirmările publicării depășesc limita locală.');
    fs.mkdirSync(path.dirname(this.filename),{recursive:true,mode:0o700});
    const temporary=`${this.filename}.${randomUUID()}.tmp`;
    const fd=fs.openSync(temporary,'wx',0o600);
    try {
      try { fs.writeFileSync(fd,bytes);fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary,this.filename);
    }
    finally { if(fs.existsSync(temporary))fs.unlinkSync(temporary); }
    if(process.platform!=='win32') {
      const directory=fs.openSync(path.dirname(this.filename),'r');
      try {fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
    }
  }
}

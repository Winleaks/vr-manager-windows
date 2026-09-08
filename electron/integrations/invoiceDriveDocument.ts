import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { assertUploadedFileMatches } from '../database/cloudSyncPolicy.ts';
import { validatePdfFilename } from '../security/fileValidation.ts';

const folderMime = 'application/vnd.google-apps.folder';
const fields = 'id,name,parents,mimeType,trashed,md5Checksum,size';
const options = { timeout: 30_000, retry: false };
const validId = (value: string) => /^[A-Za-z0-9_-]{10,200}$/.test(value);
const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class InvoiceDriveDocumentError extends Error {}

// Serialize reads AND writes: a later save must never be overwritten by an older upload.
const pending = new Map<number, Promise<unknown>>();
export function withInvoiceDriveLock<T>(invoiceId: number, action: () => Promise<T>): Promise<T> {
  const previous = pending.get(invoiceId) || Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  pending.set(invoiceId, next);
  void next.finally(() => { if (pending.get(invoiceId) === next) pending.delete(invoiceId); }).catch(() => {});
  return next;
}

/** Update the operator's existing PDF in place, including PDFs in legacy folders.
 * Names come from SQLite, never from renderer paths. A match outside the configured
 * invoice tree is not ours; duplicates inside it require manual resolution.
 */
export async function updateInvoiceDriveDocument(drive: any, input: {
  rootId: string; parentId: string; filenames: string[]; buffer: Uint8Array;
  assertCurrent: () => void;
  legacyRootIds?: string[];
  fileId?: string;
  canonicalName?: string;
}) {
  if (!validId(input.rootId) || !validId(input.parentId) || !input.filenames.length) {
    throw new InvoiceDriveDocumentError('Identitatea folderului facturii este invalidă.');
  }
  const names = [...new Set(input.filenames.map(validatePdfFilename))];
  if (!input.buffer.byteLength || input.buffer.byteLength > 25 * 1024 * 1024 || Buffer.from(input.buffer).subarray(0, 5).toString() !== '%PDF-') {
    throw new InvoiceDriveDocumentError('PDF-ul facturii nu este valid.');
  }
  const ancestry = new Map<string, boolean>([[input.rootId, true]]);
  const inInvoiceTree = async (parents: string[], seen = new Set<string>()): Promise<boolean> => {
    if (parents.length !== 1 || !validId(parents[0]) || seen.size > 6) throw new InvoiceDriveDocumentError('Structura folderelor facturii nu poate fi verificată.');
    const id = parents[0];
    if (ancestry.has(id)) return ancestry.get(id)!;
    if (seen.has(id)) throw new InvoiceDriveDocumentError('Structura folderelor facturii nu poate fi verificată.');
    seen.add(id);
    const { data } = await drive.files.get({ fileId: id, fields: 'id,mimeType,trashed,parents', supportsAllDrives: true }, options);
    if (data.trashed || data.mimeType !== folderMime) throw new InvoiceDriveDocumentError('Folderul facturii nu mai este disponibil.');
    const result = data.parents?.length ? await inInvoiceTree(data.parents, seen) : false;
    ancestry.set(id, result);
    return result;
  };
  if (!await inInvoiceTree([input.parentId])) throw new InvoiceDriveDocumentError('Destinația nu este în folderul de facturi configurat.');
  // Credits may have an old, explicitly resolved application-owned issuer folder.
  // Destination validation above still requires the current invoice root.
  for (const id of input.legacyRootIds || []) {
    if (!validId(id)) throw new InvoiceDriveDocumentError('Identitatea folderului vechi este invalidă.');
    ancestry.set(id,true);
  }
  if (input.fileId && !validId(input.fileId)) throw new InvoiceDriveDocumentError('Identitatea PDF-ului este invalidă.');
  const response = input.fileId ? { data: { files: [(await drive.files.get({fileId:input.fileId,fields,supportsAllDrives:true},options)).data] } } : await drive.files.list({
    q: `trashed=false and (${names.map(name => `name='${quote(name)}'`).join(' or ')})`,
    fields: `files(${fields}),nextPageToken`, pageSize: 100,
  }, options);
  if (response.data.nextPageToken) throw new InvoiceDriveDocumentError('Prea multe copii ale facturii în Drive. Verifică duplicatele.');
  const matches: any[] = [];
  for (const file of response.data.files || []) {
    if (!validId(file.id || '') || (input.fileId && file.id!==input.fileId) || !names.includes(file.name)) throw new InvoiceDriveDocumentError('Identitatea PDF-ului nu poate fi verificată.');
    if (!await inInvoiceTree(file.parents || [])) {
      if (input.fileId) throw new InvoiceDriveDocumentError('PDF-ul asociat nu se află în folderul de facturi.');
      continue;
    }
    if (file.trashed || file.mimeType !== 'application/pdf') throw new InvoiceDriveDocumentError('Fișierul existent al facturii nu este un PDF valid.');
    matches.push(file);
  }
  if (matches.length > 1) throw new InvoiceDriveDocumentError('Există mai multe PDF-uri pentru această factură în Drive. Rezolvă duplicatele înainte de încărcare.');
  const existing = matches[0];
  const name = input.canonicalName ? validatePdfFilename(input.canonicalName) : existing?.name || names[0];
  // Recheck after discovery; edits, role changes and database replacement invalidate this upload.
  input.assertCurrent();
  let fileId: string;
  const media = { mimeType: 'application/pdf', body: Readable.from([Buffer.from(input.buffer)]) };
  if (existing) {
    const current = (await drive.files.get({ fileId: existing.id, fields, supportsAllDrives: true }, options)).data;
    if (current.trashed || current.mimeType !== 'application/pdf' || current.name !== existing.name ||
      JSON.stringify(current.parents) !== JSON.stringify(existing.parents)) {
      throw new InvoiceDriveDocumentError('PDF-ul a fost mutat sau modificat în Drive. Reîncearcă.');
    }
    input.assertCurrent();
    const move = existing.parents.includes(input.parentId) ? {} : {
      addParents: input.parentId, removeParents: existing.parents.join(','),
    };
    const unchanged = current.name === name && current.parents.includes(input.parentId) &&
      current.md5Checksum === createHash('md5').update(input.buffer).digest('hex') && Number(current.size) === input.buffer.byteLength;
    const updated = unchanged ? {data:{id:existing.id}} : await drive.files.update({ fileId: existing.id,
      ...(current.name === name ? {} : {requestBody:{name}}), media, ...move, fields: 'id', supportsAllDrives: true }, options);
    if (updated.data.id !== existing.id) throw new InvoiceDriveDocumentError('Drive nu a confirmat actualizarea aceluiași fișier.');
    fileId = existing.id;
  } else {
    const created = await drive.files.create({ requestBody: { name, parents: [input.parentId] }, media, fields: 'id', supportsAllDrives: true }, options);
    fileId = created.data.id;
  }
  if (!validId(fileId || '')) throw new InvoiceDriveDocumentError('Drive nu a confirmat fișierul facturii.');
  const verified = assertUploadedFileMatches((await drive.files.get({ fileId, fields, supportsAllDrives: true }, options)).data, {
    name, parentId: input.parentId, md5Checksum: createHash('md5').update(input.buffer).digest('hex'), size: input.buffer.byteLength,
  });
  input.assertCurrent();
  return verified;
}

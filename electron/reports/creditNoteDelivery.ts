import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { toValidatedPdfBuffer } from '../security/fileValidation.ts';

export function creditNoteFilename(reference: string) {
  if (typeof reference !== 'string' || !/^[A-Z0-9-]{1,60}$/i.test(reference)) throw new Error('Referința Credit Note nu este validă.');
  return `Credit_Note_${reference}.pdf`;
}

export function saveCreditNotePdf(documentsPath: string, issuerCode: string, reference: string, pdfInput: unknown) {
  if (!/^[a-z0-9-]{1,40}$/i.test(issuerCode)) throw new Error('Codul emitentului nu este valid.');
  const directory = path.join(documentsPath, 'VR - Hub Management', 'Credit Notes', issuerCode.toLowerCase());
  fs.mkdirSync(directory, { recursive: true });
  const filename = creditNoteFilename(reference);
  const destination = path.join(directory, filename);
  const staged = path.join(directory, `.${filename}.${randomUUID()}.tmp`);
  const previous = path.join(directory, `.${filename}.${randomUUID()}.previous`);
  let previousMoved = false;
  try {
    fs.writeFileSync(staged, toValidatedPdfBuffer(pdfInput), { flag: 'wx' });
    if (fs.existsSync(destination)) { fs.renameSync(destination, previous); previousMoved = true; }
    fs.renameSync(staged, destination);
    if (previousMoved) fs.unlinkSync(previous);
    previousMoved = false;
  } catch (error) {
    if (!fs.existsSync(destination) && previousMoved && fs.existsSync(previous)) fs.renameSync(previous, destination);
    throw error;
  } finally {
    try { if (fs.existsSync(staged)) fs.unlinkSync(staged); } catch {}
    try { if (fs.existsSync(previous)) fs.unlinkSync(previous); } catch {}
  }
  return { filename, filePath: destination };
}

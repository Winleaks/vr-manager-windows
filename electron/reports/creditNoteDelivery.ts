import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { toValidatedPdfBuffer } from '../security/fileValidation.ts';
import { localClientDocumentDirectory } from './clientDocumentStorage.ts';

export function creditNoteFilename(reference: string) {
  if (typeof reference !== 'string' || !/^[A-Z0-9-]{1,60}$/i.test(reference)) throw new Error('Referința Credit Note nu este validă.');
  return `Credit_Note_${reference}.pdf`;
}

export function saveCreditNotePdf(documentsPath: string, companyName: string, reference: string, pdfInput: unknown) {
  const directory = localClientDocumentDirectory(documentsPath, companyName, 'Credit Notes');
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

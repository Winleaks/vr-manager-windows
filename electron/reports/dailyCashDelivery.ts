import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireIsoDate } from '../database/businessValidation.ts';
import { resolvePdfPath, toValidatedPdfBuffer } from '../security/fileValidation.ts';

function safeUnlink(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

export function dailyCashReportFilename(dateInput: unknown) {
  const date = requireIsoDate(dateInput, 'Data raportului');
  return `Raport_Daily_Cash_${date}.pdf`;
}

export function saveDailyCashReportPdf(documentsPath: string, dateInput: unknown, pdfInput: unknown) {
  const directory = path.join(documentsPath, 'VR - Hub Management', 'Daily Cash Reports');
  fs.mkdirSync(directory, { recursive: true });
  const destination = resolvePdfPath(directory, dailyCashReportFilename(dateInput));
  const staged = path.join(directory, `.${path.basename(destination)}.${randomUUID()}.tmp`);
  const previous = path.join(directory, `.${path.basename(destination)}.${randomUUID()}.previous`);
  const pdf = toValidatedPdfBuffer(pdfInput);
  let previousMoved = false;
  let removePrevious = false;

  try {
    fs.writeFileSync(staged, pdf, { flag: 'wx' });
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, previous);
      previousMoved = true;
    }
    fs.renameSync(staged, destination);
    removePrevious = previousMoved;
    return destination;
  } catch (error) {
    safeUnlink(staged);
    if (!fs.existsSync(destination) && previousMoved && fs.existsSync(previous)) {
      fs.renameSync(previous, destination);
      removePrevious = true;
    }
    throw error;
  } finally {
    safeUnlink(staged);
    if (removePrevious) safeUnlink(previous);
  }
}

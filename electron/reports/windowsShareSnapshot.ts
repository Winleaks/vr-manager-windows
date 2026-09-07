import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_PDF_BYTES, toValidatedPdfBuffer, validatePdfFilename } from '../security/fileValidation.ts';

const sessionPattern = /^vr-hub-share-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Only our direct session directories and ordinary PDF children, never recursive
// deletion or following links. Failed cleanup is retried on the next startup.
function removeSession(directory: string) {
  try {
    if (!sessionPattern.test(path.basename(directory)) || !fs.lstatSync(directory).isDirectory()) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.pdf') fs.unlinkSync(path.join(directory, entry.name));
    }
    fs.rmdirSync(directory);
  } catch { /* A receiving app may temporarily hold the file open. */ }
}

export function cleanupStaleWindowsShareSnapshots(root = os.tmpdir()) {
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && sessionPattern.test(entry.name)) removeSession(path.join(root, entry.name));
    }
  } catch { /* Startup must remain available if the temp directory is unavailable. */ }
}

export function createWindowsShareSnapshot(sourcePath: string, root = os.tmpdir()) {
  const filename = validatePdfFilename(path.basename(sourcePath));
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile() || stat.size > MAX_PDF_BYTES) throw new Error('PDF-ul este invalid sau prea mare.');
  const bytes = toValidatedPdfBuffer(fs.readFileSync(sourcePath));
  const directory = path.join(root, `vr-hub-share-${randomUUID()}`);
  fs.mkdirSync(directory, { mode: 0o700 });
  const filePath = path.join(directory, filename);
  const cleanup = () => removeSession(directory);
  try {
    fs.writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 });
    if (!fs.readFileSync(filePath).equals(bytes)) throw new Error('Copia PDF-ului nu a putut fi verificată.');
    return { filePath, cleanup };
  } catch (error) { cleanup(); throw error; }
}

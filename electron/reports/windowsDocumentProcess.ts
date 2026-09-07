import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { toValidatedPdfBuffer } from '../security/fileValidation.ts';

export type NativeDocumentResult = { success: boolean; canceled?: boolean; error?: string };
export type NativeDocumentOperation = 'share' | 'print';
const activeChildren = new Set<ChildProcess>();

export function stopWindowsDocumentProcesses() {
  for (const child of activeChildren) child.kill();
  activeChildren.clear();
}

export function buildWindowsDocumentCommand(helperPath: string, operation: NativeDocumentOperation, filePath: string) {
  if (!path.win32.isAbsolute(helperPath) || path.win32.basename(helperPath) !== 'VRHub.WindowsDocuments.exe') throw new Error('Componenta Windows este invalidă.');
  if (!['share', 'print'].includes(operation) || !path.win32.isAbsolute(filePath) || filePath.startsWith('\\\\') || path.win32.extname(filePath).toLowerCase() !== '.pdf' || filePath.includes('\0')) throw new Error('Calea PDF-ului este invalidă.');
  return { command: helperPath, args: [operation, filePath] };
}

export function parseWindowsDocumentEvent(line: string): { status: string; message?: string } {
  const event = JSON.parse(line);
  if (event?.protocol !== 1 || !['opened', 'attached', 'printed', 'canceled', 'error'].includes(event.status)) throw new Error('Răspuns invalid de la componenta Windows.');
  return { status: event.status, message: typeof event.message === 'string' ? event.message.slice(0, 300) : undefined };
}

export async function runWindowsDocumentProcess(helperPath: string, operation: NativeDocumentOperation, filePath: string): Promise<NativeDocumentResult> {
  const { command, args } = buildWindowsDocumentCommand(helperPath, operation, filePath);
  if (!fs.existsSync(helperPath)) throw new Error('Componenta pentru trimitere și printare lipsește. Reinstalează versiunea actualizată a hubului.');
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error('PDF-ul este invalid sau prea mare.');
  toValidatedPdfBuffer(fs.readFileSync(filePath));
  if (activeChildren.size >= 3) throw new Error('Închide dialogul de trimitere sau printare deja deschis.');
  const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
  return monitorWindowsDocumentProcess(child, operation);
}

export function monitorWindowsDocumentProcess(child: ChildProcess, operation: NativeDocumentOperation, startupTimeoutMs = 30_000): Promise<NativeDocumentResult> {
  return new Promise((resolve) => {
    activeChildren.add(child);
    let buffer = '';
    let settled = false;
    let opened = false;
    let attached = false;
    const finish = (result: NativeDocumentResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(startup);
      resolve(result);
    };
    const startup = setTimeout(() => {
      child.kill();
      finish({ success: false, error: 'Componenta Windows nu a răspuns. Verifică dacă aplicația este blocată de antivirus.' });
    }, startupTimeoutMs);
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 8192) { child.kill(); finish({ success: false, error: 'Răspuns Windows invalid.' }); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const event = parseWindowsDocumentEvent(line);
          if (event.status === 'opened') { opened = true; clearTimeout(startup); }
          if (event.status === 'attached') attached = true;
          if (opened && attached && operation === 'share') finish({ success: true });
          if (event.status === 'printed' && operation === 'print') finish({ success: true });
          if (event.status === 'canceled') finish({ success: false, canceled: true });
          if (event.status === 'error') finish({ success: false, error: event.message || 'Operația Windows a eșuat.' });
        } catch { child.kill(); finish({ success: false, error: 'Răspuns Windows invalid.' }); }
      }
    });
    child.once('error', () => finish({ success: false, error: 'Componenta Windows nu a putut fi pornită. Verifică instalarea hubului.' }));
    child.once('close', () => {
      activeChildren.delete(child);
      clearTimeout(startup);
      if (!settled) finish({ success: false, error: 'Componenta Windows s-a închis fără confirmarea operației.' });
    });
  });
}

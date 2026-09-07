import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { toValidatedPdfBuffer } from '../security/fileValidation.ts';

export type NativeDocumentResult = { success: boolean; canceled?: boolean; error?: string };
export type NativeDocumentOperation = 'share' | 'print';
const activeChildren = new Map<ChildProcess, string | undefined>();

export function stopWindowsDocumentProcesses() {
  for (const child of activeChildren.keys()) child.kill();
  activeChildren.clear();
}

export function stopWindowsDocumentProcessesForFile(filePath: string) {
  for (const [child, sourcePath] of activeChildren) {
    if (sourcePath !== filePath) continue;
    child.kill();
    activeChildren.delete(child);
  }
}

export function buildWindowsDocumentCommand(helperPath: string, operation: NativeDocumentOperation, filePath: string) {
  if (!path.win32.isAbsolute(helperPath) || path.win32.basename(helperPath) !== 'VRHub.WindowsDocuments.exe') throw new Error('Componenta Windows este invalidă.');
  if (!['share', 'print'].includes(operation) || !path.win32.isAbsolute(filePath) || filePath.startsWith('\\\\') || path.win32.extname(filePath).toLowerCase() !== '.pdf' || filePath.includes('\0')) throw new Error('Calea PDF-ului este invalidă.');
  return { command: helperPath, args: [operation, filePath] };
}

export function parseWindowsDocumentEvent(line: string): { status: string; message?: string } {
  const event = JSON.parse(line);
  if (event?.protocol !== 1 || !['opened', 'selecting', 'printing', 'attached', 'printed', 'canceled', 'error'].includes(event.status)) throw new Error('Răspuns invalid de la componenta Windows.');
  return { status: event.status, message: typeof event.message === 'string' ? event.message.slice(0, 300) : undefined };
}

export async function runWindowsDocumentProcess(helperPath: string, operation: NativeDocumentOperation, filePath: string): Promise<NativeDocumentResult> {
  const { command, args } = buildWindowsDocumentCommand(helperPath, operation, filePath);
  if (!fs.existsSync(helperPath)) throw new Error('Componenta pentru trimitere și printare lipsește. Reinstalează versiunea actualizată a hubului.');
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error('PDF-ul este invalid sau prea mare.');
  toValidatedPdfBuffer(fs.readFileSync(filePath));
  if (activeChildren.size >= 3) throw new Error('Închide dialogul de trimitere sau printare deja deschis.');
  // This is a WinExe (no console), not a background command. windowsHide also
  // hides GUI startup windows and can leave the print dialog inaccessible.
  const child = spawn(command, args, { windowsHide: false, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
  return monitorWindowsDocumentProcess(child, operation, 30_000, { sourcePath: filePath });
}

export function monitorWindowsDocumentProcess(child: ChildProcess, operation: NativeDocumentOperation, startupTimeoutMs = 30_000, timeouts: { dialogMs?: number; printingMs?: number; sourcePath?: string } = {}): Promise<NativeDocumentResult> {
  return new Promise((resolve) => {
    activeChildren.set(child, timeouts.sourcePath);
    let buffer = '';
    let settled = false;
    let opened = false;
    let attached = false;
    let selecting = false;
    let printing = false;
    let timer: ReturnType<typeof setTimeout>;
    const submissionWarning = 'Verifică documentele și coada imprimantei înainte să reimprimi: unele pagini pot fi deja trimise.';
    const finish = (result: NativeDocumentResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(printing && !result.success && !result.canceled
        ? { ...result, error: `${result.error || 'Printarea nu a fost confirmată.'} ${submissionWarning}` }
        : result);
    };
    const deadline = (milliseconds: number, error: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Settle first: kill may synchronously emit close (including in tests).
        finish({ success: false, error });
        child.kill();
      }, milliseconds);
    };
    deadline(startupTimeoutMs, 'Fereastra Windows nu a răspuns în 30 de secunde. Verifică instalarea hubului și imprimanta implicită.');
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      if (buffer.length > 8192) { finish({ success: false, error: 'Răspuns Windows invalid.' }); child.kill(); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const event = parseWindowsDocumentEvent(line);
          if (event.status === 'opened') opened = true;
          // Do not remove the watchdog merely because a dialog is about to open.
          // Also handle "opened" from an older bundled print helper safely.
          if (operation === 'print' && !selecting && !printing && ['selecting', 'opened'].includes(event.status)) {
            selecting = true;
            deadline(timeouts.dialogMs ?? 120_000, 'Selectarea imprimantei nu s-a finalizat în 2 minute. Verifică fereastra Windows și coada imprimantei înainte să reîncerci.');
          }
          if (operation === 'print' && event.status === 'printing' && !printing) {
            printing = true;
            deadline(timeouts.printingMs ?? 120_000, 'Windows nu a confirmat finalizarea trimiterii la imprimantă.');
          }
          if (event.status === 'attached') attached = true;
          if (opened && attached && operation === 'share') finish({ success: true });
          if (event.status === 'printed' && operation === 'print') finish({ success: true });
          if (event.status === 'canceled') finish({ success: false, canceled: true });
          if (event.status === 'error') finish({ success: false, error: event.message || 'Operația Windows a eșuat.' });
        } catch { finish({ success: false, error: 'Răspuns Windows invalid.' }); child.kill(); }
        if (settled) break;
      }
    });
    child.once('error', () => finish({ success: false, error: 'Componenta Windows nu a putut fi pornită. Verifică instalarea hubului.' }));
    child.once('close', () => {
      activeChildren.delete(child);
      clearTimeout(timer);
      if (!settled) finish({ success: false, error: 'Componenta Windows s-a închis fără confirmarea operației.' });
    });
  });
}

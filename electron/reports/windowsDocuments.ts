import { app, powerMonitor } from 'electron';
import path from 'node:path';
import { runWindowsDocumentProcess, stopWindowsDocumentProcesses, type NativeDocumentOperation } from './windowsDocumentProcess';

let cleanupRegistered = false;

export async function openWindowsDocument(operation: NativeDocumentOperation, filePath: string) {
  if (process.platform !== 'win32') return { success: false, unsupported: true, error: 'Acțiunea este disponibilă numai în aplicația Windows.' };
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    app.once('before-quit', stopWindowsDocumentProcesses);
    powerMonitor.on('lock-screen', stopWindowsDocumentProcesses);
  }
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'windows-documents', 'VRHub.WindowsDocuments.exe')
    : path.join(app.getAppPath(), 'native', 'windows-documents', 'publish', 'VRHub.WindowsDocuments.exe');
  return runWindowsDocumentProcess(helperPath, operation, filePath);
}

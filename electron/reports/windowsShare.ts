import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const WINDOWS_SHARE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$reportPath = [System.IO.Path]::GetFullPath($args[0])
if (-not [System.IO.File]::Exists($reportPath)) { throw 'Raportul PDF nu există.' }
if ([System.IO.Path]::GetExtension($reportPath) -ne '.pdf') { throw 'Este permis numai un fișier PDF.' }
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace([System.IO.Path]::GetDirectoryName($reportPath))
if ($null -eq $folder) { throw 'Folderul raportului nu poate fi deschis.' }
$item = $folder.ParseName([System.IO.Path]::GetFileName($reportPath))
if ($null -eq $item) { throw 'Raportul nu poate fi selectat.' }
$item.InvokeVerb('share')
`;

export function buildWindowsShareCommand(filePath: string) {
  const isAbsolute = path.isAbsolute(filePath) || path.win32.isAbsolute(filePath);
  if (!isAbsolute || path.extname(filePath).toLowerCase() !== '.pdf') {
    throw new Error('Calea raportului WhatsApp este invalidă.');
  }
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SHARE_SCRIPT, filePath],
  };
}

export async function openWindowsShareSheet(filePath: string) {
  if (process.platform !== 'win32') return false;
  if (!fs.existsSync(filePath)) throw new Error('Raportul PDF nu există.');
  const { command, args } = buildWindowsShareCommand(filePath);

  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(false);
    }, 8_000);
    child.once('error', () => finish(false));
    child.once('exit', (code) => finish(code === 0));
  });
}

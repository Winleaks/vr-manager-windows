import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildWindowsDocumentCommand, monitorWindowsDocumentProcess, parseWindowsDocumentEvent, stopWindowsDocumentProcesses } from '../reports/windowsDocumentProcess.ts';

const helper = 'C:\\Program Files\\VR Hub\\VRHub.WindowsDocuments.exe';
const filename = 'C:\\Users\\Operator\\Documents\\Factură & apostrof\' test.pdf';

function childFixture() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), killed: false, kill() { this.killed = true; this.emit('close', null); return true; } });
  return {
    child: child as unknown as ChildProcess,
    emit: (status: string) => child.stdout.write(JSON.stringify({ protocol: 1, status }) + '\n'),
    close: () => child.emit('close', 0),
  };
}

test('native actions pass the PDF as a literal argument without PowerShell or shell verbs', () => {
  for (const operation of ['share', 'print'] as const) {
    assert.deepEqual(buildWindowsDocumentCommand(helper, operation, filename), { command: helper, args: [operation, filename] });
  }
  assert.throws(() => buildWindowsDocumentCommand(helper, 'share', 'invoice.pdf'), /invalidă/);
  assert.throws(() => buildWindowsDocumentCommand(helper, 'share', 'C:\\Temp\\file.exe'), /invalidă/);
  assert.throws(() => buildWindowsDocumentCommand(helper, 'share', '\\\\server\\file.pdf'), /invalidă/);
  assert.throws(() => buildWindowsDocumentCommand(helper, 'delete' as any, filename), /invalidă/);
  assert.throws(() => buildWindowsDocumentCommand('powershell.exe', 'share', filename), /invalidă/);
});

test('share requires both a native window and an attached PDF, not a zero exit code', async () => {
  const fixture = childFixture();
  const result = monitorWindowsDocumentProcess(fixture.child, 'share');
  fixture.emit('opened');
  fixture.close();
  assert.equal((await result).success, false);
  const attached = childFixture();
  const confirmed = monitorWindowsDocumentProcess(attached.child, 'share');
  attached.emit('attached');
  attached.emit('opened');
  assert.deepEqual(await confirmed, { success: true });
  assert.equal(attached.child.killed, false, 'keep source process alive for deferred attachment requests');
  attached.close();
});

test('print cancellation is distinct from failure and success requires spooler confirmation', async () => {
  for (const status of ['canceled', 'printed', 'error']) {
    const fixture = childFixture();
    const result = monitorWindowsDocumentProcess(fixture.child, 'print');
    fixture.emit('opened');
    fixture.emit(status);
    const response = await result;
    assert.equal(response.success, status === 'printed');
    assert.equal(Boolean(response.canceled), status === 'canceled');
    fixture.close();
  }
});

test('native protocol accepts split lines and rejects unknown or oversized responses', async () => {
  const fixture = childFixture();
  const result = monitorWindowsDocumentProcess(fixture.child, 'print');
  fixture.child.stdout!.emit('data', '{"protocol":1,"sta');
  fixture.child.stdout!.emit('data', 'tus":"printed"}\n');
  assert.equal((await result).success, true);
  fixture.close();
  assert.throws(() => parseWindowsDocumentEvent('{"protocol":2,"status":"printed"}'));
  assert.throws(() => parseWindowsDocumentEvent('{"protocol":1,"status":"anything"}'));
  const invalid = childFixture();
  const rejected = monitorWindowsDocumentProcess(invalid.child, 'print');
  invalid.child.stdout!.emit('data', 'x'.repeat(9000));
  assert.equal((await rejected).success, false);
  assert.equal(invalid.child.killed, true);
});

test('startup timeout and process errors cannot claim success; lock/quit cleanup kills sources', async () => {
  const timed = childFixture();
  assert.match((await monitorWindowsDocumentProcess(timed.child, 'share', 5)).error!, /nu a răspuns/);
  assert.equal(timed.child.killed, true);
  const failed = childFixture();
  const failure = monitorWindowsDocumentProcess(failed.child, 'print');
  failed.child.emit('error', new Error('unavailable'));
  assert.equal((await failure).success, false);
  failed.close();
  const shared = childFixture();
  const result = monitorWindowsDocumentProcess(shared.child, 'share');
  shared.emit('opened');
  shared.emit('attached');
  await result;
  stopWindowsDocumentProcesses();
  assert.equal(shared.child.killed, true);
});

test('opened without an attachment does not disable the share watchdog', async () => {
  const fixture = childFixture();
  const pending = monitorWindowsDocumentProcess(fixture.child, 'share', 5);
  fixture.emit('opened');
  assert.equal((await pending).success, false);
  assert.equal(fixture.child.killed, true);
});

test('stalled print selection cannot leave the invoice loading indefinitely', async () => {
  for (const status of ['selecting', 'opened']) {
    const fixture = childFixture();
    const pending = monitorWindowsDocumentProcess(fixture.child, 'print', 1000, { dialogMs: 5 });
    fixture.emit(status);
    fixture.emit(status);
    const result = await pending;
    assert.equal(result.success, false);
    assert.match(result.error!, /Selectarea imprimantei/);
    assert.equal(fixture.child.killed, true);
    fixture.emit('printing');
    fixture.emit('printed');
    assert.equal((await pending).success, false, 'late output cannot turn a timeout into success');
  }
});

test('stalled submission warns about possible printed pages instead of promising a safe retry', async () => {
  const fixture = childFixture();
  const pending = monitorWindowsDocumentProcess(fixture.child, 'print', 1000, { dialogMs: 5, printingMs: 15 });
  fixture.emit('selecting');
  fixture.emit('printing');
  fixture.emit('opened');
  const result = await pending;
  assert.equal(result.success, false);
  assert.match(result.error!, /coada imprimantei/);
  assert.match(result.error!, /pagini pot fi deja trimise/);
  assert.equal(fixture.child.killed, true);
});

test('successful or canceled print clears the selection/submission watchdogs', async () => {
  for (const status of ['printed', 'canceled']) {
    const fixture = childFixture();
    const pending = monitorWindowsDocumentProcess(fixture.child, 'print', 5, { dialogMs: 5, printingMs: 5 });
    fixture.emit('selecting');
    if (status === 'printed') fixture.emit('printing');
    fixture.emit(status);
    assert.deepEqual(await pending, status === 'printed' ? { success: true } : { success: false, canceled: true });
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(fixture.child.killed, false);
    fixture.close();
  }
});

test('a helper crash or error after submission also warns against duplicate printing', async () => {
  for (const status of ['close', 'error']) {
    const fixture = childFixture();
    const pending = monitorWindowsDocumentProcess(fixture.child, 'print');
    fixture.emit('printing');
    if (status === 'close') fixture.close();
    else fixture.emit('error');
    assert.match((await pending).error!, /pagini pot fi deja trimise/);
    fixture.close();
  }
});

test('GUI launch and Windows smoke test must not hide the native window', () => {
  const bridge = readFileSync(new URL('../reports/windowsDocumentProcess.ts', import.meta.url), 'utf8');
  const smoke = readFileSync(new URL('../../scripts/testWindowsDocuments.mjs', import.meta.url), 'utf8');
  const native = readFileSync(new URL('../../native/windows-documents/Program.cs', import.meta.url), 'utf8');
  assert.match(bridge, /spawn\(command, args, \{ windowsHide: false/);
  assert.match(smoke, /windowsHide: false/);
  assert.match(smoke, /event.windowVisible === true/);
  assert.match(native, /windowVisible: IsWindowVisible\(Handle\)/);
  assert.match(native, /Activate\(\);[\s\S]*Program.Reply\("selecting"\);[\s\S]*dialog.ShowDialog\(this\)/);
  assert.match(native, /Program.Reply\("printing"\);\s*document.Print\(\);/);
});

test('native implementation uses WinRT file sharing and native print without PDF preview', () => {
  const native = readFileSync(new URL('../../native/windows-documents/Program.cs', import.meta.url), 'utf8');
  const system = readFileSync(new URL('../ipc/systemHandlers.ts', import.meta.url), 'utf8');
  assert.match(native, /DataTransferManagerInterop.GetForWindow/);
  assert.match(native, /SetStorageItems/);
  assert.match(native, /new PrintDialog/);
  assert.match(native, /dialog.ShowDialog\(this\) != DialogResult.OK/);
  assert.match(native, /RenderToStreamAsync/);
  assert.doesNotMatch(system, /webContents.print|pathToFileURL/);
});

test('Windows packaging guard requires the bundled self-contained runtime, not only the exe', async () => {
  const require = createRequire(import.meta.url);
  const verify = require('../../scripts/verifyWindowsDocuments.cjs');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'vr-native-package-test-'));
  const context = { electronPlatformName: 'win32', packager: { info: { appDir: directory } } };
  try {
    await assert.rejects(verify(context), /component missing/);
    const publish = path.join(directory, 'native', 'windows-documents', 'publish');
    mkdirSync(publish, { recursive: true });
    writeFileSync(path.join(publish, 'VRHub.WindowsDocuments.exe'), 'fixture');
    await assert.rejects(verify(context), /component missing/);
    for (const name of ['VRHub.WindowsDocuments.dll', 'VRHub.WindowsDocuments.runtimeconfig.json', 'coreclr.dll', 'Microsoft.Windows.SDK.NET.dll']) writeFileSync(path.join(publish, name), 'fixture');
    await verify(context);
    await verify({ electronPlatformName: 'darwin' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

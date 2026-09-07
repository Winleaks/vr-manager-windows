import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildWindowsDocumentCommand, monitorWindowsDocumentProcess, parseWindowsDocumentEvent, stopWindowsDocumentProcesses, stopWindowsDocumentProcessesForFile } from '../reports/windowsDocumentProcess.ts';
import { createWindowsShareSnapshot, cleanupStaleWindowsShareSnapshots } from '../reports/windowsShareSnapshot.ts';

const helper = 'C:\\Program Files\\VR Hub\\VRHub.WindowsDocuments.exe';
const filename = 'C:\\Users\\Operator\\Documents\\Factură & apostrof\' test.pdf';

test('share snapshots preserve exact PDF bytes/name independently of later invoice edits', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vr-share-test-'));
  try {
    const source = path.join(root, 'Factură 123 & client.pdf');
    const bytes = Buffer.from('%PDF-1.7\nsynthetic invoice 123');
    writeFileSync(source, bytes);
    const first = createWindowsShareSnapshot(source, root);
    const second = createWindowsShareSnapshot(source, root);
    assert.equal(path.basename(first.filePath), path.basename(source));
    assert.notEqual(first.filePath, second.filePath);
    assert.deepEqual(readFileSync(first.filePath), bytes);
    writeFileSync(source, '%PDF-1.7\nupdated invoice');
    assert.deepEqual(readFileSync(first.filePath), bytes);
    writeFileSync(first.filePath, '%PDF-1.7\nrecipient edit');
    assert.equal(readFileSync(source, 'utf8'), '%PDF-1.7\nupdated invoice');
    first.cleanup(); first.cleanup(); second.cleanup();
    assert.deepEqual(readdirSync(root), [path.basename(source)]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('sharing rejects server error text and invalid file types before creating a session', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vr-share-test-'));
  try {
    for (const name of ['0.txt', 'invoice.pdf']) {
      const source = path.join(root, name);
      writeFileSync(source, 'Internal Server Error');
      assert.throws(() => createWindowsShareSnapshot(source, root), /PDF/);
    }
    assert.deepEqual(readdirSync(root).sort(), ['0.txt', 'invoice.pdf']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('startup cleanup removes only owned share sessions and never traverses symlinks', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vr-share-test-'));
  try {
    const source = path.join(root, 'invoice.pdf');
    writeFileSync(source, '%PDF-1.7\nfixture');
    const snapshot = createWindowsShareSnapshot(source, root);
    const unrelated = path.join(root, 'vr-hub-share-unrelated');
    mkdirSync(unrelated);
    writeFileSync(path.join(unrelated, 'keep.pdf'), '%PDF-1.7\nkeep');
    if (process.platform !== 'win32') symlinkSync(unrelated, path.join(root, 'vr-hub-share-12345678-1234-4234-8234-123456789012'));
    cleanupStaleWindowsShareSnapshots(root);
    assert.equal(existsSync(snapshot.filePath), false);
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(path.join(unrelated, 'keep.pdf')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prepared shares retain their snapshot until close, lock, or a bounded retention deadline', async () => {
  for (const ending of ['close', 'lock', 'timeout']) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'vr-share-test-'));
    try {
      const source = path.join(root, 'invoice.pdf');
      writeFileSync(source, '%PDF-1.7\nfixture');
      const snapshot = createWindowsShareSnapshot(source, root);
      const fixture = childFixture();
      const ready = monitorWindowsDocumentProcess(fixture.child, 'share', 1000, { sourcePath: source, cleanup: snapshot.cleanup, shareMs: ending === 'timeout' ? 10 : 1000 });
      fixture.emit('attached'); fixture.emit('opened');
      assert.equal((await ready).success, true);
      assert.equal(existsSync(snapshot.filePath), true);
      if (ending === 'close') fixture.close();
      if (ending === 'lock') stopWindowsDocumentProcessesForFile(source);
      if (ending === 'timeout') await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(existsSync(snapshot.filePath), false);
      assert.equal(existsSync(source), true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('native sharing uses a physical disposable PDF with metadata and retains it after handoff', () => {
  const native = readFileSync(new URL('../../native/windows-documents/Program.cs', import.meta.url), 'utf8');
  const bridge = readFileSync(new URL('../reports/windowsDocumentProcess.ts', import.meta.url), 'utf8');
  assert.match(bridge, /operation === 'share' \? createWindowsShareSnapshot\(filePath\)/);
  assert.match(native, /SetStorageItems\(new IStorageItem\[\] \{ file \}, false\)/);
  assert.match(native, /FileTypes.Add\(".pdf"\)/);
  const handler = native.slice(native.indexOf('sharePackage.ShareCompleted +='), native.indexOf('Program.Reply("attached")'));
  assert.ok(handler.includes('completed = true'));
  assert.doesNotMatch(handler, /Close\(\)/);
});

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

test('locking a protected document stops its source without closing another invoice or printer', async () => {
  const protectedFile = 'C:\\Temp\\private-fixture.pdf';
  const protectedSource = childFixture();
  const normalSource = childFixture();
  const protectedReady = monitorWindowsDocumentProcess(protectedSource.child, 'share', 1000, { sourcePath: protectedFile });
  const normalReady = monitorWindowsDocumentProcess(normalSource.child, 'share', 1000, { sourcePath: filename });
  for (const source of [protectedSource, normalSource]) { source.emit('opened'); source.emit('attached'); }
  await Promise.all([protectedReady, normalReady]);
  stopWindowsDocumentProcessesForFile(protectedFile);
  assert.equal(protectedSource.child.killed, true);
  assert.equal(normalSource.child.killed, false);
  normalSource.close();
});

test('locking during attachment preparation cannot report a prepared document', async () => {
  const fixture = childFixture();
  const pending = monitorWindowsDocumentProcess(fixture.child, 'share', 1000, { sourcePath: filename });
  fixture.emit('opened');
  stopWindowsDocumentProcessesForFile(filename);
  assert.equal((await pending).success, false);
  assert.equal(fixture.child.killed, true);
});

test('protected invoices use the validated persistent native share host, not the legacy shell verb', () => {
  const service = readFileSync(new URL('../protectedRegistry/service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(service, /openWindowsShareSheet|reports\/windowsShare/);
  assert.match(service, /await openWindowsDocument\('share', filePath\)/);
  assert.match(service, /if \(result.canceled\) return result/);
  assert.match(service, /stopWindowsDocumentProcessesForFile\(filePath\);\s*try \{ if \(fs.existsSync\(filePath\)\) fs.unlinkSync\(filePath\)/);
  assert.match(service, /sessions.get\(webContentsId\) !== session/);
  assert.match(service, /writeFileSync\(tempPath, toValidatedPdfBuffer\(file.buffer\)/);
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

test('preview keeps a bounded watchdog and never claims that printing occurred', async () => {
  const fixture = childFixture();
  const pending = monitorWindowsDocumentProcess(fixture.child, 'print', 1000, { previewMs: 5 });
  fixture.emit('previewing');
  fixture.emit('previewing');
  const result = await pending;
  assert.equal(result.success, false);
  assert.match(result.error!, /Previzualizarea/);
  assert.match(result.error!, /Nu s-a trimis nimic/);
  assert.equal(fixture.child.killed, true);
});

test('preview cancellation is not an error and selecting a printer replaces the preview deadline', async () => {
  const canceled = childFixture();
  const cancellation = monitorWindowsDocumentProcess(canceled.child, 'print', 1000, { previewMs: 5 });
  canceled.emit('previewing');
  canceled.emit('canceled');
  assert.deepEqual(await cancellation, { success: false, canceled: true });
  canceled.close();
  const fixture = childFixture();
  const pending = monitorWindowsDocumentProcess(fixture.child, 'print', 1000, { previewMs: 5, dialogMs: 30 });
  fixture.emit('previewing');
  fixture.emit('selecting');
  fixture.emit('previewing');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fixture.child.killed, false);
  fixture.emit('printing');
  fixture.emit('printed');
  assert.deepEqual(await pending, { success: true });
  fixture.close();
});

test('native print starts with an actual PDF preview and printing remains an explicit action', () => {
  const native = readFileSync(new URL('../../native/windows-documents/Program.cs', import.meta.url), 'utf8');
  assert.match(native, /else await ShowPrintPreviewAsync\(pdf\)/);
  assert.match(native, /SizeMode = PictureBoxSizeMode.Zoom/);
  assert.match(native, /var bitmap = await RenderPageAsync\(pdf, index\)/);
  assert.match(native, /old\?\.Dispose\(\)/);
  assert.match(native, /print.Click \+=[\s\S]*await PrintAsync\(pdf\)/);
  assert.match(native, /cancel.Focus\(\)/);
  assert.match(native, /ShowPageAsync\(pdf.PageCount - 1\)/);
  assert.match(native, /Program.Reply\("preview-validated"/);
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

test('native implementation uses WinRT file sharing and native print without Chromium PDF plugins', () => {
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

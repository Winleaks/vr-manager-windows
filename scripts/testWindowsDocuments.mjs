import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { jsPDF } from 'jspdf';

if (process.platform !== 'win32') throw new Error('This smoke test requires Windows.');
const helper = path.resolve('native/windows-documents/publish/VRHub.WindowsDocuments.exe');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-native-documents-'));
const invoke = (file) => new Promise((resolve, reject) => {
  const child = spawn(helper, ['validate', file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let output = '';
  const timeout = setTimeout(() => { child.kill(); reject(new Error('Native validation timed out.')); }, 30_000);
  child.stdout.on('data', data => output += data);
  child.once('error', error => { clearTimeout(timeout); reject(error); });
  child.once('close', code => {
    clearTimeout(timeout);
    try { resolve({ code, events: output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }); }
    catch (error) { reject(error); }
  });
});
try {
  const filename = path.join(directory, 'Factură & spații.pdf');
  const pdf = new jsPDF();
  pdf.text('Native document smoke test: invoice 123', 20, 20);
  pdf.addPage();
  pdf.text('Second page', 20, 20);
  fs.writeFileSync(filename, Buffer.from(pdf.output('arraybuffer')));
  const valid = await invoke(filename);
  assert.equal(valid.code, 0);
  assert.ok(valid.events.some(event => event.status === 'validated' && event.pages === 2));
  fs.writeFileSync(filename, '%PDF-invalid content');
  const invalid = await invoke(filename);
  assert.notEqual(invalid.code, 0);
  assert.ok(invalid.events.some(event => event.status === 'error'));
  const missing = await invoke(path.join(directory, 'missing.pdf'));
  assert.notEqual(missing.code, 0);
  console.log('Native Windows PDF load/render and invalid-file smoke checks passed. No documents were printed or shared.');
} finally {
  // Only this test's unique directory, containing synthetic PDF data.
  fs.rmSync(directory, { recursive: true, force: true });
}

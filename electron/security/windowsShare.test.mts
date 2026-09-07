import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWindowsShareCommand } from '../reports/windowsShare.ts';

test('Windows Share passes the PDF path as a separate PowerShell argument', () => {
  const filePath = 'C:\\Users\\Operator\\Documents\\Raport Daily Cash & test.pdf';
  const command = buildWindowsShareCommand(filePath);

  assert.equal(command.command, 'powershell.exe');
  assert.equal(command.args.at(-1), filePath);
  assert.ok(command.args.includes('-NonInteractive'));
  assert.ok(!command.args.at(-2)?.includes(filePath));
});

test('Windows Share rejects relative and non-PDF paths', () => {
  assert.throws(() => buildWindowsShareCommand('Raport.pdf'), /invalidă/);
  assert.throws(() => buildWindowsShareCommand('C:\\Temp\\Raport.exe'), /invalidă/);
});

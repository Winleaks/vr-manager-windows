import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  clientDocumentFolderName,
  localClientDocumentDirectory,
  normalCloudDocumentFolders,
  protectedCloudDocumentFolders,
} from '../reports/clientDocumentStorage.ts';

test('keeps a readable client name with Romanian diacritics', () => {
  assert.equal(clientDocumentFolderName('TRADIȚII MUNTENEȘTI LTD'), 'TRADIȚII MUNTENEȘTI LTD');
});

test('sanitizes traversal and Windows-reserved client folder names', () => {
  assert.equal(clientDocumentFolderName('../Client / Nord'), 'Client Nord');
  assert.equal(clientDocumentFolderName('CON'), 'CON Client');
  assert.throws(() => clientDocumentFolderName('///'));
});

test('groups invoices and Credit Notes below the same client folder', () => {
  const root = '/documents';
  assert.equal(
    localClientDocumentDirectory(root, 'CLIENT LTD', 'Facturi'),
    path.join(root, 'VR - Hub Management', 'Clienti', 'CLIENT LTD', 'Facturi'),
  );
  assert.deepEqual(normalCloudDocumentFolders('CLIENT LTD', 'Credit Notes'), ['Facturi', 'CLIENT LTD', 'Credit Notes']);
  assert.deepEqual(protectedCloudDocumentFolders('CLIENT LTD', 'Facturi'), ['Duplicat', 'CLIENT LTD', 'Facturi']);
});

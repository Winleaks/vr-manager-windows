import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {
  MAX_PDF_BYTES,
  resolvePdfPath,
  toValidatedPdfBuffer,
  validateCloudFileId,
  validatePdfFilename,
} from './fileValidation.ts'

test('accepts a normal invoice PDF filename', () => {
  assert.equal(validatePdfFilename('Factura_FACT_102.pdf'), 'Factura_FACT_102.pdf')
})

test('rejects traversal, Windows separators, reserved names, and wrong extensions', () => {
  for (const filename of ['../factura.pdf', '..\\factura.pdf', 'CON.pdf', 'factura.exe']) {
    assert.throws(() => validatePdfFilename(filename))
  }
})

test('keeps the resolved PDF inside the invoice directory', () => {
  const directory = path.resolve('/tmp/facturi')
  assert.equal(resolvePdfPath(directory, 'Factura_1.pdf'), path.join(directory, 'Factura_1.pdf'))
})

test('accepts a bounded PDF payload and rejects other or oversized payloads', () => {
  const validPdf = new Uint8Array(Buffer.from('%PDF-1.7\ncontent'))
  assert.equal(toValidatedPdfBuffer(validPdf).subarray(0, 5).toString('ascii'), '%PDF-')
  assert.throws(() => toValidatedPdfBuffer(new Uint8Array(Buffer.from('not a pdf'))))
  assert.throws(() => toValidatedPdfBuffer(new Uint8Array(MAX_PDF_BYTES + 1)))
})

test('accepts only plausible Google Drive file identifiers', () => {
  assert.equal(validateCloudFileId('abc_DEF-1234567890'), 'abc_DEF-1234567890')
  assert.throws(() => validateCloudFileId('../../database'))
})

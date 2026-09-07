import assert from 'node:assert/strict';
import test from 'node:test';
import { saveInvoiceEdits } from '../../src/utils/saveInvoiceEdits.ts';

const input = { id: 7, invoiceDate: '2026-09-01', items: [{ id: 10, quantity: 2.5, unitPrice: 4.2 }] };
const invoice = { id: 7, invoice_number: 'TGB-7', total_amount: 10.5 };

function dependencies() {
  const calls: string[] = [];
  return {
    calls,
    update: async (data: typeof input) => { assert.deepEqual(data, input); calls.push('update'); return { invoice }; },
    onCommitted: (row: unknown) => { assert.equal(row, invoice); calls.push('committed'); },
    prepare: async (id: number) => { assert.equal(id, 7); calls.push('pdf'); return new Uint8Array([1, 2]); },
    upload: async (id: number, buffer: Uint8Array) => { assert.equal(id, 7); assert.deepEqual(buffer, new Uint8Array([1, 2])); calls.push('cloud'); return { success: true }; },
  };
}

test('invoice editor confirms authoritative local save before PDF and cloud', async () => {
  const deps = dependencies();
  const saved = await saveInvoiceEdits(input, deps);
  assert.deepEqual(deps.calls, ['update', 'committed', 'pdf', 'cloud']);
  assert.equal(saved.invoice, invoice);
  assert.equal(saved.warning, false);
});

test('database rejection keeps the editor open without generating or uploading a PDF', async () => {
  const deps = dependencies();
  deps.update = async () => { throw new Error('Total mai mic decât suma achitată'); };
  await assert.rejects(saveInvoiceEdits(input, deps), /suma achitată/);
  assert.deepEqual(deps.calls, []);
});

test('local PDF failure reports saved invoice separately from document failure', async () => {
  const deps = dependencies();
  deps.prepare = async () => { throw new Error('disk full'); };
  const saved = await saveInvoiceEdits(input, deps);
  assert.equal(saved.warning, true);
  assert.match(saved.message, /a fost salvată.*PDF-ul trebuie regenerat.*disk full/);
  assert.deepEqual(deps.calls, ['update', 'committed']);
});

for (const mode of ['rejected', 'unsuccessful', 'timeout']) {
  test(`cloud ${mode} does not undo a saved invoice or keep saving blocked`, async () => {
    const deps = dependencies();
    deps.upload = async () => {
      deps.calls.push('cloud');
      if (mode === 'rejected') throw new Error('offline');
      if (mode === 'unsuccessful') return { success: false };
      return new Promise(() => {});
    };
    const saved = await saveInvoiceEdits(input, deps, 5);
    assert.equal(saved.warning, true);
    assert.match(saved.message, /a fost salvată.*PDF-ul este actualizat local.*Google Drive nu este confirmat/);
    assert.deepEqual(deps.calls, ['update', 'committed', 'pdf', 'cloud']);
  });
}

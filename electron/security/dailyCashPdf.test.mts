import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { DailyCashReportSnapshot } from '../database/dailyCashReport.ts';
import { dailyCashReportFilename, saveDailyCashReportPdf } from '../reports/dailyCashDelivery.ts';
import { generateDailyCashPdf } from '../reports/dailyCashPdf.ts';

function reportWithTransactions(count: number): DailyCashReportSnapshot {
  return {
    dayId: 1,
    date: '2026-08-18',
    status: 'FINAL',
    isClosed: true,
    canReopen: true,
    generatedAt: '2026-08-18T20:00:00.000Z',
    openingBalance: 100,
    totalIn: count,
    totalOut: 0,
    netCashFlow: count,
    balance: 100 + count,
    transactionCount: count,
    categoryTotals: [{ category: 'driver_collection', label: 'Încasare șofer', type: 'IN', amount: count }],
    transactions: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      time: '10:30',
      type: 'IN' as const,
      category: 'driver_collection',
      categoryLabel: 'Încasare șofer',
      reference: `Șofer ${index + 1}`,
      notes: 'Încasare rută zilnică',
      amount: 1,
    })),
  };
}

test('daily cash PDF is valid and paginates long reports', () => {
  const pdf = generateDailyCashPdf(reportWithTransactions(90));
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString('ascii'), '%PDF-');
  const source = Buffer.from(pdf).toString('latin1');
  assert.ok((source.match(/\/Type \/Page\b/g) || []).length >= 2);
});

test('daily cash PDF uses a constrained deterministic path and atomic overwrite', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-hub-daily-cash-'));
  try {
    const first = generateDailyCashPdf(reportWithTransactions(1));
    const destination = saveDailyCashReportPdf(temporaryRoot, '2026-08-18', first);
    assert.equal(path.basename(destination), 'Raport_Daily_Cash_2026-08-18.pdf');
    assert.equal(fs.readFileSync(destination).subarray(0, 5).toString('ascii'), '%PDF-');

    const second = generateDailyCashPdf(reportWithTransactions(2));
    assert.equal(saveDailyCashReportPdf(temporaryRoot, '2026-08-18', second), destination);
    assert.equal(fs.statSync(destination).size, second.byteLength);
    assert.deepEqual(
      fs.readdirSync(path.dirname(destination)).filter((name) => name.startsWith('.')),
      [],
    );
    assert.throws(() => dailyCashReportFilename('../2026-08-18'));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

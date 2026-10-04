import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { initialSchema } from './schema.ts';
import * as visibility from './normalBillingVisibility.ts';
import * as issuers from './billingIssuers.ts';
import * as credits from './creditNotes.ts';
import * as reports from './billingReports.ts';
import * as validation from './businessValidation.ts';
import * as entities from './entitySync.ts';
import * as resolvedEntities from '../integrations/vrBakerEntities.ts';
import * as legacy from './legacyEntityRepair.ts';
import { installDocumentSyncQueue, documentSyncStatus } from './documentSyncQueue.ts';
import { installBillingPublication } from './billingPublication.ts';

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(initialSchema);
  issuers.ensureBillingIssuerSchema(db); credits.ensureCreditNoteSchema(db); entities.installEntitySyncState(db);
  installBillingPublication(db); installDocumentSyncQueue(db); visibility.installNormalBillingVisibility(db);
  db.exec(`INSERT INTO clients(id,name) VALUES(1,'Normal owner'),(2,'Hidden owner');
    INSERT INTO companies(id,client_id,name,supabase_company_id) VALUES(1,1,'Normal Company','normal'),(2,2,'Hidden Company','hidden');
    INSERT INTO stores(id,company_id,name) VALUES(1,1,'Normal Store'),(2,2,'Hidden Store');
    INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,paid_amount,status)
      VALUES(1,1,'TEST-1','2026-09-20',100,20,'partial'),(2,2,'TEST-2','2026-09-20',900,600,'partial');
    INSERT INTO invoice_identities(invoice_id,issuer_id,series,sequence_number,reference,issuer_snapshot_json)
      SELECT id,1,'TEST',id,invoice_number,'{}' FROM invoices;
    INSERT INTO invoice_items(id,invoice_id,product_name,quantity,unit_price,total_price) VALUES(1,1,'Bread',1,100,100),(2,2,'Bread',1,900,900);
    INSERT INTO payments(company_id,invoice_id,issuer_id,amount,payment_date,method)
      VALUES(1,1,1,20,'2026-09-20','cash'),(2,2,1,600,'2026-09-20','cash');
    INSERT INTO credit_notes(id,company_id,issuer_id,reference,series,sequence_number,issue_date,reason,issuer_snapshot_json,customer_snapshot_json,net_amount,total_amount)
      VALUES(1,1,1,'CN-1','CN',1,'2026-09-20','Fixture','{}','{}',10,10),(2,2,1,'CN-2','CN',2,'2026-09-20','Fixture','{}','{}',90,90);
    INSERT INTO credit_note_invoice_links(credit_note_id,invoice_id,credited_net,credited_total) VALUES(1,1,10,10),(2,2,90,90);`);
  const mocks: Record<string, unknown> = {
    '../db': { db }, '../normalBillingVisibility': visibility, '../billingReports.ts': reports,
    '../billingIssuers': issuers, '../creditNotes': credits, '../businessValidation': validation,
    '../../integrations/vrBakerEntities': resolvedEntities, '../entitySync': entities, '../legacyEntityRepair': legacy, './billingTransactions': {},
  };
  const compiled = ts.transpileModule(readFileSync(new URL('./repositories/billingRepo.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const repo: any = {};
  runInNewContext(compiled, { exports: repo, require: (name: string) => {
    if (!(name in mocks)) throw Error(`Unexpected dependency ${name}`);
    return mocks[name];
  } });
  return { db, repo };
}

test('normal read projection excludes hidden companies from nested reports, invoices, credit and direct IDs without changing history', () => {
  const { db, repo } = fixture();
  try {
    assert.throws(() => repo.getAllCompaniesAndStores(), /Vizibilitatea/);
    visibility.replaceNormalBillingVisibility(db, [2]);
    assert.deepEqual(Array.from(repo.getAllCompaniesAndStores(), (row: any) => row.id), [1]);
    assert.equal(repo.getAllCompaniesAndStoresForRouting().length, 2, 'protected assignment UI retains raw company selection');
    assert.equal(repo.getClients().length, 1);
    assert.equal(repo.getCompaniesByClientId(2).length, 0);
    assert.equal(repo.getStoresByCompanyId(2).length, 0);
    assert.equal(repo.getCompanyProfileDetails(2), null);
    assert.equal(repo.getCompanyProfileDetails(1).invoices.length, 1);
    assert.equal(repo.getInvoicesByDateRange().length, 1);
    assert.equal(repo.getInvoiceById(1).accountOutstanding.total, 70);
    assert.throws(() => repo.getInvoiceById(2), /nu există/);
    assert.throws(() => repo.getStatement(2, 1, '2026-09-01', '2026-09-30'), /nu există/);
    assert.equal(repo.getStatement(1, 1, '2026-09-01', '2026-09-30').closing, 70);
    assert.equal(repo.getPaymentReport('2026-09-01','2026-09-30').length, 1);
    assert.equal(repo.getBillingStats().totalInvoiced, 100);
    const weekly = repo.getBillingStats(1,'2026-09-14','2026-09-20');
    assert.equal(weekly.totalInvoiced, 100); assert.equal(weekly.totalPaid, 20); assert.equal(weekly.totalCredited, 10); assert.equal(weekly.totalUnpaid, 70);
    assert.equal(repo.listCreditNotes().length, 1);
    assert.equal(repo.readCreditNoteDraft().length, 1);
    assert.throws(() => repo.readCreditNote(2), /nu există/);
    assert.throws(() => repo.cancelInvoice(2,'Fixture'), /nu este disponibilă/);
    assert.throws(() => repo.recordCompanyPayment({companyId:2}), /nu este disponibilă/);
    assert.throws(() => repo.applyCompanyCredit({companyId:2,invoiceId:2}), /nu este disponibilă/);
    assert.throws(() => repo.issueCreditNote({items:[{invoiceItemId:2}]}), /nu este disponibilă/);
    assert.equal((db.prepare('SELECT SUM(total_amount) AS total FROM invoices').get() as any).total,1000);
    visibility.replaceNormalBillingVisibility(db, []);
    assert.equal(repo.getInvoicesByDateRange().length, 2, 'unassign restores visibility, not a duplicate invoice');
  } finally { db.close(); }
});

test('visibility migration/replica and failed writes retain data and fail closed when verification is pending', () => {
  const { db, repo } = fixture();
  try {
    visibility.installNormalBillingVisibility(db);
    visibility.replaceNormalBillingVisibility(db,[2,2]);
    assert.throws(() => visibility.replaceNormalBillingVisibility(db,[1,9999]), /FOREIGN KEY/);
    assert.equal(repo.getInvoicesByDateRange().length,1, 'failed replacement rolls back');
    const copy = new Database(db.serialize());
    try {
      const reader = visibility.normalBillingReadDatabase(copy);
      assert.equal((reader.prepare('SELECT COUNT(*) AS n FROM companies').get() as any).n,1);
      assert.equal(documentSyncStatus(reader).items.some(item=>item.reference==='TEST-2'||item.reference==='CN-2'),false);
      assert.throws(()=>reader.prepare('DELETE FROM invoices'),/numai citiri/);
      visibility.invalidateNormalBillingVisibility(copy);
      assert.throws(()=>reader.prepare('SELECT * FROM invoices'),/Vizibilitatea/);
    } finally { copy.close(); }
    assert.equal(repo.getInvoicesByDateRange().length,1);
  } finally { db.close(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initialSchema } from './schema.ts';
import {
  assignCompanyIssuer,
  ensureBillingIssuerSchema,
  getBillingIssuers,
  updateBillingIssuer,
} from './billingIssuers.ts';
import {
  cancelInvoiceTransaction,
  createManualInvoiceTransaction,
  createWeeklyInvoiceBatchTransaction,
  deleteInvoiceForTestingTransaction,
  recordCompanyPaymentTransaction,
  reissueCancelledWeeklyInvoiceTransaction,
  setBillingTestModeTransaction,
  updatePaymentTransaction,
  updateInvoiceTransaction,
} from './repositories/billingTransactions.ts';
import { ensureCreditNoteSchema } from './creditNotes.ts';
import { paymentReport, statementReport, outstandingReport, weeklyBillingStats } from './billingReports.ts';

function issuerInput(issuer: any, overrides: Record<string, unknown> = {}) {
  return {
    id: issuer.id,
    legalName: issuer.legal_name,
    address: '1 Bakery Road, London',
    companyNumber: issuer.code === 'goodness' ? 'GOOD123' : 'VATRA123',
    vatRegistered: issuer.code === 'goodness',
    vatNumber: issuer.code === 'goodness' ? 'GB123456789' : '',
    bankName1: 'Business Bank',
    accountNumber1: '12345678',
    sortCode1: '12-34-56',
    bankName2: '', accountNumber2: '', sortCode2: '', footer: '',
    invoiceSeries: issuer.code === 'goodness' ? 'TGB' : 'VATRA',
    nextInvoiceNumber: issuer.code === 'goodness' ? 10 : 1,
    color: issuer.code === 'goodness' ? '#4F46E5' : '#B45309',
    alternateRowColor: issuer.code === 'goodness' ? '#4F46E5' : '#B45309',
    alternateRowOpacity: 5,
    isActive: true,
    ...overrides,
  };
}

function fixture() {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON');
  connection.exec(initialSchema);
  connection.prepare("INSERT INTO app_settings (key, value) VALUES ('invoice_series', 'FACT'), ('invoice_start_number', '10'), ('issuer_name', 'THE GOODNESS BAKER LTD')").run();
  const clientId = Number(connection.prepare("INSERT INTO clients (name) VALUES ('Client')").run().lastInsertRowid);
  const company1 = Number(connection.prepare("INSERT INTO companies (client_id, name) VALUES (?, 'Client Goodness')").run(clientId).lastInsertRowid);
  const company2 = Number(connection.prepare("INSERT INTO companies (client_id, name) VALUES (?, 'Client Vatra')").run(clientId).lastInsertRowid);
  const store1 = Number(connection.prepare("INSERT INTO stores (company_id, name, supabase_store_id) VALUES (?, 'Store Goodness', 'store-goodness')").run(company1).lastInsertRowid);
  const store2 = Number(connection.prepare("INSERT INTO stores (company_id, name, supabase_store_id) VALUES (?, 'Store Vatra', 'store-vatra')").run(company2).lastInsertRowid);
  ensureBillingIssuerSchema(connection);
  ensureCreditNoteSchema(connection);
  const issuers = getBillingIssuers(connection);
  const goodness = issuers.find((issuer) => issuer.code === 'goodness')!;
  const vatra = issuers.find((issuer) => issuer.code === 'vatra')!;
  updateBillingIssuer(connection, issuerInput(goodness));
  updateBillingIssuer(connection, issuerInput(vatra));
  assignCompanyIssuer(connection, company2, vatra.id);
  return { connection, company1, company2, store1, store2, goodnessId: goodness.id, vatraId: vatra.id };
}

test('imported invoice accepts active catalogue additions and editable prices while preserving source identity', () => {
  const { connection, store1 } = fixture();
  try {
    const [invoice] = createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-addition')], '2026-08-31');
    const rows = () => connection.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invoice.invoiceId) as any[];
    const original = rows();
    const source = () => ({
      identities: connection.prepare('SELECT * FROM invoice_identities').all(),
      batches: connection.prepare('SELECT * FROM invoice_import_batches').all(),
      orders: connection.prepare('SELECT * FROM invoice_source_orders').all(),
      payments: connection.prepare('SELECT * FROM payments').all(),
    });
    const previousSource = source();
    const productId = Number(connection.prepare(`INSERT INTO cloud_products
      (name, name_ro, variant_label, unit, supabase_product_id, price_standard, display_order)
      VALUES ('Cake', 'Prăjitură', 'Chocolate', 'buc', 'cake-id', 5, 3)`).run().lastInsertRowid);
    const previousInput = original.map((row) => ({ id: row.id, productName: row.product_name, quantity: row.quantity, unitPrice: row.unit_price }));
    const addition = { productId, productName: 'untrusted name', externalProductId: 'untrusted-id', quantity: 2, unitPrice: 3.25 };
    const save = (items: any[]) => updateInvoiceTransaction(connection, invoice.invoiceId, invoice.invoiceNumber, '2026-09-01', items);
    const updated = save([...previousInput, addition]);
    assert.equal(updated.totalAmount, invoice.totalAmount + 6.5);
    assert.deepEqual(rows().slice(0, original.length), original);
    const added = rows().at(-1)!;
    assert.equal(added.product_name, 'Cake');
    assert.equal(added.product_name_ro, 'Prăjitură');
    assert.equal(added.variant_label, 'Chocolate');
    assert.equal(added.external_product_id, 'cake-id');
    assert.equal(added.unit_price, 3.25);
    assert.deepEqual(source(), previousSource);
    assert.equal((connection.prepare('SELECT price_standard FROM cloud_products WHERE id = ?').get(productId) as any).price_standard, 5);
    const savedInput = [...previousInput, { id: added.id, productName: 'Cake', quantity: 3, unitPrice: 0 }];
    save(savedInput);
    assert.equal(rows().at(-1)!.unit_price, 0, 'saved additions remain price-editable');
    const snapshot = () => ({ rows: rows(), invoice: connection.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.invoiceId), audit: connection.prepare('SELECT * FROM billing_audit_events').all() });
    const saved = snapshot();
    for (const invalid of [
      [...previousInput, addition], // replay must not duplicate an already saved addition
      [...savedInput, { ...addition, productId: 999999 }],
      [...savedInput, { ...addition, productId: undefined }],
      [...savedInput, { ...addition, id: 999999 }],
      [...savedInput, { ...addition, quantity: 0 }],
      [...savedInput, { ...addition, unitPrice: -1 }],
    ]) {
      assert.throws(() => save(invalid));
      assert.deepEqual(snapshot(), saved);
    }
    connection.prepare('UPDATE cloud_products SET available = 0 WHERE id = ?').run(productId);
    assert.throws(() => save([...savedInput, addition]), /disponibil/);
    assert.deepEqual(snapshot(), saved);
    connection.prepare('UPDATE cloud_products SET available = 1 WHERE id = ?').run(productId);
    connection.exec("CREATE TRIGGER reject_append_audit BEFORE INSERT ON billing_audit_events WHEN NEW.event_type = 'invoice_updated' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    assert.throws(() => save([...savedInput, addition]), /audit unavailable/);
    assert.deepEqual(snapshot(), saved, 'new items, header and audit roll back together');
  } finally { connection.close(); }
});

test('manual correction of imported invoice preserves identity, source links and payments, and audits atomically', () => {
  const { connection, company1, store1, goodnessId } = fixture();
  try {
    const order = weekly(store1, 'store-goodness', 'order-correction');
    order.items.push({ productName: 'Cake', name_ro: 'Prăjitură', quantity: 1, unitPrice: 4 });
    const [invoice] = createWeeklyInvoiceBatchTransaction(connection, [order], '2026-08-31');
    const rows = () => connection.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invoice.invoiceId) as any[];
    const originalItems = rows();
    const source = () => ({
      identity: connection.prepare('SELECT * FROM invoice_identities WHERE invoice_id = ?').get(invoice.invoiceId),
      batches: connection.prepare('SELECT * FROM invoice_import_batches WHERE invoice_id = ?').all(invoice.invoiceId),
      orders: connection.prepare('SELECT * FROM invoice_source_orders WHERE batch_id IN (SELECT id FROM invoice_import_batches WHERE invoice_id = ?)').all(invoice.invoiceId),
      issuer: connection.prepare('SELECT * FROM billing_issuers WHERE id = ?').get(goodnessId),
    });
    const originalSource = source();
    recordCompanyPaymentTransaction(connection, { companyId: company1, issuerId: goodnessId, invoiceId: invoice.invoiceId, amount: 3, paymentDate: '2026-08-31', method: 'cash' });
    const payments = connection.prepare('SELECT * FROM payments').all();
    const items = originalItems.map((row) => ({ id: row.id, productName: row.product_name, quantity: 2.5, unitPrice: 4.2 }));
    const save = (data = items, id = invoice.invoiceId, date = '2026-09-01') => updateInvoiceTransaction(connection, id, invoice.invoiceNumber, date, data);
    const result = save();
    assert.equal(result.totalAmount, items.length * 10.5);
    assert.equal(result.paidAmount, 3);
    assert.equal(result.status, 'partial');
    assert.deepEqual(rows(), originalItems.map((row) => ({ ...row, quantity: 2.5, unit_price: 4.2, total_price: 10.5 })));
    assert.deepEqual(source(), originalSource);
    assert.deepEqual(connection.prepare('SELECT * FROM payments').all(), payments);
    const audit = connection.prepare("SELECT * FROM billing_audit_events WHERE event_type = 'invoice_updated' AND invoice_id = ?").get(invoice.invoiceId) as any;
    assert.equal(audit.issuer_id, goodnessId);
    assert.equal(audit.company_id, company1);
    assert.equal(JSON.parse(audit.details).previousTotal, invoice.totalAmount);
    assert.equal(JSON.parse(audit.details).totalAmount, result.totalAmount);

    const snapshot = () => ({ header: connection.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.invoiceId), items: rows(), audit: connection.prepare("SELECT * FROM billing_audit_events WHERE invoice_id = ?").all(invoice.invoiceId) });
    const saved = snapshot();
    const invalid = [
      [], [...items, items[0]],
      items.map((row) => ({ ...row, id: items[0].id })),
      items.map((row) => ({ ...row, id: 999999 })),
      items.map((row) => ({ ...row, id: undefined })),
      items.map((row) => ({ ...row, quantity: 0 })),
      items.map((row) => ({ ...row, quantity: NaN })),
      items.map((row) => ({ ...row, unitPrice: -1 })),
      items.map((row) => ({ ...row, unitPrice: Infinity })),
      items.map((row) => ({ ...row, quantity: Number.MAX_VALUE, unitPrice: Number.MAX_VALUE })),
      items.map((row) => ({ ...row, quantity: 1, unitPrice: 0.1 })),
    ];
    for (const data of invalid) {
      assert.throws(() => save(data as typeof items));
      assert.deepEqual(snapshot(), saved);
    }
    assert.throws(() => save(items, 999999), /nu există/);
    assert.throws(() => save(items, invoice.invoiceId, 'not-a-date'));
    connection.exec("CREATE TRIGGER reject_invoice_audit BEFORE INSERT ON billing_audit_events WHEN NEW.event_type = 'invoice_updated' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    assert.throws(() => save(items.map((row) => ({ ...row, quantity: 5 }))), /audit unavailable/);
    assert.deepEqual(snapshot(), saved);
    connection.exec('DROP TRIGGER reject_invoice_audit');

    const paid = save(items.map((row) => ({ ...row, quantity: 1, unitPrice: 3 / items.length })));
    assert.equal(paid.status, 'paid');
    assert.deepEqual(connection.prepare('SELECT * FROM payments').all(), payments);
    connection.prepare("UPDATE invoices SET status = 'cancelled' WHERE id = ?").run(invoice.invoiceId);
    assert.throws(() => save(), /anulată/);
  } finally { connection.close(); }
});

function weekly(storeId: number, storeExternalId: string, orderId: string) {
  return {
    storeId,
    storeExternalId,
    periodStart: '2026-08-24',
    periodEnd: '2026-08-30',
    sourceFingerprint: orderId.repeat(16).slice(0, 64),
    sourceOrders: [{ id: orderId, updatedAt: '2026-08-27T10:00:00Z' }],
    items: [{ productName: 'Bread', name_ro: 'Pâine', quantity: 2, unitPrice: 5 }],
  };
}

test('invoice outstanding balance isolates sibling stores and keeps company statements unchanged', () => {
  const {connection,company1,company2,store1,goodnessId,vatraId}=fixture();
  try {
    const sibling = Number(connection.prepare("INSERT INTO stores(company_id,name,supabase_store_id) VALUES (?, 'Second store', 'second-store')").run(company1).lastInsertRowid);
    const [first, second] = createWeeklyInvoiceBatchTransaction(connection, [weekly(store1,'store-goodness','first-store'),weekly(sibling,'second-store','second-store')], '2026-08-31');
    recordCompanyPaymentTransaction(connection,{companyId:company1,issuerId:goodnessId,invoiceId:first.invoiceId,amount:4,paymentDate:'2026-09-08',method:'transfer',bankName:'HSBC'});
    assert.equal(outstandingReport(connection,company1,goodnessId,store1).total,6);
    assert.deepEqual(outstandingReport(connection,company1,goodnessId,store1).rows.map(row=>row.id),[first.invoiceId]);
    assert.equal(outstandingReport(connection,company1,goodnessId,sibling).total,10);
    assert.deepEqual(outstandingReport(connection,company1,goodnessId,sibling).rows.map(row=>row.id),[second.invoiceId]);
    assert.equal(statementReport(connection,company1,goodnessId,'2026-08-01','2026-09-30').closing,16);
    assert.equal(outstandingReport(connection,company1,vatraId,store1).total,0);
    assert.equal(outstandingReport(connection,company2,goodnessId,store1).total,0);
    assert.throws(()=>outstandingReport(connection,company1,goodnessId,0));
    cancelInvoiceTransaction(connection,second.invoiceId,'Cancelled test invoice');
    assert.deepEqual(outstandingReport(connection,company1,goodnessId,sibling),{rows:[],total:0});
    recordCompanyPaymentTransaction(connection,{companyId:company1,issuerId:goodnessId,invoiceId:first.invoiceId,amount:6,paymentDate:'2026-09-09',method:'transfer',bankName:'HSBC'});
    assert.deepEqual(outstandingReport(connection,company1,goodnessId,store1),{rows:[],total:0});
  } finally { connection.close(); }
});

test('reports isolate issuers, count payments by payment date, and retain partial balances', () => {
  const {connection,company1,store1,goodnessId,vatraId}=fixture();
  try {
    const [invoice]=createWeeklyInvoiceBatchTransaction(connection,[weekly(store1,'store-goodness','report')],'2026-08-31');
    recordCompanyPaymentTransaction(connection,{companyId:company1,issuerId:goodnessId,invoiceId:invoice.invoiceId,amount:4,paymentDate:'2026-09-08',method:'transfer',bankName:'HSBC'});
    const statement=statementReport(connection,company1,goodnessId,'2026-09-07','2026-09-13');
    assert.equal(statement.opening,10); assert.equal(statement.closing,6); assert.equal(statement.rows.length,1);
    assert.equal(statementReport(connection,company1,vatraId,'2026-09-07','2026-09-13').closing,0);
    assert.equal(outstandingReport(connection,company1,goodnessId,store1).total,6);
    assert.equal(outstandingReport(connection,company1,goodnessId,store1).rows[0].invoice_number,invoice.invoiceNumber);
    assert.equal(paymentReport(connection,'2026-09-08','2026-09-08').length,1);
    assert.deepEqual(weeklyBillingStats(connection,goodnessId,'2026-09-07','2026-09-13'),{totalInvoiced:0,totalPaid:4,totalCredited:0,totalUnpaid:6});
    const payment=connection.prepare('SELECT * FROM payments').get() as any;
    updatePaymentTransaction(connection,{id:payment.id,amount:4,method:'transfer',bankName:'HSBC',paymentDate:'2026-09-06',reason:'Correct bank date'});
    assert.equal(paymentReport(connection,'2026-09-08','2026-09-08').length,0);
    assert.equal(outstandingReport(connection,company1,goodnessId,store1).total,6);
    assert.equal(statementReport(connection,company1,goodnessId,'2026-09-07','2026-09-13').opening,6);
    assert.throws(()=>updatePaymentTransaction(connection,{id:payment.id,amount:4,method:'transfer',bankName:'HSBC',paymentDate:'2026-02-30',reason:'Invalid'}));
    assert.equal((connection.prepare('SELECT payment_date FROM payments').get() as any).payment_date,'2026-09-06');
    assert.throws(()=>statementReport(connection,999,goodnessId,'2026-09-07','2026-09-13'));
    assert.throws(()=>paymentReport(connection,'2026-09-13','2026-09-07'));
    connection.prepare("INSERT INTO company_credit_entries(company_id,issuer_id,source_type,original_amount,available_amount) VALUES (?,?,'legacy',2,2)").run(company1,goodnessId);
    const withLegacy=statementReport(connection,company1,goodnessId,'2026-09-07','2026-09-13');
    assert.equal(withLegacy.legacyCredit,2); assert.equal(withLegacy.opening,4); assert.equal(withLegacy.closing,4);
  } finally {connection.close();}
});

test('explicit zero-quantity removal preserves import history and refuses deleting every line',()=>{
  const {connection,store1}=fixture();
  try {
    const source=weekly(store1,'store-goodness','remove-zero');
    source.items.push({productName:'Cake',name_ro:'Chec',quantity:1,unitPrice:3});
    const [invoice]=createWeeklyInvoiceBatchTransaction(connection,[source],'2026-08-31');
    const rows=connection.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(invoice.invoiceId) as any[];
    const input=rows.map(row=>({id:row.id,productName:row.product_name,quantity:row.quantity,unitPrice:row.unit_price}));
    const batches=connection.prepare('SELECT * FROM invoice_import_batches').all();
    assert.throws(()=>updateInvoiceTransaction(connection,invoice.invoiceId,invoice.invoiceNumber,'2026-08-31',input.map(row=>({...row,quantity:0,remove:true}))));
    assert.throws(()=>updateInvoiceTransaction(connection,invoice.invoiceId,invoice.invoiceNumber,'2026-08-31',[input[0],{...input[1],remove:true}]));
    updateInvoiceTransaction(connection,invoice.invoiceId,invoice.invoiceNumber,'2026-08-31',[input[0],{...input[1],quantity:0,remove:true}]);
    assert.equal((connection.prepare('SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id=?').get(invoice.invoiceId) as any).n,1);
    assert.deepEqual(connection.prepare('SELECT * FROM invoice_import_batches').all(),batches);
  } finally {connection.close();}
});

test('migrates the configured issuer and keeps historical invoice identity immutable', () => {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON'); connection.exec(initialSchema);
  connection.prepare("INSERT INTO app_settings (key, value) VALUES ('invoice_series', 'FACT'), ('invoice_start_number', '8'), ('issuer_name', 'THE GOODNESS BAKER LTD'), ('issuer_vat', 'GB123')").run();
  const client = Number(connection.prepare("INSERT INTO clients (name) VALUES ('Client')").run().lastInsertRowid);
  const company = Number(connection.prepare("INSERT INTO companies (client_id, name, credit_balance) VALUES (?, 'Company', 12.5)").run(client).lastInsertRowid);
  const store = Number(connection.prepare("INSERT INTO stores (company_id, name) VALUES (?, 'Store')").run(company).lastInsertRowid);
  const invoice = Number(connection.prepare("INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount) VALUES (?, '7', '2026-08-01', 10)").run(store).lastInsertRowid);
  const prefixedInvoice = Number(connection.prepare("INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount) VALUES (?, 'FACT-12', '2026-08-02', 10)").run(store).lastInsertRowid);
  ensureBillingIssuerSchema(connection);
  ensureBillingIssuerSchema(connection);
  const goodness = getBillingIssuers(connection).find((issuer) => issuer.code === 'goodness')!;
  assert.equal(goodness.next_invoice_number, 13);
  assert.equal((connection.prepare('SELECT issuer_id FROM companies WHERE id = ?').get(company) as any).issuer_id, goodness.id);
  assert.deepEqual(connection.prepare('SELECT series, sequence_number, reference FROM invoice_identities WHERE invoice_id = ?').get(invoice), { series: 'FACT', sequence_number: 7, reference: 'FACT-7' });
  assert.deepEqual(connection.prepare('SELECT series, sequence_number, reference FROM invoice_identities WHERE invoice_id = ?').get(prefixedInvoice), { series: 'FACT', sequence_number: 12, reference: 'FACT-12' });
  assert.equal((connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(company, goodness.id) as any).balance, 12.5);
  connection.close();
});

test('keeps default and explicit issuer choices distinct at company level', () => {
  const { connection, company1, company2, goodnessId, vatraId } = fixture();
  try {
    assert.deepEqual(
      connection.prepare('SELECT issuer_id, issuer_assignment_mode FROM companies WHERE id = ?').get(company1),
      { issuer_id: goodnessId, issuer_assignment_mode: 'default' },
    );
    assert.deepEqual(
      connection.prepare('SELECT issuer_id, issuer_assignment_mode FROM companies WHERE id = ?').get(company2),
      { issuer_id: vatraId, issuer_assignment_mode: 'explicit' },
    );

    assignCompanyIssuer(connection, company2, null);
    assert.deepEqual(
      connection.prepare('SELECT issuer_id, issuer_assignment_mode FROM companies WHERE id = ?').get(company2),
      { issuer_id: goodnessId, issuer_assignment_mode: 'default' },
    );

    assignCompanyIssuer(connection, company2, goodnessId);
    assert.deepEqual(
      connection.prepare('SELECT issuer_id, issuer_assignment_mode FROM companies WHERE id = ?').get(company2),
      { issuer_id: goodnessId, issuer_assignment_mode: 'explicit' },
    );
    const audit = connection.prepare("SELECT details FROM billing_audit_events WHERE event_type = 'company_issuer_assigned' AND company_id = ? ORDER BY id DESC LIMIT 1").get(company2) as { details: string };
    assert.deepEqual(JSON.parse(audit.details), {
      previousIssuerId: goodnessId,
      previousAssignmentMode: 'default',
      assignmentMode: 'explicit',
    });
  } finally { connection.close(); }
});

test('issues a mixed batch with independent counters and immutable issuer snapshots', () => {
  const { connection, store1, store2, goodnessId, vatraId } = fixture();
  try {
    const created = createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-goodness'), weekly(store2, 'store-vatra', 'order-vatra')], '2026-08-31');
    assert.deepEqual(created.map((row) => row.invoiceNumber), ['TGB-10', 'VATRA-1']);
    assert.equal(created[0].issuerSettings.vatRegistered, true);
    assert.equal(created[1].issuerSettings.vatRegistered, false);
    const originalSnapshot = (connection.prepare('SELECT issuer_snapshot_json FROM invoice_identities WHERE invoice_id = ?').get(created[0].invoiceId) as any).issuer_snapshot_json;
    assert.deepEqual(connection.prepare('SELECT id, next_invoice_number FROM billing_issuers WHERE id IN (?, ?) ORDER BY id').all(goodnessId, vatraId).map((row: any) => row.next_invoice_number), [11, 2]);
    const snapshots = connection.prepare('SELECT COUNT(*) AS value FROM invoice_identities').get() as any;
    assert.equal(snapshots.value, 2);
    const goodness = getBillingIssuers(connection).find((issuer) => issuer.id === goodnessId)!;
    assert.throws(() => updateBillingIssuer(connection, issuerInput(goodness, { nextInvoiceNumber: 20 })), /Motivul/);
    assert.throws(() => updateBillingIssuer(connection, issuerInput(goodness, { invoiceSeries: 'NEW', nextInvoiceNumber: 11 })), /nu poate fi modificată/);
    updateBillingIssuer(connection, issuerInput(goodness, { nextInvoiceNumber: 20, counterChangeReason: 'Continuare după registrul extern verificat' }));
    assert.equal((connection.prepare('SELECT next_invoice_number FROM billing_issuers WHERE id = ?').get(goodnessId) as any).next_invoice_number, 20);
    assert.equal((connection.prepare('SELECT issuer_snapshot_json FROM invoice_identities WHERE invoice_id = ?').get(created[0].invoiceId) as any).issuer_snapshot_json, originalSnapshot);
  } finally { connection.close(); }
});

test('stores the authoritative zone snapshot in the invoice batch audit', () => {
  const { connection, store1, goodnessId } = fixture();
  try {
    createWeeklyInvoiceBatchTransaction(
      connection,
      [weekly(store1, 'store-goodness', 'order-zone')],
      '2026-08-31',
      {
        kind: 'zone',
        zoneId: '11111111-1111-4111-8111-111111111111',
        zoneName: 'North',
        driverId: '22222222-2222-4222-8222-222222222222',
        driverName: 'Driver One',
        storeCount: 1,
      },
    );
    const row = connection.prepare("SELECT details FROM billing_audit_events WHERE event_type = 'weekly_invoice_batch_issued' AND issuer_id = ? ORDER BY id DESC LIMIT 1").get(goodnessId) as any;
    assert.deepEqual(JSON.parse(row.details).selection, {
      kind: 'zone',
      zoneId: '11111111-1111-4111-8111-111111111111',
      zoneName: 'North',
      driverId: '22222222-2222-4222-8222-222222222222',
      driverName: 'Driver One',
      storeCount: 1,
    });
  } finally { connection.close(); }
});

test('issues a manual invoice only from active catalog products and keeps bilingual product data', () => {
  const { connection, store1, goodnessId } = fixture();
  try {
    const productId = Number(connection.prepare(`
      INSERT INTO cloud_products (supabase_product_id, name, name_ro, variant_label, unit, price_standard, available, display_order)
      VALUES ('product-bread', 'Sliced Bread', 'Pâine feliată', 'Large', 'pcs', 2.75, 1, 6)
    `).run().lastInsertRowid);
    const invoice = createManualInvoiceTransaction(connection, {
      storeId: store1,
      invoiceDate: '2026-09-03',
      items: [{ productId, quantity: 3, unitPrice: 2.5 }],
    });

    assert.equal(invoice.invoiceNumber, 'TGB-10');
    assert.equal(invoice.totalAmount, 7.5);
    assert.deepEqual(connection.prepare(`
      SELECT product_name, product_name_ro, variant_label, unit, quantity, unit_price, external_product_id, product_order
      FROM invoice_items WHERE invoice_id = ?
    `).get(invoice.invoiceId), {
      product_name: 'Sliced Bread',
      product_name_ro: 'Pâine feliată',
      variant_label: null,
      unit: 'pcs',
      quantity: 3,
      unit_price: 2.5,
      external_product_id: 'product-bread',
      product_order: 6,
    });
    assert.equal((connection.prepare("SELECT COUNT(*) AS value FROM billing_audit_events WHERE event_type = 'manual_invoice_issued' AND issuer_id = ?").get(goodnessId) as any).value, 1);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoice_import_batches WHERE invoice_id = ?').get(invoice.invoiceId) as any).value, 0);

    assert.throws(() => createManualInvoiceTransaction(connection, {
      storeId: store1,
      invoiceDate: '2026-09-03',
      items: [{ productId: 999999, quantity: 1, unitPrice: 1 }],
    }), /nu mai există/);
    connection.prepare('UPDATE cloud_products SET available = 0 WHERE id = ?').run(productId);
    assert.throws(() => createManualInvoiceTransaction(connection, {
      storeId: store1,
      invoiceDate: '2026-09-03',
      items: [{ productId, quantity: 1, unitPrice: 1 }],
    }), /nu mai este disponibil/);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices').get() as any).value, 1);
  } finally { connection.close(); }
});

test('separates payments by issuer and reissues a cancelled weekly invoice with a new number', () => {
  const { connection, company1, company2, store1, store2, goodnessId, vatraId } = fixture();
  try {
    const [goodnessInvoice, vatraInvoice] = createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-goodness'), weekly(store2, 'store-vatra', 'order-vatra')], '2026-08-31');
    recordCompanyPaymentTransaction(connection, { companyId: company1, issuerId: goodnessId, invoiceId: goodnessInvoice.invoiceId, amount: 15, paymentDate: '2026-09-01', method: 'transfer' });
    assert.equal((connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(company1, goodnessId) as any).balance, 5);
    assert.equal((connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(company2, vatraId) as any).balance, 0);
    assert.equal((connection.prepare('SELECT paid_amount FROM invoices WHERE id = ?').get(vatraInvoice.invoiceId) as any).paid_amount, 0);

    cancelInvoiceTransaction(connection, vatraInvoice.invoiceId, 'Emitent atribuit greșit');
    const replacement = reissueCancelledWeeklyInvoiceTransaction(connection, vatraInvoice.invoiceId, '2026-09-01');
    assert.equal(replacement.invoiceNumber, 'VATRA-2');
    assert.equal((connection.prepare('SELECT status FROM invoices WHERE id = ?').get(vatraInvoice.invoiceId) as any).status, 'cancelled');
    assert.equal((connection.prepare('SELECT replacement_invoice_id FROM invoice_replacements WHERE cancelled_invoice_id = ?').get(vatraInvoice.invoiceId) as any).replacement_invoice_id, replacement.invoiceId);
    assert.throws(() => cancelInvoiceTransaction(connection, goodnessInvoice.invoiceId, 'Nu mai este necesară'), /plăți/);
  } finally { connection.close(); }
});

test('permanently deletes only a simple invoice while billing test mode is explicitly enabled', () => {
  const { connection, store1, goodnessId } = fixture();
  try {
    const [invoice] = createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-test-delete')], '2026-08-31');
    assert.throws(() => deleteInvoiceForTestingTransaction(connection, invoice.invoiceId, `STERGE ${invoice.invoiceNumber}`), /Modul test/);
    assert.throws(() => setBillingTestModeTransaction(connection, true, 'da'), /MOD TEST/);
    setBillingTestModeTransaction(connection, true, 'MOD TEST');
    assert.throws(() => deleteInvoiceForTestingTransaction(connection, invoice.invoiceId, 'STERGE ALTCEVA'), /scrie exact/);

    const deleted = deleteInvoiceForTestingTransaction(connection, invoice.invoiceId, `STERGE ${invoice.invoiceNumber}`);
    assert.equal(deleted.reference, invoice.invoiceNumber);
    assert.equal(deleted.counterRewound, true);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices').get() as any).value, 0);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoice_source_orders').get() as any).value, 0);
    assert.equal((connection.prepare('SELECT next_invoice_number FROM billing_issuers WHERE id = ?').get(goodnessId) as any).next_invoice_number, 10);
    assert.equal((connection.prepare("SELECT COUNT(*) AS value FROM billing_audit_events WHERE event_type = 'test_invoice_deleted'").get() as any).value, 1);
  } finally { connection.close(); }
});

test('deletes a migrated legacy invoice using the number shown by the interface', () => {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON');
  connection.exec(initialSchema);
  try {
    connection.prepare("INSERT INTO app_settings (key, value) VALUES ('invoice_series', 'TGB'), ('invoice_start_number', '4'), ('issuer_name', 'THE GOODNESS BAKER LTD')").run();
    const clientId = Number(connection.prepare("INSERT INTO clients (name) VALUES ('Client')").run().lastInsertRowid);
    const companyId = Number(connection.prepare("INSERT INTO companies (client_id, name) VALUES (?, 'Companie')").run(clientId).lastInsertRowid);
    const storeId = Number(connection.prepare("INSERT INTO stores (company_id, name) VALUES (?, 'Magazin')").run(companyId).lastInsertRowid);
    const invoiceId = Number(connection.prepare("INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount) VALUES (?, '3', '2026-08-01', 10)").run(storeId).lastInsertRowid);
    connection.prepare("INSERT INTO invoice_items (invoice_id, product_name, quantity, unit_price, total_price) VALUES (?, 'Produs', 1, 10, 10)").run(invoiceId);
    ensureBillingIssuerSchema(connection);
    ensureCreditNoteSchema(connection);
    assert.equal((connection.prepare('SELECT reference FROM invoice_identities WHERE invoice_id = ?').get(invoiceId) as any).reference, 'TGB-3');

    setBillingTestModeTransaction(connection, true, 'MOD TEST');
    const deleted = deleteInvoiceForTestingTransaction(connection, invoiceId, 'STERGE 3');
    assert.equal(deleted.reference, 'TGB-3');
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices WHERE id = ?').get(invoiceId) as any).value, 0);
  } finally { connection.close(); }
});

test('test deletion removes invoice payments and imported source links atomically', () => {
  const { connection, company1, store1, goodnessId } = fixture();
  try {
    const [invoice] = createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-paid-delete')], '2026-08-31');
    recordCompanyPaymentTransaction(connection, { companyId: company1, issuerId: goodnessId, invoiceId: invoice.invoiceId, amount: 5, paymentDate: '2026-09-01', method: 'cash' });
    setBillingTestModeTransaction(connection, true, 'MOD TEST');
    const deleted = deleteInvoiceForTestingTransaction(connection, invoice.invoiceId, `STERGE ${invoice.invoiceNumber}`);
    assert.equal(deleted.deletedPayments, 1);
    assert.equal(deleted.deletedCreditNotes, 0);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices WHERE id = ?').get(invoice.invoiceId) as any).value, 0);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM payments WHERE invoice_id = ?').get(invoice.invoiceId) as any).value, 0);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoice_source_orders').get() as any).value, 0);
  } finally { connection.close(); }
});

test('updates a payment and recalculates invoice state with an audit event', () => {
  const { connection, company1, store1, goodnessId } = fixture();
  try {
    const [invoice] = createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-edit-payment')], '2026-08-31');
    recordCompanyPaymentTransaction(connection, { companyId: company1, issuerId: goodnessId, invoiceId: invoice.invoiceId, amount: 5, paymentDate: '2026-09-01', method: 'cash' });
    const payment = connection.prepare('SELECT id FROM payments WHERE invoice_id = ?').get(invoice.invoiceId) as { id: number };

    updatePaymentTransaction(connection, { id: payment.id, amount: 8, method: 'transfer', bankName: 'Virgin', reason: 'Corectare extras bancar' });
    assert.deepEqual(connection.prepare('SELECT amount, method, bank_name FROM payments WHERE id = ?').get(payment.id), { amount: 8, method: 'transfer', bank_name: 'Virgin' });
    assert.deepEqual(connection.prepare('SELECT paid_amount, status FROM invoices WHERE id = ?').get(invoice.invoiceId), { paid_amount: 8, status: 'partial' });
    assert.throws(() => updatePaymentTransaction(connection, { id: payment.id, amount: 11, method: 'cash', reason: 'Prea mult' }), /depăși/);
    assert.deepEqual(connection.prepare('SELECT amount, method, bank_name FROM payments WHERE id = ?').get(payment.id), { amount: 8, method: 'transfer', bank_name: 'Virgin' });
    assert.equal((connection.prepare("SELECT COUNT(*) AS value FROM billing_audit_events WHERE event_type = 'payment_updated'").get() as any).value, 1);
  } finally { connection.close(); }
});

test('updates an advance payment and its available issuer credit together', () => {
  const { connection, company1, store1, goodnessId } = fixture();
  try {
    const [invoice] = createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-edit-advance')], '2026-08-31');
    recordCompanyPaymentTransaction(connection, { companyId: company1, issuerId: goodnessId, invoiceId: invoice.invoiceId, amount: 15, paymentDate: '2026-09-01', method: 'cash' });
    const advance = connection.prepare('SELECT id FROM payments WHERE invoice_id IS NULL AND company_id = ?').get(company1) as { id: number };

    updatePaymentTransaction(connection, { id: advance.id, amount: 7, method: 'transfer', bankName: 'Barclays', reason: 'Corectare avans' });
    assert.equal((connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(company1, goodnessId) as any).balance, 7);
    assert.deepEqual(connection.prepare("SELECT original_amount, available_amount FROM company_credit_entries WHERE source_type = 'payment_overpayment' AND source_id = ?").get(advance.id), { original_amount: 7, available_amount: 7 });
  } finally { connection.close(); }
});

test('rolls back the entire mixed batch when one issuer is incomplete', () => {
  const { connection, store1, store2, vatraId } = fixture();
  try {
    connection.prepare('UPDATE billing_issuers SET is_active = 0 WHERE id = ?').run(vatraId);
    assert.throws(() => createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-goodness'), weekly(store2, 'store-vatra', 'order-vatra')], '2026-08-31'), /configurat complet/);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices').get() as any).value, 0);
    assert.equal((connection.prepare("SELECT next_invoice_number FROM billing_issuers WHERE code = 'goodness'").get() as any).next_invoice_number, 10);
  } finally { connection.close(); }
});

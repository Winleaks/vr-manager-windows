import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ensureBillingPostcodeSchema } from './billingPostcodes.ts';

test('adds the store postcode column idempotently without changing existing data', () => {
  const connection = new Database(':memory:');
  try {
    connection.exec(`
      CREATE TABLE stores (
        id INTEGER PRIMARY KEY,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        address TEXT
      );
      INSERT INTO stores (id, company_id, name, address)
      VALUES (1, 10, 'Store', '71 Southernhay, Basildon');
    `);
    ensureBillingPostcodeSchema(connection);
    ensureBillingPostcodeSchema(connection);
    assert.ok((connection.prepare('PRAGMA table_info(stores)').all() as Array<{ name: string }>).some((column) => column.name === 'postcode'));
    assert.deepEqual(connection.prepare('SELECT name, address, postcode FROM stores WHERE id = 1').get(), {
      name: 'Store', address: '71 Southernhay, Basildon', postcode: null,
    });
  } finally {
    connection.close();
  }
});

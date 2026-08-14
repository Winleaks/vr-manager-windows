import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { verifyDatabaseFile } from './databaseValidation.ts';

function withTempDirectory(run: (directory: string) => void) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-hub-management-db-test-'));
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('accepts an integral SQLite backup with the required application schema', () => {
  withTempDirectory((directory) => {
    const filePath = path.join(directory, 'valid.db');
    const database = new Database(filePath);
    database.exec(`
      CREATE TABLE raw_materials (id INTEGER PRIMARY KEY);
      CREATE TABLE finished_products (id INTEGER PRIMARY KEY);
      CREATE TABLE stock_movements (id INTEGER PRIMARY KEY);
      CREATE TABLE categories (id INTEGER PRIMARY KEY);
    `);
    database.close();

    assert.equal(verifyDatabaseFile(filePath), true);
  });
});

test('rejects corrupt files and valid SQLite files with an incompatible schema', () => {
  withTempDirectory((directory) => {
    const corruptPath = path.join(directory, 'corrupt.db');
    fs.writeFileSync(corruptPath, 'not a sqlite database');
    assert.throws(() => verifyDatabaseFile(corruptPath));

    const wrongSchemaPath = path.join(directory, 'wrong-schema.db');
    const database = new Database(wrongSchemaPath);
    database.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY);');
    database.close();
    assert.throws(() => verifyDatabaseFile(wrongSchemaPath), /schema compatibilă/);
  });
});

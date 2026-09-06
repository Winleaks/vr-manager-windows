import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('development and test commands rebuild better-sqlite3 for their native runtime', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts.predev, 'electron-rebuild -f -w better-sqlite3');
  assert.equal(packageJson.scripts.pretest, 'npm rebuild better-sqlite3');
  assert.match(packageJson.devDependencies['@electron/rebuild'], /^\^4\./);
});

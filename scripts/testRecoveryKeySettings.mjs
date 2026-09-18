import assert from 'node:assert/strict';

export async function testRecoveryKeySettings(page, open) {
  await open('protected');
  const sidebar = page.locator('aside');
  await sidebar.getByRole('button', { name: 'Setări', exact: true }).click();
  const section = page.getByRole('region', { name: 'Cheie de recuperare / activare Viewer' });
  const generate = () => section.getByRole('button', { name: 'Generează o cheie nouă de recuperare', exact: true });
  const key = () => section.getByLabel('Cheie nouă de recuperare', { exact: true });
  assert.equal(await generate().isDisabled(), true);
  await section.getByLabel('PIN actual Writer').fill('482719');
  assert.equal(await generate().isDisabled(), true);
  await section.getByRole('checkbox').check();
  await generate().click();
  await key().waitFor();
  assert.equal(await key().inputValue(), 'SYNTHETIC-RECOVERY-TEST-ONLY');
  assert.equal(await key().getAttribute('readonly'), '');
  assert.equal(await section.getByLabel('PIN actual Writer').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__inputTest.calls), ['rotate-recovery']);
  assert.deepEqual(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), { local: {}, session: {} });
  await section.getByRole('button', { name: 'Am salvat cheia — ascunde' }).click();
  assert.equal(await key().count(), 0);
  await sidebar.getByRole('button', { name: 'Facturi', exact: true }).click();
  await sidebar.getByRole('button', { name: 'Setări', exact: true }).click();
  assert.equal(await key().count(), 0);

  await page.evaluate(() => window.__inputTest.setRecoveryFailure(true));
  await section.getByLabel('PIN actual Writer').fill('482719');
  await section.getByRole('checkbox').check();
  await generate().click();
  await section.getByRole('alert').waitFor();
  assert.equal(await key().count(), 0);
  assert.equal(await section.getByLabel('PIN actual Writer').inputValue(), '');

  await page.evaluate(() => window.__inputTest.setRecoveryFailure(false));
  await section.getByLabel('PIN actual Writer').fill('482719');
  await generate().click();
  await key().waitFor();
  await sidebar.getByRole('button', { name: 'Blochează și ieși' }).click();
  await page.getByLabel('PIN', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Cheie nouă de recuperare', { exact: true }).count(), 0);

  await open('protected', '&role=viewer');
  await page.getByText('Viewer · Doar citire').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Generează o cheie nouă de recuperare' }).count(), 0);
  assert.equal(await sidebar.getByRole('button', { name: 'Setări', exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__inputTest.calls), []);
  console.log('PASS recovery rotation: Writer PIN/confirmation, one-time display, no storage, safe error, lock clearing and no Viewer action');
}

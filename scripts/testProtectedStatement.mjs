import assert from 'node:assert/strict';

export async function testProtectedStatement(page, open) {
  for (const role of ['writer', 'viewer']) {
    await open('protected', `&statement=1&role=${role}`);
    await page.locator('aside').getByRole('button', { name: 'Clienți & Entități', exact: true }).click();
    await page.getByRole('button', { name: role === 'writer' ? 'Deschide profilul Fixture Company' : 'Fixture Company', exact: true }).click();
    const section = page.getByRole('region', { name: 'Statement registru separat' });
    const submit = section.getByRole('button', { name: 'Deschide Statement', exact: true });
    assert.equal(await submit.isDisabled(), true);
    await section.getByLabel('Emitent', { exact: true }).selectOption('goodness');
    assert.deepEqual(await section.getByLabel('Magazin', { exact: true }).locator('option').allTextContents(), ['Toate magazinele', 'Fixture Store', 'Second Store']);
    await section.getByLabel('Magazin', { exact: true }).selectOption('local:2');
    await section.getByLabel('De la', { exact: true }).fill('2026-10-01');
    await section.getByLabel('Până la', { exact: true }).fill('2026-10-31');
    if (process.env.VR_PROFILE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.VR_PROFILE_SCREENSHOT_DIR}/statement-${role}.png` });
    await submit.click();
    await page.waitForFunction(() => window.__inputTest.calls.some(row => row?.action === 'open'));
    assert.equal(await submit.isDisabled(), true);
    await section.getByRole('status').waitFor({ state: 'hidden' });
    const first = await page.evaluate(() => window.__inputTest.calls.find(row => row?.action === 'open'));
    assert.deepEqual(first, { companyKey: 'fixture-company', issuerCode: 'goodness', storeInvoiceId: 'second-store', from: '2026-10-01', to: '2026-10-31', action: 'open' });
    await section.getByLabel('Emitent', { exact: true }).selectOption('vatra');
    assert.equal(await section.getByLabel('Magazin', { exact: true }).inputValue(), '');
    assert.deepEqual(await section.getByLabel('Magazin', { exact: true }).locator('option').allTextContents(), ['Toate magazinele', 'Vatra Store']);
    await section.getByRole('button', { name: 'Printează Statement', exact: true }).click();
    await section.getByRole('status').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__inputTest.calls.find(row => row?.action === 'print').storeInvoiceId), null);
    await page.evaluate(() => window.__inputTest.setStatementFailure(true));
    await section.getByRole('button', { name: 'Trimite Statement pe WhatsApp', exact: true }).click();
    await section.getByRole('alert').waitFor();
    assert.match(await section.getByRole('alert').textContent(), /indisponibil/);
    assert.equal(await section.getByLabel('De la', { exact: true }).inputValue(), '2026-10-01');
    await page.evaluate(() => window.__inputTest.setStatementFailure(false));
    await submit.click(); await section.getByRole('status').waitFor({ state: 'hidden' });
    assert.equal(await section.getByRole('alert').count(), 0);
    await section.getByLabel('Până la', { exact: true }).fill('2026-09-30');
    assert.equal(await submit.isDisabled(), true);
  }
  console.log('PASS Writer/Viewer Statement store selection, issuer reset, dates, document payloads, busy guard and error/retry');
}

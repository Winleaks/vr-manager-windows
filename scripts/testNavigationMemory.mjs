import assert from 'node:assert/strict';

// Invoked by testRendererInputs.mjs against the real pages and synthetic IPC.
export async function testNavigationMemory(page, open) {
  const main = () => page.locator('main[data-navigation-scroll]');
  const position = () => main().evaluate(element => element.scrollTop);
  const scroll = async value => {
    await page.waitForFunction(top => {
      const element = document.querySelector('main[data-navigation-scroll]');
      return element.scrollHeight - element.clientHeight >= top;
    }, value);
    await main().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await main().hover();
    await page.mouse.wheel(0, value - await position());
    await page.waitForFunction(top => Math.abs(document.querySelector('main[data-navigation-scroll]').scrollTop - top) < 2, value, { timeout: 5000 }).catch(async error => {
      console.error('Scroll mismatch', value, await main().evaluate(element => ({ top: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight })));
      throw error;
    });
    // Allow the browser's asynchronous scroll event to be recorded.
    await main().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const restored = async expected => {
    await page.waitForFunction(top => Math.abs(document.querySelector('main[data-navigation-scroll]').scrollTop - top) < 2, expected, { timeout: 5000 });
  };
  await open('navigation', '&navigation=1');
  const search = page.getByPlaceholder('Caută companie după nume, VAT / CUI, CRN...');
  await search.fill('Fixture');
  const client = page.getByText('Fixture Company 40', { exact: true });
  await client.scrollIntoViewIfNeeded();
  const listPosition = await position();
  assert.ok(listPosition > 500);
  await client.click();
  await page.getByRole('button', { name: 'Înapoi la lista de clienți' }).waitFor();
  await restored(0);
  await page.getByRole('button', { name: /Toate facturile/i }).click();
  await scroll(1400);
  const edit = page.getByTitle('Editează factura').filter({ visible: true }).first();
  await edit.scrollIntoViewIfNeeded();
  const beforeEditor = await position();
  await edit.click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Anulează', exact: true }).click();
  await restored(beforeEditor);
  // Route changes must keep the selected company, its tab and scroll position.
  await page.getByRole('link', { name: 'Facturi', exact: true }).click();
  await page.getByRole('heading', { name: 'Facturi Emise', exact: true }).waitFor();
  await page.getByText('#TEST-80', { exact: true }).waitFor();
  const invoiceSearch = page.getByPlaceholder('Caută după nr. factură, magazin, firmă sau client...');
  await invoiceSearch.fill('TEST');
  await page.getByRole('combobox').nth(0).selectOption('unpaid');
  await page.getByRole('combobox').nth(1).selectOption('1');
  await page.getByLabel('Filtrează după interval calendaristic').check();
  const dates = await page.locator('.react-datepicker-wrapper input').evaluateAll(inputs => inputs.map(input => input.value));
  await scroll(1800);
  await page.getByRole('link', { name: 'Clienți & Entități', exact: true }).click();
  await page.getByRole('button', { name: 'Înapoi la lista de clienți' }).waitFor();
  assert.match(await page.getByRole('button', { name: /Toate facturile/i }).getAttribute('class'), /border-indigo-600/);
  await restored(beforeEditor);
  await page.getByRole('button', { name: 'Înapoi la lista de clienți' }).click();
  await restored(listPosition);
  assert.equal(await search.inputValue(), 'Fixture');
  await page.goBack();
  await restored(1800);
  assert.equal(await invoiceSearch.inputValue(), 'TEST');
  assert.equal(await page.getByRole('combobox').nth(0).inputValue(), 'unpaid');
  assert.equal(await page.getByRole('combobox').nth(1).inputValue(), '1');
  assert.equal(await page.getByLabel('Filtrează după interval calendaristic').isChecked(), true);
  assert.deepEqual(await page.locator('.react-datepicker-wrapper input').evaluateAll(inputs => inputs.map(input => input.value)), dates);
  const invoiceEdit = page.getByTitle('Editează factura').nth(35);
  await invoiceEdit.scrollIntoViewIfNeeded();
  const beforeSave = await position();
  await invoiceEdit.click();
  await page.getByRole('button', { name: 'Salvează modificările' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByText('#TEST-80', { exact: true }).waitFor();
  await page.waitForTimeout(250); // synthetic IPC delay; assert the final refresh too
  assert.ok(Math.abs(await position() - beforeSave) < 100, 'saving/refetching must not collapse the invoice list');
  console.log('PASS normal client list/profile/tab, editor focus, async route/back scroll and invoice search retention');

  await open('protected', '&navigation=1');
  const sidebar = page.locator('aside');
  await sidebar.getByRole('button', { name: 'Clienți & Entități' }).click();
  await page.getByLabel('Caută companie sau magazin', { exact: true }).fill('Fixture');
  const protectedClient = page.getByRole('button', { name: 'Deschide profilul Fixture Company 40', exact: true });
  await protectedClient.scrollIntoViewIfNeeded();
  const protectedListPosition = await position();
  await protectedClient.click();
  await page.getByText('#TEST-80', { exact: true }).waitFor();
  await scroll(1600);
  await sidebar.getByRole('button', { name: 'Facturi', exact: true }).click();
  await page.getByText('#TEST-80', { exact: true }).waitFor();
  await page.getByRole('searchbox').fill('TEST');
  await page.getByRole('combobox', { name: /^Status/ }).selectOption('partial');
  await scroll(1900);
  await sidebar.getByRole('button', { name: 'Clienți & Entități' }).click();
  await page.getByText('#TEST-80', { exact: true }).waitFor();
  await restored(1600);
  await page.getByRole('button', { name: 'Înapoi la lista de clienți' }).click();
  await restored(protectedListPosition);
  assert.equal(await page.getByLabel('Caută companie sau magazin', { exact: true }).inputValue(), 'Fixture');
  await sidebar.getByRole('button', { name: 'Facturi', exact: true }).click();
  await restored(1900);
  assert.equal(await page.getByRole('searchbox').inputValue(), 'TEST');
  assert.equal(await page.getByRole('combobox', { name: /^Status/ }).inputValue(), 'partial');
  assert.deepEqual(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), { local: {}, session: {} });
  await sidebar.getByRole('button', { name: 'Blochează și ieși' }).click();
  await page.getByLabel('PIN', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Deblochează', exact: true }).click();
  await sidebar.getByRole('button', { name: 'Facturi', exact: true }).click();
  await page.getByText('#TEST-80', { exact: true }).waitFor();
  await restored(0);
  assert.equal(await page.getByRole('searchbox').inputValue(), '');
  assert.equal(await page.getByRole('combobox', { name: /^Status/ }).inputValue(), 'all');
  console.log('PASS protected list/profile and invoice filters/scroll; no browser-storage persistence');

  await open('protected', '&navigation=1&role=viewer');
  await page.getByText('#TEST-80', { exact: true }).waitFor();
  await page.getByRole('searchbox').fill('TEST');
  await scroll(1700);
  await sidebar.getByRole('button', { name: 'Clienți & Entități' }).click();
  await sidebar.getByRole('button', { name: 'Facturi', exact: true }).click();
  await restored(1700);
  assert.equal(await page.getByRole('searchbox').inputValue(), 'TEST');
  assert.equal(await page.getByTitle('Editează factura').count(), 0);
  await sidebar.getByRole('button', { name: 'Blochează registrul', exact: true }).click();
  await page.getByLabel('PIN', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Deblochează', exact: true }).click();
  await page.getByText('#TEST-80', { exact: true }).waitFor();
  await restored(0);
  assert.equal(await page.getByRole('searchbox').inputValue(), '');
  console.log('PASS Viewer navigation, no edit actions, and lock/unlock discards session preferences');
}

import assert from 'node:assert/strict';

export async function testProtectedCompanyOrder(page, open) {
  const expected = ['Client A', 'Client Z', 'Client B', 'Client Zero', 'Client Alpha', 'Client Other'];
  const sidebar = () => page.locator('aside').getByRole('button', { name: 'Clienți & Entități', exact: true });
  const search = () => page.getByLabel('Caută companie sau magazin', { exact: true });
  const clients = () => page.locator('main button').filter({ hasText: /^Client / });
  const ordered = async names => {
    await page.waitForFunction(expected => {
      const names = [...document.querySelectorAll('main button')].map(el => el.textContent).filter(text => /^Client /.test(text));
      return JSON.stringify(names) === JSON.stringify(expected);
    }, names);
    assert.deepEqual(await clients().allTextContents(), names);
  };
  for (const role of ['writer', 'viewer']) {
    await open('protected', `&client-order=1&role=${role}`);
    await sidebar().click();
    await ordered(expected);
    assert.equal(await page.getByText('Rest de plată: £50.10', { exact: true }).count(), 2);
    assert.equal(await page.getByText('Rest de plată: £0.00', { exact: true }).count(), 1);
    await search().click(); await search().pressSequentially('nord');
    await ordered(expected);
    assert.equal(await search().evaluate(el => el === document.activeElement), true);

    if (role === 'writer') {
      await clients().filter({ hasText: /^Client Z$/ }).click();
      await page.getByRole('button', { name: 'Înapoi la lista de clienți' }).waitFor();
      await page.evaluate(() => window.__inputTest.setClientOrder({ high: 200 }));
      await page.getByRole('button', { name: 'Înapoi la lista de clienți' }).click();
    } else {
      assert.equal(await page.getByRole('button', { name: /Adaugă în registru|Elimină din registru/ }).count(), 0);
      await page.evaluate(() => window.__inputTest.setClientOrder({ high: 200 }));
      await page.getByRole('button', { name: 'Actualizează din Drive', exact: true }).click();
    }
    await search().focus();
    await ordered(['Client Z', 'Client A', 'Client B', 'Client Zero', 'Client Alpha', 'Client Other']);
    assert.equal(await search().inputValue(), 'nord');
    assert.equal(await search().evaluate(el => el === document.activeElement), true, 'refresh must preserve search focus');
    await page.getByText('Rest de plată: £220.10', { exact: true }).waitFor();

    if (role === 'writer') {
      const alpha = clients().filter({ hasText: /^Client Alpha$/ }).locator('..').locator('..');
      await alpha.getByRole('button', { name: 'Adaugă în registru' }).click();
      await ordered(['Client Alpha', 'Client Z', 'Client A', 'Client B', 'Client Zero', 'Client Other']);
      await page.getByText('Rest de plată: £600.00', { exact: true }).waitFor();
      await alpha.getByRole('button', { name: 'Elimină din registru' }).click();
      await ordered(['Client Z', 'Client A', 'Client B', 'Client Zero', 'Client Alpha', 'Client Other']);
    }

    await page.evaluate(() => window.__inputTest.setClientOrder({ fail: true }));
    if (role === 'writer') {
      await clients().first().click();
      await page.getByRole('button', { name: 'Înapoi la lista de clienți' }).click();
    } else await page.getByRole('button', { name: 'Actualizează din Drive', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Solduri indisponibile' }).waitFor();
    assert.equal(await clients().count(), 0, 'failed balances must not appear as valid rows');
    await page.evaluate(() => window.__inputTest.setClientOrder({ fail: false }));
    await page.getByRole('button', { name: 'Reîncearcă', exact: true }).click();
    await ordered(['Client Z', 'Client A', 'Client B', 'Client Zero', 'Client Alpha', 'Client Other']);
    assert.equal(await search().inputValue(), 'nord');
  }
  console.log('PASS Writer/Viewer client balances, order, search, focus, profile refresh, assignment, failure and retry');
}

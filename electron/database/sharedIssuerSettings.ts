import type Database from 'better-sqlite3';
import type { SharedIssuerSettingsInput } from '../../src/shared/sharedIssuerSettings.ts';
import { optionalText, requirePositiveInteger, requireText } from './businessValidation.ts';
import { getBillingIssuer } from './billingIssuers.ts';

/** Updates the existing common configuration, never private-vault or normal numbering fields. */
export function updateSharedIssuerSettings(connection: Database.Database, input: SharedIssuerSettingsInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Setări invalide.');
  const id = requirePositiveInteger(input.id, 'Emitentul');
  const issuer = getBillingIssuer(connection, id);
  if (!issuer) throw new Error('Emitentul nu există.');
  const legalName = requireText(input.legalName, 'Denumirea juridică', 200);
  const address = optionalText(input.address, 'Adresa emitentului', 500);
  const crn = optionalText(input.companyNumber, 'Company Registration Number', 100);
  const vat = optionalText(input.vatNumber, 'VAT Number', 100);
  const bank1 = optionalText(input.bankName1, 'Banca principală', 200);
  const account1 = optionalText(input.accountNumber1, 'Numărul contului principal', 100);
  const sort1 = optionalText(input.sortCode1, 'Sort Code principal', 50);
  if (issuer.is_active && (!address || !crn || !bank1 || !account1 || !sort1 || (issuer.vat_registered && !vat))) {
    throw new Error('Completează datele juridice și contul bancar principal al emitentului activ.');
  }
  const color = (value: unknown) => {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Culoare PDF invalidă.');
    return value.toUpperCase();
  };
  const opacity = input.alternateRowOpacity;
  if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 30) throw new Error('Opacitatea trebuie să fie între 0 și 30.');
  const logo = input.invoiceLogo;
  if (typeof logo !== 'string' || logo.length > 1_400_000) throw new Error('Logo-ul trebuie să fie PNG/JPEG, de cel mult 1 MB.');
  if (logo) {
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(logo);
    if (!match) throw new Error('Logo-ul trebuie să fie PNG sau JPEG.');
    const bytes = Buffer.from(match[2], 'base64');
    const validHeader = match[1] === 'png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!validHeader || bytes.length > 1024 * 1024) throw new Error('Fișierul logo nu este valid.');
  }
  const values = [legalName, address, crn, issuer.vat_registered ? vat : null,
    bank1, account1, sort1, optionalText(input.bankName2, 'Banca secundară', 200),
    optionalText(input.accountNumber2, 'Contul secundar', 100), optionalText(input.sortCode2, 'Sort Code secundar', 50),
    optionalText(input.footer, 'Footer', 2000), color(input.color), color(input.alternateRowColor), opacity, id];
  return connection.transaction(() => {
    connection.prepare(`UPDATE billing_issuers SET legal_name=?, address=?, company_number=?, vat_number=?,
      bank_name_1=?, account_number_1=?, sort_code_1=?, bank_name_2=?, account_number_2=?, sort_code_2=?,
      footer=?, color=?, alternate_row_color=?, alternate_row_opacity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...values);
    connection.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('invoice_logo', logo);
    connection.prepare("INSERT INTO billing_audit_events (event_type, issuer_id, details) VALUES ('shared_issuer_settings_updated', ?, ?)")
      .run(id, JSON.stringify({ numberingChanged: false }));
    return { success: true };
  })();
}

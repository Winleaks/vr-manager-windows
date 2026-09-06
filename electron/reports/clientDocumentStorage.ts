import path from 'node:path';

export type ClientFinancialDocumentKind = 'Facturi' | 'Credit Notes';

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const FORBIDDEN_FOLDER_CHARACTERS = /[<>:"/\\|?*\p{Cc}]/gu;

/**
 * Company names originate in SQLite, but still must not be allowed to become
 * arbitrary local/Drive paths. The visible legal name is retained where safe.
 */
export function clientDocumentFolderName(value: unknown) {
  if (typeof value !== 'string') throw new Error('Numele clientului este invalid.');
  let name = value
    .normalize('NFC')
    .replace(FORBIDDEN_FOLDER_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  if (!name) throw new Error('Numele clientului nu poate fi folosit pentru folderul documentelor.');
  if (WINDOWS_RESERVED_NAME.test(name)) name = `${name} Client`;
  name = Array.from(name).slice(0, 60).join('').replace(/[. ]+$/g, '');
  if (!name) throw new Error('Numele clientului nu poate fi folosit pentru folderul documentelor.');
  return name;
}

export function localClientDocumentDirectory(
  documentsPath: string,
  companyName: unknown,
  kind: ClientFinancialDocumentKind,
) {
  return path.join(
    documentsPath,
    'VR - Hub Management',
    'Clienti',
    clientDocumentFolderName(companyName),
    kind,
  );
}

export function normalCloudDocumentFolders(
  companyName: unknown,
  kind: ClientFinancialDocumentKind,
) {
  return ['Facturi', clientDocumentFolderName(companyName), kind];
}

export function protectedCloudDocumentFolders(
  companyName: unknown,
  kind: ClientFinancialDocumentKind,
) {
  return ['Duplicat', clientDocumentFolderName(companyName), kind];
}

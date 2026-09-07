import { validatePdfFilename } from '../security/fileValidation.ts';

export function legacyInvoiceFilenames(number: string, series: string) {
  // Historical desktop versions used both a complete number and a separate series.
  return [...new Set([
    `Factura_${number}.pdf`,
    `Factura_${series}_${number}.pdf`,
    `Factura_${series}-${number}.pdf`,
  ])].flatMap(name => {
    try { return [validatePdfFilename(name)]; } catch { return []; }
  });
}

export async function resolveExistingInvoiceFolder(drive: any, configuredId?: string) {
  if (configuredId) {
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(configuredId)) throw new Error('ID-ul folderului de facturi este invalid.');
    const { data } = await drive.files.get({ fileId: configuredId, fields: 'id,mimeType,trashed', supportsAllDrives: true });
    if (data.trashed || data.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Folderul de facturi nu mai este disponibil.');
    return configuredId;
  }
  const roots = await drive.files.list({
    q: "(name='VR - Management' or name='VR - Hub Management') and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id),nextPageToken', pageSize: 100,
  });
  if (roots.data.nextPageToken) throw new Error('Selectează explicit folderul de facturi.');
  const candidates = new Set<string>();
  for (const root of roots.data.files || []) {
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(root.id || '')) throw new Error('Folderul Drive este invalid.');
    const folders = await drive.files.list({q:`name='Facturi' and '${root.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,fields:'files(id),nextPageToken',pageSize:100});
    if (folders.data.nextPageToken) throw new Error('Selectează explicit folderul de facturi.');
    for (const folder of folders.data.files || []) if (/^[A-Za-z0-9_-]{10,200}$/.test(folder.id || '')) candidates.add(folder.id);
  }
  if (candidates.size !== 1) throw new Error('Folderul de facturi lipsește sau este ambiguu. Configurează ID-ul folderului existent.');
  return [...candidates][0];
}

// Resolve the existing desktop layout: Facturi / company / Facturi.
// Duplicate names fail closed; the folder is document organization, never client authorization.
export async function resolveCompanyInvoiceFolder(drive: any, rootId: string, companyName: string) {
  const { clientDocumentFolderName } = await import('../reports/clientDocumentStorage.ts');
  let parent = rootId;
  for (const name of [clientDocumentFolderName(companyName), 'Facturi']) {
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const result = await drive.files.list({q:`name='${escaped}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,fields:'files(id),nextPageToken',pageSize:2});
    const matches = result.data.files || [];
    if(matches.length > 1 || result.data.nextPageToken) throw new Error('Folderele clientului sunt ambigue.');
    const folder = matches[0] || (await drive.files.create({requestBody:{name,mimeType:'application/vnd.google-apps.folder',parents:[parent]},fields:'id'})).data;
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(folder.id || '')) throw new Error('Folderul clientului este invalid.');
    parent=folder.id;
  }
  return parent;
}

export async function listInvoiceTree(drive: any, rootId: string) {
  const result: {id:string;name:string}[]=[];
  const queue=[{id:rootId,depth:0}], seen=new Set<string>();
  let requests=0;
  while(queue.length) {
    const folder=queue.shift()!;
    if(seen.has(folder.id)) continue;
    seen.add(folder.id);
    let pageToken: string|undefined;
    do {
      if(++requests>1000) throw new Error('Prea multe documente pentru asocierea automată.');
      const res=await drive.files.list({q:`'${folder.id}' in parents and trashed=false and (mimeType='application/pdf' or mimeType='application/vnd.google-apps.folder')`,fields:'files(id,name,mimeType),nextPageToken',pageSize:1000,pageToken});
      for(const file of res.data.files || []) {
        if(!/^[A-Za-z0-9_-]{10,200}$/.test(file.id || '') || !file.name) continue;
        if(file.mimeType==='application/vnd.google-apps.folder') {
          if(folder.depth>=6) throw new Error('Structura folderelor depășește limita de verificare.');
          queue.push({id:file.id,depth:folder.depth+1});
        } else result.push({id:file.id,name:file.name});
      }
      pageToken=res.data.nextPageToken || undefined;
    } while(pageToken);
  }
  return result;
}

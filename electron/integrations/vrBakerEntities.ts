import type { VrBakerCompany, VrBakerStore } from './vrBakerApiClient';

// Resolve source identities before any local writes. Names are not unique keys.
export function resolveVrBakerEntities(companies: VrBakerCompany[], stores: VrBakerStore[]) {
  if (new Set(companies.map(row => row.id.toLowerCase())).size !== companies.length) throw new Error('ID-uri duplicate de companii VR Baker.');
  const byId = new Map(companies.map(company => [company.id.toLowerCase(), company]));
  for (const store of stores) {
    if (store.company && !byId.has(store.company.id.toLowerCase())) {
      byId.set(store.company.id.toLowerCase(), store.company);
    }
  }
  const resolvedStores = stores.map(store => {
    const companyId = store.companyId ?? store.company?.id;
    if (store.company && companyId?.toLowerCase() !== store.company.id.toLowerCase()) {
      throw new Error(`Asocierea companiei magazinului „${store.name}” este inconsistentă.`);
    }
    const company = companyId ? byId.get(companyId.toLowerCase()) : null;
    if (companyId && !company) {
      throw new Error(`Compania magazinului „${store.name}” lipsește din răspunsul VR Baker. Sincronizarea a fost anulată; reîncercați după verificarea asocierii în platformă.`);
    }
    return { ...store, company: company ?? null };
  });
  return { companies: [...byId.values()], stores: resolvedStores };
}

interface SearchableCompany {
  name: string;
  stores: Array<{ name: string }>;
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('ro-RO').trim();

export function matchesProtectedCompany(company: SearchableCompany, query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const text = normalize([company.name, ...company.stores.map(store => store.name)].join(' '));
  return terms.every(term => text.includes(term));
}

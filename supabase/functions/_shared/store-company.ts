import { ExternalApiRequestError, requireUuid } from "./external-api-security.ts";

const companyColumns = "id, name, address, vat_number, registration_number";
// Both joins are left joins. Inactive/unactivated owners still establish identity.
export const storeCompanyColumns = `client_company_id, client_company:client_company_id(${companyColumns}), owner_id, company_owner:profiles!client_store_owner_id_fkey(id, client_company_id, client_company:client_company_id(${companyColumns}))`;

function associationError(): never {
  throw new ExternalApiRequestError(409, "store_company_conflict", "Store company association is missing or inconsistent; verify the platform mapping");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) associationError();
  return value as Record<string, unknown>;
}

function optionalId(value: unknown): string | null {
  return value == null ? null : requireUuid(value, "company association").toLowerCase();
}

function relatedCompany(idValue: unknown, value: unknown): Record<string, unknown> | null {
  const id = optionalId(idValue);
  if (!id) {
    if (value != null) associationError();
    return null;
  }
  const company = record(value);
  if (optionalId(company.id) !== id) associationError();
  return company;
}

// Resolve only authoritative foreign keys, never names, login status or caller data.
// Keep the existing wire fields so installed Hub versions understand owner links too.
export function resolveStoreCompany(value: unknown): Record<string, unknown> {
  const store = record(value);
  const direct = relatedCompany(store.client_company_id, store.client_company);
  const ownerId = optionalId(store.owner_id);
  const owner = store.company_owner == null ? null : record(store.company_owner);
  if ((ownerId !== null) !== (owner !== null) || (owner && optionalId(owner.id) !== ownerId)) associationError();
  const inherited = owner ? relatedCompany(owner.client_company_id, owner.client_company) : null;
  if (direct && inherited && optionalId(direct.id) !== optionalId(inherited.id)) associationError();
  const company = direct ?? inherited;
  const result: Record<string, unknown> = { ...store, client_company_id: company?.id ?? null, client_company: company };
  // The scoped company/store export must not expose the joined owner profile.
  delete result.company_owner;
  return result;
}

# VR - Hub Management credential rollout

The deployed function intentionally keeps `verify_jwt=false` because it performs its own `X-API-Key` authentication. Keep the server-side kill switch.

Configure Supabase Edge Function secrets outside source control:

- `EXTERNAL_API_ENABLED=true` only for the controlled rollout window;
- add credential id `vr-hub-management-writer` to `EXTERNAL_API_CREDENTIALS`;
- store only the lowercase SHA-256 hash of a cryptographically random token;
- scopes: `health:read`, `orders:read`, `companies:read`, `stores:read`, `products:read`;
- set an explicit expiry and bounded `rate_limit_per_minute`;
- never add `orders:write` to the desktop credential.

During rotation, add the new hashed credential, verify it from the Writer, then disable the old credential. Paste the raw token only into the desktop settings screen; Electron stores it through `safeStorage`. Do not put the raw token in this repository, SQLite, logs, tickets, or chat.

Before enabling invoice emission, compare a Monday–Sunday preview against SQL aggregates for order count, non-zero line count, and snapshot-price total. The current desktop contract imports only `open` and `locked`; `delivered` stays reserved for the future driver application and `cancelled` is excluded.

## Store/company association compatibility

Both `stores.list` (legacy array and counted envelope) and `orders.weekly_export`
resolve the company from the direct store foreign key, or, when absent, from
`client_store.owner_id -> profiles.client_company_id`. No name matching or
active/login filter is used. Contradictory direct/owner companies or broken joins
fail closed. Joined owner profiles are removed from the export. The existing
`client_company_id` and `client_company` response fields contain the resolved
identity, so Hub 0.1.100 can consume the correction without a new installer.

The accompanying `billing_owner_company_association` migration updates only the
association predicate in the existing `billing_commit`. Apply it after the
platform billing publication/credit-settlement migrations, before publishing this
API. Its drift guard aborts if the current predicate differs; it does not overwrite
newer function logic. It leaves store/profile records, financial data, credentials,
function privileges, RLS and feature flags unchanged. Reapplying is idempotent.

Validate SQL using `supabase/tests/billing-owner-association.sql` after the existing
platform billing fixtures/migrations and this migration, in an isolated PostgreSQL
database only. Re-run the existing platform billing/credit/RLS tests as well.
On Writer, sync entities first, inspect any historical mapping conflict, then retry
publication. Existing invoiced stores cannot silently move from another company
(including a former unassigned placeholder); such cases require explicit reviewed
history reconciliation. The API never backfills or guesses the remaining unlinked
stores. Keep client billing visibility disabled until operational reconciliation.

Recovery: retain original function definition/privileges before deployment. Prefer
a compatible forward fix. Restoring the previous direct-only predicate/API would
again hide owner-linked stores and reject their invoice publication; do not erase
stored invoices, reassign stores, downgrade the desktop or alter flags as rollback.

## Approved store merges

Apply `hub_store_merges` before deploying this API. The counted `stores.list`
envelope additionally returns `merges` and `merges_complete`; legacy array callers
are unchanged. Only service-side reads can access the merge ledger. Operational
merges require explicit approval, exact IDs, backup, dependency/period conflict
checks and a single transaction; this API cannot create a merge.

The updated Writer asks for confirmation and creates a fresh verified backup
before moving unpaid placeholder history to a verified company or canonical
store. It retains local tombstones, invoice numbers, line items, issuer identities
and source-order IDs. Duplicate billed periods and payment/credit conflicts fail
closed. A later source revision remains a manual review, never automatic rebilling.
Older installed Writers retain their conflict/duplicate guards but cannot perform
this repair. Do not replace a current Writer database with an old support backup.

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

Before enabling invoice emission, compare a Monday–Sunday preview against SQL aggregates for order count, non-zero line count, and snapshot-price total. Updated Hubs send `include_delivered: true` and require `includes_delivered: true` on every response page. These requests import `open`, `locked` and `delivered`; legacy callers retain `open`/`locked`. `cancelled` remains excluded. Deploy the compatible API before releasing the updated Hub; an updated Hub talking to the old API refuses incomplete imports.

The billed quantity is `qty_delivered ?? qty_ordered`, regardless of whether an admin or driver changed it. Explicit zero means no billable units, never fallback to the ordered quantity. Prices remain `unit_price_snapshot`. Confirmation actor and app activation date are not filters. Existing invoices are not rewritten: a later source change requires explicit reviewed correction, retaining original source-order identities and duplicate guards. No driver application, permissions, schema or live order changes are needed for this correction.

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

## Driver cash protocol v2

Deploy `driver_cash_pending_v2` and `driver_cash_association_retry_continuity`
before this API, then release the updated Hub.
`driver.cash.pending` and `driver.cash.ack` accept optional `protocol_version: 2`;
missing/1 preserves legacy behavior. The Writer guard and billing write scope
remain required. The cash reader resolves direct and owner company foreign keys
using the same rules as the entity export. Null receipt associations are filled
from verified IDs with an `ASSOCIATED` event; financial revisions/states are not
reset by the reader. Contradictory relations stay blocked.

V2 omits zero-only initial history from the financial queue. The first positive
revision includes a bounded, original-ID `zero_prefix`. Hub imports this metadata
transactionally only alongside that positive revision, without payments, cash or
individual server acknowledgments for the zeros. V2 acknowledgments can bypass
only a verified complete zero-only predecessor chain. Zero cancellations after
any positive revision remain queued. Delivery receipts, correction deadlines and
standalone driver receipts are unchanged; no Android update is needed.

Scoped `stores.list` exports accept up to 50 exact `store_ids`, including only
merges targeting the selected stores. Cash imports these as partial snapshots,
never inferring absence of unrelated companies/stores. A conflicting local
historical association blocks that store without moving its invoices.

Missing-company recovery requires both the server's audited eligibility and a
fresh matching local store/company/issuer. Existing payments, cash allocations,
processing journals or changed canonical requests prevent automatic retry.
The durable retry intent also handles an interrupted or already accepted retry.
Financial conflicts and server-processed receipts absent locally fail closed for
reconciliation. The separate register's existing encrypted outbox and backup
remain authoritative; no decrypted allocations enter normal SQLite/UI.

Validation: run `python3 supabase/tests/driver_cash_pending_v2_test.py <port>
--disposable` against a disposable local PostgreSQL instance, plus Hub tests,
type checks and Windows release checks. Keep incident exports outside this public
repository. Reconcile actual Writer cash, register allocations/credit and portal
publication per root after installation; server acknowledgment alone is not proof
of client balance publication. Retain the additive v2 functions on rollback; stop
affected synchronization rather than restoring an old database over new cash.

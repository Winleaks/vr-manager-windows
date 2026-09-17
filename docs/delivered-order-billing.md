# Delivered-order billing correction

## Contract

- Platform orders and order items remain authoritative for delivery quantities, whether changed by an admin or driver. No actor or driver-app activation-date filter.
- Import `open`, `locked` and `delivered`; never import cancelled orders. The billable quantity remains `qty_delivered ?? qty_ordered`. Explicit zero is omitted, not replaced with the ordered quantity. Snapshot prices remain unchanged.
- Both normal and protected billing share the corrected API parser and weekly aggregation. Existing issued invoices remain immutable automatically; source fingerprints and original order IDs continue to drive manual conflict review and duplicate prevention.

## Compatible deployment

1. Verify the current deployed external-api source and preserve any newer unrelated changes before deployment. Patch the weekly export only; do not replace it with a stale platform checkout.
2. Deploy the API correction first. Legacy clients omit `include_delivered` and retain their existing open/locked export. New clients send true; responses echo `includes_delivered: true` on every page.
3. Release the updated Windows Hub separately after authorization. The new client refuses exports without this acknowledgement, rather than silently dropping delivered orders when connected to an old API.
4. Verify updated Writer preview against platform quantities and totals before issuance. Existing invoices needing correction require a separate reviewed action, not automatic rewriting or rebilling.

No database migration, RLS/auth change, credential change, driver-app release, customer data mutation or invoice rewrite is part of this patch. Rolling back the API alone while updated Hubs are installed will safely block their imports; prefer a compatible forward fix.

## Verification

- Actual API handler executed with a synthetic read-only query adapter, then consumed by the actual Hub parser and aggregator.
- Three products ordered 2 each and delivered 1 each retain snapshot prices and produce 385 pence total; driver/admin/unset actor cases are identical.
- Legacy clients, open/locked fallback, explicit zero, null quantity, cancelled exclusion, pagination, source fingerprint changes and missing capability rejection covered.
- 344 Node tests pass; TypeScript, scoped lint, renderer/main/preload build and diff checks pass.
- No production deployment or installed Windows/live integration smoke test performed yet.

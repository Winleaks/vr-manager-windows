# Billing inputs, store invoices and production variants

## Implemented

- Manual invoice drafts retain string quantities/prices, including empty and trailing-decimal states. Numeric conversion is restricted to calculations and the validated IPC payload. Blank prices are rejected rather than silently becoming zero.
- Existing normal and protected invoice editors already retain string drafts. Browser regressions now exercise partial deletion (`1.95` → `1.` → `1.85`) on both paths, as well as the corrected manual form.
- Normal billing company profiles expose keyboard-accessible store cards and an explicit all-stores/store invoice filter. It intersects with the issuer filter and is remembered per company in navigation memory. Invoice totals follow the selected store; available credit and payment history remain explicitly company-wide. No financial allocation is changed.
- Production and finished-product repository reads retain `variant_label` and append it to displayed English/Romanian names without duplicating an embedded label. Legacy products without a cloud match retain their names. Product IDs, recipes, stock and financial history are unchanged.

## Approved billing visibility projection

The user explicitly approved a local/replicated normal-billing visibility marker, including Viewer/offline use. Migration 21 adds only company ID/hidden metadata and a verification-ready flag. Protected documents, assignments' keys/names, financial contents and encryption keys remain in the encrypted vault; no protected financial database is copied into SQLite.

Normal billing reads use a read-only SQL projection over unchanged authoritative rows. Company/client/store lists, profiles, invoice/credit-note reads, payment reports, statements, historical/period statistics, publication status and document queues share that scope. Direct reads and financial mutations by hidden IDs fail. The protected assignment UI retains an internal raw accessor, never exposed through preload. Production/catalog reads are not filtered.

Writer initializes the marker from a verified encrypted routing manifest on first billing use (also checked by background publication/document workers). Subsequent reads use the local snapshot offline. Assignment changes invalidate visibility before the cloud commit and replace markers inside the serialized commit/replay callback; interrupted changes remain fail-closed until verified. The existing SQLite backup/Drive replica carries the markers to Viewers without granting vault access. Update Writer first, let it verify/synchronize its database, then update/synchronize Viewers. An old or unverified replica shows an explicit error instead of guessing visibility. An offline Viewer sees its last verified replica, not changes made since its last sync.

Assignment removal restores normal visibility without moving, deleting or duplicating invoice history. Already-published platform history and existing Drive files are not deleted by this change. Rolling back to an older application removes the new visibility enforcement; do not downgrade clients while relying on this privacy behavior.

## Verification

- TypeScript project build and renderer/main/preload Vite builds pass.
- Full Node suite passes (357 tests), including visibility migration/rollback, real repository aggregates/direct-ID denial, serialized cloud assignment/replay and offline Viewer boundaries. Scoped lint and diff whitespace checks pass.
- Synthetic SQLite tests execute the real product/production repository queries, distinguishing packed/unpacked variants and preserving stock and legacy names.
- Synthetic Chromium regressions cover store keyboard selection, cross-store filtering/reset, numeric editing, existing navigation memory, protected access and Viewer restrictions.
- No production database, cloud vault, API, release or installer has been changed. Windows runtime acceptance remains untested on this Mac.

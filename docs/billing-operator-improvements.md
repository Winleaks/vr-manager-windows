# Billing operator improvements

This change is local Hub work, not a platform or client-account deployment. Credit Note editing remains excluded.

## Behaviour

- Statement actions live in the company profile on Writer. Select one issuer and an inclusive date range; open, print or share the locally generated PDF. No statement is uploaded or exposed in the client account.
- Statement opening and closing balances use current ledger records dated before/within the period: active invoices debit, issued Credit Notes and payments credit. Migrated legacy credit is an explicitly disclosed opening adjustment because its original transaction date is unavailable. Applied credit is not subtracted twice. Cancelled documents are excluded. This is not an immutable historical audit snapshot.
- Invoice PDFs generated from the normal authoritative invoice include a separate outstanding-invoices appendix. Following the operator correction, it includes only the invoice's store, company and issuer, excludes cancelled/settled invoices, and uses cash payments, issued CN and applied credit to calculate remaining amounts. The current invoice appears once if outstanding. The heading identifies the store and its balance. Company statements and dashboard totals are unchanged. Existing PDFs acquire the correction when regenerated; no bulk rewrite of stored documents is performed. No due dates are invented: the Hub currently has no authoritative due-date field for this report.
- Payment reporting uses payment date, not invoice date. HSBC is an additional transfer-bank label, with no bank connection.
- Payment date corrections preserve allocations and retain before/after dates and reason in the existing audit log. Financial changes keep their existing credit-consumption restrictions.
- The dashboard defaults to the complete current calendar month for issuance, payments and CN. Operators can switch to a Monday–Sunday week picker with previous/next/current-week navigation, or all history. Its outstanding card is explicitly labelled current balance across all history, not historical closing balance.
- Other cash sources use a distinct `other_collection` receipt category and the existing reference-name field, with no fake driver or schema migration. The receipts screen includes both kinds.
- Removing a saved imported line requires an explicit zero-quantity removal. Source order/batch links are kept and the edit audit retains before/after lines; deleting every line and reducing below paid value are denied.
- Search includes store names in company selection, invoices, orders, CN and payment reporting. The existing catalogue display order and customer-specific invoice-editor pricing are preserved.

## Verification and release limits

No production data or platform files were changed. No schema migration is needed. PDF generation was visually checked with synthetic 45-row multipage statements and invoice appendices. All 275 Node regression tests and the local renderer/main/preload build pass.

The isolated browser fixture now renders after being built and served as a static preview. With mocked IPC and synthetic data, interactive checks passed for payment search by store, the empty-results state, clearing/retyping invoice quantity and price, filtering/adding a catalogue product, and removing an imported position after setting its quantity to zero. The weekly dashboard and Statement controls render. These checks do not exercise real database writes or customer-specific pricing retrieval. The browser automation did not successfully populate the native Statement date controls, so Statement action execution was not verified interactively.

Windows installed-app checks remain necessary for the remaining input workflows, native print preview, WhatsApp attachment and preservation of legacy/local invoice updates. Do not release based solely on the local build or mocked browser checks.

## v0.1.104 release authorization

### Follow-up v0.1.105

The operator authorized publication of the subsequent manual-invoice layout/search, store-scoped PDF balance, payment-history design/navigation, and dashboard period corrections. Source is based on published 71e071b (v0.1.104); no schema or platform change. Reuse the same Windows x64 NSIS stable workflow and recovery boundaries below. Synthetic browser checks cover company/store search and keyboard selection, catalogue addition at 998/640px, payment search/navigation at 1280/998px, dashboard current-month default and calendar week selection. Regression fixtures cover sibling-store separation, settled/cancelled invoices and month/year/leap-year period boundaries. Installed Writer upgrade and actual updated PDF acceptance remain user checks; old PDFs are not rewritten in bulk. Existing release artifacts remain available; prefer a forward correction if the operator reports wrong totals or startup failures, without restoring old data over new transactions.

The user explicitly authorized publishing the Windows updater release to install and test on Windows. It builds on published v0.1.103 (b361cf8), preserving that release and the main-branch ancestry. Only scoped Hub changes, package version/lockfile and release notes are included; unrelated local files are excluded. The existing GitHub Windows x64 NSIS workflow performs a clean dependency install, tests, lint, type checking, native PDF rendering verification and packaging before publishing the installer, blockmap and latest.yml. This uses the existing public stable update feed, not an isolated beta channel.

No live data migration or platform deployment is part of this release. Windows installed upgrade, actual printer and WhatsApp delivery remain operator acceptance tests. Back up the Writer database before testing edits. Stop testing on incorrect totals, lost records, duplicate documents, startup or update failures. Keep v0.1.103 artifacts available for recovery; installed updates cannot be recalled. Any feed containment or corrective release requires a separate explicit action; do not restore an old database over new transactions. The new other_collection category is not fully represented by older UI, so prefer a forward fix after new receipts are recorded.

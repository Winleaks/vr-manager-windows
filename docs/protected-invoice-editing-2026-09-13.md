# Separate-register invoice workflow alignment

Local implementation, not published. No live records, credentials, Drive documents or update feed were changed.

## Delivered scope

- Reuse the normal `InvoiceEditorModal` through a protected adapter. Only the protected IPC reads/writes the invoice; normal financial APIs and local PDF storage are not invoked by this adapter.
- Edit issue date, quantities, unit prices and manual line names; add catalog products with the same verified VR Baker tariffs/unknown-price handling as the normal editor. Imported row IDs and order provenance survive; imported removal must be explicit.
- Preserve invoice reference, issuer snapshot, customer/store, existing cash payments, source orders and independent counters. Block cancelled/replaced invoices, issued Credit Notes, applied credits and totals below retained cash. No automatic payment reallocation.
- Invoice list has search, issuer/status/date filters, balances, icon-only document/edit/issuer/payment/credit-note/cancel actions, and recovery/empty states. Payment and Credit Note shortcuts select their source invoice. Existing deletion/reissue restrictions remain.
- Print for protected invoices and Credit Notes uses the existing native Windows document helper. Existing temporary plaintext document policy is unchanged; no new persistent local database, disk cache or browser storage is introduced.
- Manual invoice uses company/store search without a second company dropdown, product search plus an explicit add icon, editable numbers, and document actions after issuance. Sidebar sizing/order and dashboard icons follow the existing billing style.
- Settings reuse the normal issuer form in a restricted shared-configuration scope: legal/bank details, logo and PDF appearance. Normal test mode, invoice/Credit Note numbering, issuer activation, platform credentials and publication controls are absent. Protected mode/counters/PIN remain their existing independent controls. The common issuer configuration remains in its existing normal Hub settings store; no private financial information is passed to it.
- A narrow Writer-only IPC saves allowlisted common settings, logo and audit atomically. Neither normal nor protected counters/series can be supplied through this operation. Failed saves keep the form draft; a failed read shows an error with retry instead of an endless spinner. An explanatory notice makes the shared effect explicit; historical issuer snapshots are unchanged (the logo remains global).

## Integrity and recovery

The editor reads current authoritative Drive state and gets a SHA-256 invoice version. Saving rechecks that version inside the existing serialized encrypted-vault mutation. An audit entry records before/after rows and a normalized request hash. Retrying the same operation returns the existing result; reuse with different data is rejected. No invoice sequence is consumed by an edit.

Persistence keeps the existing pending/vault/manifest protocol. A PDF failure after the cloud commit reports a saved invoice with a document retry, not a failed financial transaction. Invoice open/share/print regenerates from the latest authoritative vault before reading the PDF, so a failed refresh cannot silently deliver the previous PDF. Regeneration shares the mutation lock. Writer and session checks run after awaited work; a lock during transfer preparation cannot recreate a plaintext file or return edited records to the expired session.

## Verification

- Full suite: 319 tests passed, including new domain/service tests for manual/imported invoices, both issuers, stale/concurrent edits, foreign rows, invalid amounts/dates, idempotency, failed cloud commit recovery, PDF failure, locked/Viewer denial and cancelled print handling. Four additional settings tests cover numbering preservation, narrow payloads, atomic rollback, validation and Viewer denial.
- TypeScript, scoped lint and renderer/main/preload production build pass. Existing module-type/chunk/dynamic-import warnings remain.
- Synthetic browser: list and shared editor at wide/1000px/640px widths; quantity/price replacement; catalog search/add; dirty issuer guard; simulated failed save retains draft; retry retains the same operation ID; successful save closes editor; cancelled print has no error. Manual company lookup by store name, explicit product add and responsive layout checked. Browser localStorage/sessionStorage remain empty. No browser errors observed.
- Shared settings browser checks at 1280px and 640px: common fields visible, normal numbering/publication controls absent, failed save retains draft, retry succeeds with only allowlisted fields, failed load exposes retry. Document width stays at 640px with no horizontal overflow; browser storage stays empty.
- No installed-Windows test, physical printer/WhatsApp test or live Drive latency measurement was performed. The separate register remains cloud-dependent.

## Scope boundaries

Issuer/bank/PDF settings remain shared as announced when continuing the work; no cloud-only overrides were introduced. Protected series remain independent. This change does not claim complete parity for every normal billing feature (such as global platform publication, local sync settings, payment-bank reporting or dashboard period reports), which cannot simply be copied into the private register. The previously reported normal-register EBUSY/OneDrive document issue is outside this change.

Rollback: revert the scoped UI/adapter and protected edit/document handlers while preserving vault data and audit entries. No schema migration or data restoration is required. Do not roll back the authoritative vault over subsequent financial operations. Publication requires a separate user instruction.

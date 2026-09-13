# Separate register: layout and cloud-only performance

Implemented locally, not published. No production data, Drive documents, credentials or schema were changed.

## Confirmed mechanisms

- The protected register already keeps its working vault in session memory; reads for lists/overview use that memory. Mutations reconcile and confirm the authoritative encrypted vault in Drive before updating the session.
- Each private file read/write previously resolved the same root and register folders again. Private writes also looked up the target twice, once to check its version and once to upload.
- The payments panel reloaded five datasets on each company selection because the reload callback depended on the selected company.
- Fixed-width product grids, missing minimum-width constraints and unstyled numeric inputs caused inconsistent layout and overflow pressure.

## Changes and invariants

- An awaited private mutation now has an operation-scoped, account-keyed map of folder IDs. It is held only in RAM and cleared in `finally`; missing/failed resolutions are not retained. A new operation resolves the folder again. No vault data, tokens, file contents or queued writes are cached by this map.
- A private write checks `expectedVersion` against the same fresh file lookup used for upload. The duplicate lookup is removed, not the version check. Duplicate-file detection, canonical-folder scoping, Writer checks, size/checksum verification and pending/vault/manifest ordering are retained.
- No optimistic success, local database, browser storage, disk cache or offline queue was added. Existing PIN/key storage and explicitly supported temporary print/share files are unchanged; these changes introduce no additional local persistence.
- A completed cloud mutation cannot restore a session that was locked or replaced during the operation. The cloud commit remains recoverable on unlock.
- Payments reload no longer depends on the selected company.
- Scoped slate/indigo/Inter styles, consistent section icons, responsive product grids and navigation, labeled numeric inputs, visible manual-invoice total, invoice status badges and icon-only document actions align the separate register with normal billing. The input dialog uses native modal focus handling and Escape cancellation.
- While a mutation is pending, a visible cloud verification status and a synchronous action guard prevent duplicate clicks. Inputs/navigation are disabled until completion; locking remains available.

## Verification

- Real adapter fixture: eight file operations resolve root/register folders with **2 requests instead of 16**, and perform **8 file lookups instead of 11** for five reads and three writes. File content/version/checksum reads are still fresh. This is a request-count measurement, not a production latency percentage.
- Tests cover scope lifetime, parallel folder resolution, missing/error results, account isolation, stale version, checksum failure, Viewer denial, lock during commit, retry/recovery and normal Drive upload regressions.
- Full suite: 304 tests passed; TypeScript, targeted lint, whitespace checks and renderer/main/preload build passed. Existing bundle warnings remain.
- Synthetic browser fixture: responsive views at 1280, 1000 and 640px; editable quantity/price; slow-save busy state and a single mutation call; empty localStorage/sessionStorage; modal focus, Escape and focus restoration; no browser errors observed.
- Windows-installed application, real cloud latency, print/share and provider concurrency were not exercised. Release remains separate and requires authorization. No change to the existing single-Writer model or cross-process Drive concurrency guarantees is claimed.

Provider reference checked 2026-09-13: [Drive v3 files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list) and [files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get). No OAuth scope or API version changes.

Rollback: revert only the scoped layout/action-state and cloud folder-resolution changes. No data migration is needed; preserve pending issuer-change, product-catalog and English-PDF work. Before release, validate on the Writer with a reversible test operation and compare cloud-confirmed latency.

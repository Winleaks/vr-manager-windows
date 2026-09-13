# Approved invoice balance layout

Implemented locally after layout approval; not published. No production invoices, vaults or Drive files were changed.

## Contract

- Shared normal/protected PDF generator displays current store account balance at the top right when authoritative account data is supplied, including the current invoice's unpaid amount.
- Outstanding table follows the invoice total on the same page when its heading/header/first row fit. Long lists repeat column headers, keep rows intact and render one final total. Numeric headings/cells are centered; product descriptions remain left-aligned. Yellow headers use dark text, dark issuer colors use white text.
- Existing invoice items, prices, references and issuer snapshots are unchanged. No new sequence allocation, schema migration or financial mutation.
- Protected generation receives the committed vault (or freshly loaded vault for document refresh), never the normal database for balances. Filter by company, store identity, issuer and test/live flag. Ignore cancelled and fully settled invoices. Cash, credited invoice amount and non-reversed applied credit are subtracted using pennies. Unallocated company credit is not assigned to a store automatically.
- No persistent local private financial cache. Existing PDF delivery destinations and session/Writer gates remain unchanged.
- Applies on generation/regeneration. Existing exported/downloaded PDF copies are not rewritten proactively. This does not migrate old monthly archive copies.

## Verification

- 324 tests pass; TypeScript, scoped lint, renderer/main/preload build and diff checks pass.
- New tests: short/zero-balance pagination for both VAT modes, 80-row deterministic multipage generation, store/company/issuer/test isolation, cancelled/paid exclusion, cash/credit/reversal calculations, missing store identifiers and nonmutation.
- Production generator rendered the approved 22-product fixture into two A4 pages; outstanding begins on page 2, top balance matches final total. No preview-only annotation in production output.
- 80-row synthetic list verified on all four rasterized pages; extraction confirms all rows once, one final total, correct page numbers and no text outside page bounds.
- Installed Windows printer/WhatsApp and live cloud round-trip were not tested. Existing build warnings about chunk size/module type/dynamic imports remain.

Rollback: revert this layout and the protected balance adapter only; preserve all financial records and unrelated working changes. No data restoration is needed.

# English PDF exports — 2026-09-13

Implemented locally; not published.

- Credit Note labels, cancellation banner, explanation, totals and generated timestamp use English in both registers (shared renderer).
- Daily Cash headings, system categories, provisional/final status, empty states and page labels use English without changing the Romanian report snapshot used by the UI.
- Inventory and production PDF titles, column headings and generated status use English. The common table renderer embeds the existing Arial fonts to preserve accented business data. Excel exports and UI labels are unchanged.
- Invoice and statement labels were already English; the invoice's missing-unit fallback is now `pcs`.
- Product names (including existing bilingual names), supplied units, reasons, notes, company/store names and configured footers are preserved. There is no automatic translation of user data.
- No ledger changes, schema migration, permission changes or live-resource writes. Existing canonical billing/Drive paths are unchanged. Previously saved PDFs are not bulk-rewritten; a document must be generated again to receive the new template. Opening a cached Credit Note alone does not regenerate it.

Verification: 14 focused PDF tests passed, including four new Poppler text-extraction tests for VAT/non-VAT and cancelled multipage Credit Notes, Daily Cash categories/empty states, generic exports and statements. Full suite: 299 tests passed. TypeScript, targeted lint, diff whitespace check and Vite renderer/main/preload build passed (existing bundle warnings remain). Synthetic PDFs were rendered and visually checked: first/last pages of a four-page Credit Note, Daily Cash and inventory. No Windows installer, live print/share or production Drive test performed.

The text-extraction tests explicitly skip when Poppler is unavailable; install Poppler for equivalent verification in another environment. Rollback is limited to rendering/export changes; preserve the unrelated pending issuer-change and invoice-catalog fixes.

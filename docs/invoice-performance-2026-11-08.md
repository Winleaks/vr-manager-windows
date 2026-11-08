# Invoice freeze and performance correction

Baseline: Hub 0.1.144, commit 7254178. Reported whole-window freeze while opening invoices and focusing search. Source inspection confirmed unbounded synchronous document hydration in main and unbounded table rendering; this is a demonstrated cost, not a confirmed diagnosis on the affected workstation.

## Changes
A new trusted, Viewer-readable billing:getInvoicePage read returns at most 50 summaries and a matching count. Date, status, issuer, literal Unicode case-insensitive search and bounded page inputs are validated in main. Authorized normal-register projection and ordering are preserved. Full invoice and PDF paths retain their existing detail endpoint. No data/schema migration. Search is debounced 250 ms and request generations reject stale/unmounted responses. Errors provide retry. Reissue fetches only the new invoice.
Financial calculations share the original rounding formula; batches of 500 replace repeated reads for customer balances, profiles, outstanding reports and dashboard totals. Store/credit grouping avoids repeated company scans. Profiles batch item reads while preserving per-invoice order. Export libraries load on demand.

## Evidence
Synthetic SQLite dataset: 10,000 invoices. Focused invoice read 570 ms before / 28 ms after; complete-suite measurement 1,943 / 36 ms under concurrent test load. Financial batch comparison 214 / 14 ms with every returned balance compared. The event-loop timer lag follows synchronous operation duration; this is not a measurement on the user's Windows computer.
Initial renderer JS 4,279 kB to 3,348 kB; 930 kB Excel chunk deferred. Browser tests cover immediate search during load, 50-row paging, stale replies, error/retry and Excel/PDF output signatures. Visibility/negative parameter/credit/reversal/cancellation tests and complete regression suite are required.

## Release and rollback
Prepare 0.1.145 using the existing Windows CI pipeline. No production migration or financial mutation. Prior 0.1.144 installer is rollback-compatible because storage is unchanged; preserve the normal backup practice. Do not interrupt in-flight transfers. Interactive Windows clean install, update with a real database, and confirmation of incident recovery on the affected workstation remain outstanding. Local timings do not prove all possible freezes are fixed.

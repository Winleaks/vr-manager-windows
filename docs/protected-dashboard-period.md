# Protected dashboard date filter

- Uses the same BillingPeriodFilter as the normal billing dashboard: current month by default, a selectable Monday–Sunday week, and all history. The normal dashboard's existing behavior is preserved.
- Invoice count and gross total use invoiceDate, Credit Notes use issueDate, receipts use paymentDate, with inclusive calendar boundaries. Cancelled invoices/notes and reversed payments are excluded.
- Outstanding amounts and available credit are current all-history balances, explicitly labelled, not historical snapshots. Issuer cards follow the same rules. Assigned-company count and counters remain global.
- The main process validates complete, ordered, real ISO date ranges after checking the unlocked protected session. Existing no-argument overview calls continue to return all history. Role allowlists are unchanged; no new Viewer mutation is exposed.
- Aggregation reads only the in-memory protected vault, makes no cloud writes and changes no financial data, schema or credentials. Money is summed in pennies. Filter preferences remain in session memory and are discarded on registry lock.
- UI hides previous totals for a newly selected or failed range and ignores late responses. The filter remains usable while loading or after an error.
- Verification: date-range/aggregation/authorization tests, full Node regression suite, TypeScript, scoped lint, production renderer/main/preload build, and synthetic browser tests covering keyboard navigation, previous/current weeks, all history, retained selection, delayed/error responses and session clearing. No live financial data or production services are used. Windows packaging/publication and real-device acceptance are separate release steps.

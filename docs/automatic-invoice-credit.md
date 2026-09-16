# Automatic credit on new invoice issuance

New normal and protected invoices consume available credit for the same company and issuer, oldest entries first, capped at the invoice outstanding amount. Protected test/live credit is also isolated. Gross totals, product prices and cash receipts remain unchanged. Existing application ledgers record the allocation and support explicit reversal. No new IPC capability or schema migration is introduced.

Normal creation applies credit inside the invoice SQLite transaction. Manual issuance delegates to this path; weekly import and replacement issuance call the same internal hook. Legacy schemas without a credit ledger retain their previous behavior. The hook requires an active transaction.

Protected creation updates only the candidate vault inside the existing Writer-only atomic cloud mutation. Manual, weekly and replacement invoices use the hook; operation replay and pending-write recovery retain the committed application. No decrypted vault is saved locally. Cancellation now also rejects invoices with active applied credit, matching the normal register.

Existing invoices are not swept or automatically changed on editing, viewing or synchronization. An invoice with applied credit remains subject to existing edit/issuer-change restrictions; reverse the application explicitly before making such corrections. No credit crosses register boundaries.

Verification uses synthetic in-memory SQLite and vault fixtures: partial/full settlement, surplus, FIFO/pennies, historical invoice preservation, company/issuer/test isolation, transaction rollback, imported-order replay and protected concurrent retries. Type checking, scoped lint and renderer/main/preload builds pass. Production data, Drive and release channels are untouched. Installed Windows testing remains outstanding.

# Transfer credit, driver collections and admin delivery

Implemented locally against Hub f7d6f49 (0.1.143), in the existing financial-confirmations checkout. The older project-root 0.1.126 branch and its existing changes were preserved. Web baseline: order-status-20261106.

## Behavior
- Transfer to the normal register defaults to no new payment. Existing payments and applied credit retain their amounts; fully settled invoices can transfer. Optional card receipt remains supported. Credit Notes on the source invoice remain subject to the existing block.
- The encrypted transfer freezes the credit snapshot. Activation creates normal credit entries already consumed by the new invoice, in the same SQLite transaction as payment activation. Closing the old applications does not restore protected available credit. Existing journal/retry boundaries and legacy zero-credit payload hashes are preserved. No plaintext protected source references are copied.
- Daily Cash adds a driver selector using the existing date range. It groups latest acknowledged receipt values by store and actual collection date in Europe/London. Reconciled manual roots are counted once. Generic manual cash without a store attribution is not guessed. Accounting cash-day dates are unchanged; pending/conflicting imports are not reported as confirmed receipts.
- VR Baker adds an admin/superadmin delivery dialog with reviewable quantities. An additive private RPC implementation checks active administrative access, date/status and the exact item snapshot, locks the order/items and records the real confirming account. Persistent operation IDs prevent duplicate confirmation after lost responses. Driver endpoints are unchanged.

## Verification
541 Hub tests passed before the final added negative-credit case; subsequent focused transfer/report tests cover that case and credit-bearing recovery at every cloud/SQLite interruption boundary. Typecheck, focused lint, renderer/main/preload build and synthetic browser tests passed. The browser verifies driver selection, empty/error/retry, unchanged outstanding for no-payment transfer, card bounds and desktop/mobile layout.
Web: TypeScript, focused ESLint and production build passed; 16 focused component/reporting tests passed. PostgreSQL 17 isolated tests exercised role denial, inactive accounts, replay, invalid/stale/cancelled/future inputs, simultaneous calls and rollback retaining audit. Browser fixtures use mocked API responses, not real orders.

## Release boundary and rollback
No release, production database migration or live financial/order mutation was performed. Apply the generated admin_confirm_delivery migration before publishing the web build. Use the established publisher/changelog process and Windows installer verification for release.
For web rollback deploy the previous artifact and run supabase/rollbacks/admin_confirm_delivery.sql; the audit table is retained. For Hub, finish all pending transfers before any downgrade, especially credit-bearing transfers that older versions cannot understand. Do not restore one side of a completed vault/SQLite handoff in isolation. Real Windows installation, real Drive interruptions and production Supabase execution remain unverified.

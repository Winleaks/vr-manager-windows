# Protected client profile and payment recipients

## Scope

- Payment history resolves company, invoice reference and store from the protected vault. Advances have no invented invoice or store; orphan/reversed entries remain visible.
- Client names open a financial profile: totals, outstanding, available credit, issuer filter, invoice actions, receipts, Credit Notes, credit sources/applications and store details with outstanding balances.
- Existing protected invoice editor, document actions, payment, credit and Credit Note workflows are reused, scoped to the selected company. The payment company is fixed inside a client profile.
- Existing Hub typography, surfaces, spacing and icons are retained. No normal-ledger financial APIs are called by the profile.
- Changes are read projections and UI composition; no migration, counters, historical amounts, vault persistence format or routing changed. No decrypted financial state is persisted locally.

## Verification

- 327 Node tests pass, including protected payment recipient resolution, historical/advance/reversed cases and cross-company/cross-issuer invoice mismatch handling.
- Synthetic Chromium renderer suite passes: keyboard client navigation, cross-company isolation, scoped payment history, invoice editor quantity input, Credit Note entry point, credit ledger and stores; existing Viewer and input regressions still pass.
- Profile and receipt screenshots visually reviewed at 1440×1100 using synthetic data only.
- TypeScript, scoped lint and renderer/main/preload production build pass. Existing bundling warnings remain.
- No live vault, database, Drive files or releases modified. Installed Windows/real cloud workflows are not tested in this change.

Previously approved compact invoice PDF changes remain in the worktree, separate from this feature. Publication requires explicit approval and a new version, not overwriting the previous release branch.

# Invoice payment terms — v0.1.123

Based on published Windows release v0.1.122, commit bb1884f675d12af0638b9fcc3b092ec28679737c. Do not rebuild from the older main branch or the user's dirty checkout.

## Contract

SQLite migration 24 adds payment terms without changing money, prepared publication payloads or document revisions. Weekly invoices derive Thursday from their recorded delivery period, including replacement lineage; manual invoices use issue date + four calendar days. Ambiguous dates remain review items. Historical PDFs are not regenerated; newly generated invoices display the due date.

The existing protocol v2 stage/commit remains atomic and revision-protected. Terms are additive. Mutations wake publication immediately; the five-minute recovery publisher remains. Normal queued revisions and protected-register pending state survive restart. Acknowledgement clears only the confirmed generation. No new bank integration or remote notification.

The Writer UI distinguishes unknown, pending and synchronized publication, with retry. Closing on Windows warns while financial changes are pending or their state cannot be established. Closing after confirmed publication does not expire balances on the client platform.

## Rollout

1. Apply the compatible platform migrations with enforcement disabled and suspended.
2. Verify the Windows CI installer, native PDF checks, tests, typecheck and lint from this exact branch.
3. Publish v0.1.123, update the Writer PC, and allow every company revision to be acknowledged. Check the synchronization banner and platform reconciliation review.
4. Review incomplete periods/mappings; do not guess missing terms. Compare totals against Hub.
5. Agree a future Monday separately, enable client warnings and retain the Monday–Thursday historic grace before Friday enforcement.

The installed Writer PC is not automatically verified merely by a GitHub release. Confirm its actual version and acknowledged revisions before enabling policy.

## Recovery and rollback

Keep the pre-migration SQLite backup produced by the existing migration mechanism. Never replace a live database with an old backup after new financial writes; retain and reconcile those writes. Suspend platform blocking immediately if release verification fails. Prefer a forward repair; extra schema columns remain compatible with previous reads, but a previous Hub cannot publish complete terms for newly created invoices. Do not enable blocking while reverting Hub.

Local SQLite tests cover preserved money, rollback on interrupted migration, prepared-payload replay, weekly/manual reissues and inherited periods. Windows CI covers build/install packaging and native PDF rendering; it does not establish an interactive upgrade on the operator's physical PC or a real bank payment.

# Financial synchronization correction

Baseline 0.1.146, commit 7c03260. The connected Writer showed one pending company named Magazine neasociate and an invalid VR Baker company association. Source confirms this is the synthetic vrbaker-unassigned-company shell created during entity import. UI inspection was read-only.

## Implementation
financialPublicationQueue supplies normal publishing, status IPC and native close guard. It excludes only the exact technical shell with no financial history, no prior published revision, no frozen delivery and no tombstones. No financial row or queue acknowledgement is changed to hide it. Invalid/duplicate company identities and invoice-store identities are blocked with visible affected-store summaries. Durable generic failure metadata is stored in app_settings, with confirmation timestamp, blocked revision and Retry-After deadline; no schema migration is required. New revisions/manual configuration retry permit recovery; local invalid associations remain blocked. Real UUIDs alone authorize mappings, never names.

A single retry timer wakes at the earliest eligible deadline. Delays grow 2/5/15/30/60 seconds, server Retry-After takes precedence and survives restart. Manual retry/reconnect requests are queued during active commits. Each delivery keeps the existing immutable payload/idempotency key. The protected scheduler marks pending only for financial changes, retains confirmed encrypted receipts on manual retry, exposes generic failure status and retries transient errors without leaking private identities. Periodic verification never claims a new financial change. Viewer cannot invoke the new wake mutation.

## Validation and rollout
555 tests passed at this point, including empty/nonempty technical shells, tombstones, frozen deliveries, invalid identities, hidden companies, retry during publication, lost commit response, server limits and protected periodic scheduling. Typecheck/lint/build passed (existing lint warnings remain). Synthetic browser tests verified clean, active, association and transient states and manual-refresh behavior. No real financial mutation was performed for testing.

Release 0.1.147 uses immutable Windows CI artifacts. Verify installer hash and source SHA before promotion and publish bilingual changelog through the existing publisher. Update the connected Writer and inspect its real queue. Confirmation of the next real financial change must use the user's normal operation, not a fabricated payment.

Rollback is the previous 0.1.146 installer with the same database schema. Retry metadata is additive app_settings data and ignored by the old version. Preserve the latest backup and finish in-flight protected transfers before any downgrade; never restore one side of a financial transfer independently.

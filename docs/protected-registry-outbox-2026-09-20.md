# Protected registry: temporary encrypted saves

## Approved behavior

Writer may keep **only unacknowledged** protected financial state locally, encrypted.
Cloud remains the shared authoritative copy; Viewer still reads only the verified
cloud vault. The earlier cloud-only rule is relaxed solely for this pending queue.
No decrypted protected financial data is placed in SQLite, browser storage or logs.
Existing visibility metadata approved separately is unchanged.

Normal invoice edits/issuance, issuer replacement, receipts, credit applications and
Credit Notes without stock returns accept a durable local save, then synchronize in
the background. An online request against the fixed vault file is required for
every new operation. Loss of connectivity means **no new offline issuance**.
While an upload is pending, the next operation uses the latest accepted state.
When the uploader fails, new mutations stop; already accepted work is retained.

PIN/recovery changes, assignments/routing, test cleanup and Credit Notes involving
SQLite stock returns retain synchronous confirmation and require an empty outbox.
Document sending/printing/export waits for synchronization. These actions do not
retry issuance. Editing an invoice while its PDF is uploading remains possible.

## Implementation and integrity

- `userData/protected-pending-v1`: randomly named AES-256-GCM records, domain-separated
  authenticated encryption, existing OS-protected vault key, no new renderer secret.
- Entire metadata/payload is encrypted: stable operation ID, schema, Drive account
  scope, canonical vault file ID, base-state SHA-256, next vault and required PDF jobs.
- Each file is written exclusively with restrictive permissions, flushed and
  atomically renamed. Directory fsync is used where supported (not Windows).
  Unrenamed staging files are not accepted operations and are removed on unlock.
- Ordered revision/hash chain. One Writer, one main-process uploader. The next
  acceptance does not await the previous full vault/PDF upload.
- Stable Google permission identity permits reconnecting to the same account with a
  new OAuth grant. Changed account, changed file or unexpected cloud contents stop
  the upload. No automatic last-write-wins, merge or discard of financial conflicts.
- Existing Drive pending → vault → routing manifest protocol is retained, plus PDF
  completion. Only then is the corresponding local encrypted record unlinked.
  Filesystem deletion is not a claim of secure media erasure.
- A lost cloud acknowledgement rechecks the exact target state before retrying;
  numbering and financial operations are not rerun. Failed PDF uploads retain their
  job with the accepted state. Later dependent saves remain queued.
- Queue limited to 50 revisions / 256 MiB; retries back off to 120 seconds. Status
  and manual retry are restricted to an unlocked Writer and do not disclose IDs.
- PIN lock removes access/plaintext temporary documents but does not discard
  accepted encrypted work. Upload may finish after lock without reopening a session.
  On restart, unlock resumes pending work before loading the working state. This
  release does not add offline unlock; the encrypted pending copy remains retained.

## Verification and rollout limits

Synthetic tests exercise actual service functions, real encryption/filesystem,
ordered concurrent saves, replay, edit and issuer-change invariants, stale editor
versions, partial/ambiguous writes at each cloud stage, PDF failures, restart,
lock/Viewer/offline denial, disk acceptance failure, account/file/version conflicts,
same-account reauthentication and polling without prolonging PIN sessions.
Renderer checks cover pending/error/synced feedback, navigation during upload,
keyboard retry and input focus preservation.

No live vault, production database, Drive file, platform setting or release was
changed. Local build/tests are not a Windows/real-Drive latency measurement.
Before publication: test Windows upgrade, real Writer/Viewer, connectivity loss and
restart with pending work, print/share after acknowledgement, and antivirus/disk
conditions. Preserve the single-Writer invariant. The existing Drive version check
is not a distributed multi-Writer transaction.

Do not downgrade to a cloud-only build or remove the application profile while
pending files exist. First confirm an empty queue and verified cloud state. Keep
the pending-file schema compatible in future upgrades; never silently discard it.

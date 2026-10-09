# Driver receipt queue v3

The server is the durable inbox while Writer is closed. Only Writer may drain it.
A receipt is company credit/payment, independent of the order used to collect it;
existing FIFO allocation and issuer/registry binding are unchanged.

## Protocol and recovery

- `driver.cash.status` accepts `source_id` and the durable `after` cursor. It returns
  `protocol_version: 3`, `latest_sequence`, and `has_work`. Initial zero declarations
  are excluded, including their entity imports and financial publication.
- `driver.cash.pending` with `protocol_version: 3` additionally accepts `page_after`
  and optional `through`. Its envelope contains `items` (at most 50), `through`,
  `next_page_after`, and `has_more`. Keep `after` and `through` fixed for a drain;
  advance the page cursor even past deferred roots. Start a fresh page cursor at
  zero on the next drain. Pending operations behind `after` remain eligible.
- ACKs continue using v2, after authoritative local/Drive saves. A processed server
  receipt missing locally stops processing for reconciliation; never reapply it.
- SQLite migration 28 adds retry deadlines and operational review decisions after
  a verified pre-migration snapshot. Protected allocations are not copied into
  these tables. Retryable provider failures defer the root; SQLite failures and
  financial inconsistency still stop the worker.
- `driver.cash.review.retry` establishes and releases the review conflict in one
  server transaction, including loss of the original conflict ACK or retry response.
  A manual resolution acknowledges transport with `disposition: recorded_manually`;
  it creates no cash/payment/credit and subsequent revisions require review. Its
  reference is an existing operational Daily Cash row, never a protected payment ID.

## Rollout / containment

Deploy the additive server migration and compatible external API before Hub 0.1.132.
Keep custom X-API-Key authentication, billing scope, Writer validation, rate limiting,
RPC revocations, and v1/v2 behavior. No Android update is required for the Hub queue.
Android queue isolation and form identity changes are separate source changes and
must be included in a reviewed mobile release, without discarding other in-progress work.

On a financial discrepancy stop the affected operations and preserve both journals.
Do not restore an older database over new money. Do not downgrade a Writer after
v3 manual resolutions without reconciliation; older Hubs cannot interpret their
local review semantics. Server rollback leaves additive RPCs in place for installed
clients; use a compatible forward fix if needed.

Validation: disposable PostgreSQL exercises compatibility, zero history, multi-page
queues, concurrent arrivals, review retry response loss, and role denial. SQLite
and encrypted-vault tests cover review, crash recovery, exact replay, Viewer denial,
protected privacy, oldest-invoice allocation, surplus, and migration snapshots.

# Normal billing receipt correction

## Defect and scope

The payment editor treated an allocated receipt as limited to its linked invoice,
even though recording a receipt already distributes money across the company's
outstanding invoices. Correcting a mistyped amount could therefore fail.

For invoice-linked receipt edits, preserve the original payment ID and allocate
up to that invoice's remaining capacity, excluding other payments. Distribute
the excess using the existing allocator: oldest outstanding invoices of the same
company and historical issuer, then company/issuer advance credit. Do not change
the company's current issuer preference or other receipts. History continues to
show individual allocations, not a new grouped-receipt model. Editing an advance
retains its existing consumed-credit checks.

## Integrity and compatibility

- SQLite transaction includes all allocations, invoice states, credit and audit;
  any failure rolls everything back. Existing publication/document queue triggers
  remain transactional.
- Operation UUID replay returns the prior result; reuse with altered input fails.
  An audit revision from the company profile rejects stale/concurrent edits,
  including when the original invoice allocation remains unchanged after a split.
- Keep Writer-only IPC and normal-billing visibility checks. Preserve credit-note
  and applied-credit edit restrictions. Validate original company/issuer identity,
  cancelled status and reconciliation between payments and invoice paid amount.
- No schema migration, financial backfill or live database/Drive mutation.
  Renderer and main must be deployed together because edit identity is required.
- Existing original amount/date/method/bank and corrected amount are audited;
  audit also includes resulting allocations. User enters the corrected amount,
  not the difference, and sees a split-allocation notice where applicable.

## Evidence

- All 369 Node tests pass, including synthetic 82.75 → 820.75 across three
  invoices, other-company/issuer/cancelled exclusion, unchanged other receipts,
  reductions, surplus credit, replay, stale edits, consumed credit, invalid inputs,
  publication queue and full rollback after an injected credit insertion failure.
- Complete synthetic browser suite passes, including decimal editing, keyboard
  save, disabled pending form, ambiguous-response retry with identical operation
  identity, refreshed allocation history and Viewer read-only access.
- TypeScript, lint (existing unrelated warnings only), and renderer/main/preload
  production build pass. Project binaries were invoked through Node to avoid the
  checkout's colon-containing path interfering with npm's executable lookup.
- Not published in this task. Physical Windows upgrade and actual Writer data /
  Drive reconciliation remain post-install checks; tests use synthetic data only.

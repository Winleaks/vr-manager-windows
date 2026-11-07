# Writer 0.1.142

RO: X ascunde Hub în zona de notificări Windows. Meniul pictogramei permite redeschiderea sau închiderea definitivă. Writer preia încasările la pornire, reconectare și notificări, fără verificarea periodică a cozii.

EN: X hides Hub in the Windows notification area. The icon menu reopens or quits Hub completely. Writer retrieves receipts on startup, reconnection and notifications without periodic queue checks.

## Integrity
The existing durable server queue, SQLite transactions, operation/root/revision identifiers, paginated watermark and idempotent ACK remain authoritative. Signals contain no financial data. Supabase adds its technical message ID. Startup/reconnection subscribe first, then drain. Signals during a drain request a trailing pass; duplicates do not duplicate money. Only failed or known deferred work receives a retry timer. Network delivery is not claimed to be exactly once.

## Security and cost
The existing Writer credential obtains a 15-minute opaque read-only topic, renewed every ten minutes without querying cash. Connection heartbeats and authorization renewal remain; cash polling does not. The main process holds the capability; no service-role key is shipped. RLS denies guessed/expired topics and client publishing. Viewer does not subscribe. No new paid services, schema/data migration in SQLite, subscription changes or changes to the separate financial publisher. Existing Supabase quota limits still apply.

## Verification
525 local tests, typecheck and Vite build passed. Existing lint warnings remain. Isolated PostgreSQL checks cover ACL/RLS, expiry, no financial payload, no ACK signal loop. Live checks confirm private subscription, signal delivery, denied send and denied guessed topic. external-api v29 is live with only an additive subscription action over verified v28. Native Windows tray smoke passed in CI; the installer checks run before publishing. No installed-machine visual verification is claimed.

## Recovery
Retain the durable queue and existing IDs/cursor. The previous v0.1.141 installer remains compatible with the additive backend. Halt adoption and reinstall that compatible version or issue a forward correction. Do not roll back the new subscription endpoint while new clients still depend on it. Do not reset the local database. Explicit quit stops transport and timers; Windows shutdown and approved update installation bypass tray hiding. Pre-existing unrelated docs/manual-vr-hub and output directories are excluded from this release commit.

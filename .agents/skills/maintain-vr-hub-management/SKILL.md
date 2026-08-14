---
name: maintain-vr-hub-management
description: "Safely maintain, harden, optimize, test, and release the VR - Hub Management Windows desktop application, including Electron, SQLite, Google Drive replicas, VR Baker Platform imports, billing, security, and data integrity."
---

# Maintain VR - Hub Management

Treat this as an offline-first Windows business application whose local SQLite data must survive crashes, upgrades, bad imports, and interrupted synchronization. Read `references/project-map.md` before architecture, database, security, sync, backup, or release work.

## Establish the boundary

1. Inspect `git status` and every applicable `AGENTS.md` before editing.
2. Trace affected flows through renderer, preload, IPC, repository/database, and external integration.
3. Preserve unrelated changes and existing databases.
4. Never publish a release, rotate production credentials, rewrite history, or alter live resources without explicit authority.

## Invariants

- Treat renderer input as untrusted; expose narrow preload methods and validate caller and payload in Electron main.
- SQLite is operational truth on exactly one Writer. Multi-table mutations are transactional and validate money, quantities, dates, references, and state.
- Viewers are fail-closed for mutations, never contact VR Baker/Supabase, and only consume verified Drive replicas.
- Backups use SQLite snapshots, checksum/integrity/schema validation, temporary files, atomic replacement, rollback, and bounded retention.
- Store confidential integration values through platform-protected storage; never return secrets to the renderer or place them in local business data, logs, or source control.
- External imports use least-privilege access, bounded retries and pagination, auditing, rate limits, and transactional upserts without automatic deletion.
- Billing imports preserve source identity, enforce the business period, ignore invalid quantities, preserve source prices, and prevent duplicate billing.
- Imported invoices are immutable automatically; report later source differences for manual resolution.
- Constrain filenames and paths before filesystem operations. Tie PDFs to authoritative invoice rows.

## Verification

Run focused pure tests, SQLite migration/rollback/duplicate tests, negative IPC/auth/path tests, lint/type checks, and a build without publishing. Windows clean-install, legacy upgrade, Drive restore, offline/reconnect, and installer checks remain required before release. Use `secure-private-by-design`, `ship-offline-desktop-app`, `supabase`, or `release-with-rollback` whenever their domains apply.

Report user-visible outcome, migration and security effects, checks run, live resources changed, and untested Windows/production limits.

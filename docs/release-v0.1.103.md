# Release v0.1.103

## Authority, source and target

On 2026-09-08 the user requested continuation after the explicitly stated next step: publish the Hub update, let Writer synchronize PDFs, verify download/isolation, then separately enable customer visibility. This release authorizes the stable Windows x64 GitHub updater/NSIS artifact, not customer activation or a backend redeployment. Target: Winleaks/vr-manager-windows. Application source: 2457b05, including 3994ad2 and all of published v0.1.102 (5b8c005). Fresh remote/release and local worktree checks found no newer application work to include. Release metadata/version changes only follow that tested source.

## Scope and checks

- Durable, bounded retry of normal invoice/Credit Note uploads, separate from SQLite backup; safe pending/error banner.
- One Drive invoice PDF named `Invoice_<number>.pdf`, stable file identity across edits, exact legacy recognition, no-op financial saves, recoverable duplicate cleanup only after the latest company publication is acknowledged.
- Additive migrations 19–20, preceded by a verified pre-migration database snapshot. No financial amounts, numbers, payments or protected-register state are rewritten by migration. Existing confirmed historical invoices are not bulk reissued.
- Local source evidence: 272 automated tests, TypeScript, focused lint, renderer/main/preload build, and whitespace checks passed. Existing browser evidence covers the unchanged renderer/native surfaces and queue banner. Synthetic SQLite tests cover migration rollback, preservation, revision guards and no-op saves; synthetic Drive tests cover lost responses, bounded retry, stale roles/ownership, duplicate cleanup and content verification.
- Windows workflow must pass clean npm ci, tests, lint, typecheck, self-contained .NET helper compilation, native PDF/render/share package smoke, Vite and Electron NSIS packaging before release publication. Check the final tag/SHA and downloaded installer size/SHA512 against latest.yml and GitHub asset digest afterwards.
- Distribution remains unsigned; do not claim Authenticode verification or a signed installer. Existing build/module-size warnings are not new regressions.

## Platform compatibility and acceptance still open

Read-only production checks immediately before this release found active external-api v20 and billing-download v3. The download handler resolves the Drive file ID, emits `Invoice_<number>.pdf`, uses private/no-store, and applies authenticated company RLS before retrieving the file. The filename change does not require a server deployment. Billing synchronization is enabled and customer visibility is disabled. At the read-only baseline 86 invoices were mirrored and four had a PDF association; association is not proof of an authenticated successful download.

Installed Writer upgrade/migration, real Drive recovery, printer/WhatsApp behavior and authenticated client PDF download/isolation are not established by hosted CI. As disclosed to the user, publish the update first; verify those operational results after installation without replacing or restoring the live database. This is not permission to expose incomplete customer billing. No backend, credentials, customer flags or live documents are directly changed by the release operator.

The single-file strategy intentionally has eventual consistency: Drive contents may update before platform financial metadata. Legacy duplicate files stay intact until the latest company publication is acknowledged. Cleanup moves verified duplicates to Drive Trash rather than permanently deleting them; old duplicate links may stop working, while the active canonical ID remains. This behavior begins on Writer after installation and synchronization, not during release creation.

## Abort and recovery

Stop on failing build/test gates, wrong ancestry/version, missing native runtime, mismatched installer/update metadata, migration corruption, cross-company association or unexpected document removal. Preserve v0.1.102 release assets and all pre-migration backups. Prefer a higher-version forward fix: downgrading Writer to the old two-file logic can recreate technical copies and is not an automatic rollback. Never replace business data as a recovery shortcut. With separate authorization, halt a faulty updater rollout; already installed clients cannot be recalled. Drive Trash copies can be recovered manually. No recurring monitoring automation is created.

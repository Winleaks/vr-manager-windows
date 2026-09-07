# Release v0.1.102

## Scope and authority

User authorized publication on 2026-09-07 after disclosure that Windows WhatsApp receipt remains unverified. Operator: Codex, reporting in the current task. Target: Winleaks/vr-manager-windows, stable Windows x64 NSIS installer and GitHub latest.yml updater feed. Source: 7439dce plus version/release documentation; clean release commit recorded by the workflow. Previous stable v0.1.101 (7c1f7c7) is an ancestor; remote history checked before publication. Other local checkouts have no newer application changes to include.

Includes confirmed weekly entity repair, numeric input/renderer dialog corrections, native protected sharing, invoice print preview, and stable PDF share snapshots. No new SQLite migration, automatic invoice rewriting, production data repair, API deployment, credential change or Drive mutation is part of publication. Entity repair remains separately confirmed with backup on the Writer.

## Evidence and gates

- Source checks: 243 automated tests, TypeScript, targeted lint and renderer/main/preload build passed on macOS. Native .NET Windows cross-build passed without warnings/errors. Existing synthetic browser input tests passed during implementation.
- Windows release workflow must complete npm ci, tests, full lint, typecheck, self-contained .NET publish, native synthetic PDF/preview/StorageItems checks, Electron build and NSIS packaging before publishing.
- Verify released tag/commit, installer/blockmap/latest.yml names, version, size and SHA-512 after publication. Preserve the previous release and artifacts.
- Existing distribution is unsigned; this release does not introduce a signing identity. No signed-installer claim is made.

## Deferred device acceptance and abort criteria

Installed Windows upgrade, real WhatsApp recipient delivery (rather than 0.txt), printer preview/physical output, protected lock behavior and real offline/restore flows cannot be executed on this Mac or proven by hosted runner smoke checks. User-authorized publication proceeds with these explicit limitations, not a claim of completed end-to-end acceptance. After update, test one invoice with a known recipient, confirm the PDF filename/content, and inspect preview before printing. Do not repeatedly send or print after ambiguous results.

Abort publication on failing automated gates, wrong source/version, missing native runtime, or mismatched updater hash/size. A report of data loss, cross-client disclosure, missing PDF, duplicate print, or persistent input blocking requires containment and investigation rather than repeated retries. No background client monitoring is configured by this release.

## Recovery

Keep v0.1.101 assets intact. Installed clients cannot be recalled; prefer a compatible forward fix with a higher version. If necessary, separately authorize withdrawing the faulty release from the updater feed. Before any manual older-installer recovery, back up the Writer database and protected vault; never replace/delete current business data or automatically downgrade. Reverting code does not undo a user-confirmed entity repair or a document already sent/printed. Production acceptance remains open until the operator reports device results.

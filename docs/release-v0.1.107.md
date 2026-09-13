# v0.1.107 release

User-authorized Windows x64 NSIS stable update. Base: published v0.1.106 (`a641a2728602d51a5d941ba10f14375973f065ce`). Remote branches/tags and other local worktrees were checked before preparation; no newer application commits or overlapping uncommitted application changes were found. Unrelated untracked files are excluded.

Scope: issuer replacement in both registers; invoice catalog failure containment; English generated PDF labels; separate-register responsive layout, pending-action feedback and operation-scoped cloud folder resolution. No schema migration, live data repair, platform deployment, credential changes or new local protected-data persistence.

Preflight evidence: 304 tests passed, TypeScript, scoped lint and renderer/main/preload build passed. Synthetic browser checks covered responsive forms, modal focus/Escape, editable numbers, slow-save duplicate-click prevention and error recovery. PDF fixtures were extracted and visually inspected. See the feature notes for exact fixtures and remaining limits.

Publish through the existing GitHub Windows workflow: clean `npm ci`, tests, lint, typecheck, .NET component build, native PDF render check, application build and NSIS packaging precede installer/blockmap/latest.yml publication. Abort on a failed required step, mismatched source/version, missing assets or checksum mismatch. Verify the release target SHA and update metadata after publication.

Recovery: retain v0.1.106 assets and current business data. Do not restore an old database/vault over new transactions or recall issued replacements. The schema is unchanged; issuer-change links/audits use existing structures and optional vault fields. If a critical startup, access, numbering or synchronization regression is reported, stop further operator testing and prepare an explicitly authorized feed containment or compatible forward fix. Installed clients cannot be recalled.

Real installed Writer upgrade, live Drive latency, WhatsApp and printer acceptance remain user-device checks; CI success is not evidence these interactive tests have occurred. No production data is changed by release preparation. Prior release/run details are retained on GitHub for provenance.

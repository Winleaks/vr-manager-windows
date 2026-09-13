# v0.1.106 release

Operator-authorized Windows x64 NSIS stable update, based on published v0.1.105 (d1c0f3b). Only client-list store labels and local company/store search change. The existing protected API/session and assignment mutations are unchanged; no migrations, production data writes, platform deployment or persisted search. Unrelated untracked files are excluded.

Evidence before release: 281 Node tests, TypeScript, scoped lint and renderer/main/preload build passed. The existing GitHub release workflow repeats checks after a clean dependency install on Windows, verifies native PDF rendering and packages before publishing installer, blockmap and latest.yml. Real installed Writer UI/upgrade acceptance remains an operator check; it has not been simulated as a completed Windows test.

Recovery: keep v0.1.105 artifacts and current user data; no new schema or data conversion to reverse. If startup or protected-list access fails, stop further rollout/testing and prepare a compatible forward fix or explicitly authorized feed containment. Installed clients cannot be recalled. Do not restore an older database over newer business transactions. Successful publication means artifacts and update metadata are available, not that installed-device acceptance is complete.

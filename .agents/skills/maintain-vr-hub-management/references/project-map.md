# VR - Hub Management project map

Public repository orientation. Re-check the current code before relying on this summary.

- The renderer is under `src/`; privileged desktop code is under `electron/`.
- Build, package, updater, and release configuration are defined in `package.json` and `.github/workflows/`.
- Database lifecycle and business persistence live under `electron/database/`.
- Desktop privilege boundaries and external integrations live under `electron/ipc/`, `electron/device/`, `electron/security/`, and `electron/integrations/`.
- Repository-owned service functions are under `supabase/functions/`.

Before a desktop release, verify automated tests, a clean dependency install, renderer/main/preload build, Windows packaging, upgrade with retained user data, offline behavior, authorization boundaries, backup/restore, updater metadata, and rollback readiness. Keep environment-specific identifiers, credentials, operational inventory, and incident details out of this public document.

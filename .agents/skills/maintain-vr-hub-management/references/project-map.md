# VR - Hub Management project map

Public repository orientation. Re-check the current code before relying on this summary.

- The renderer is under `src/`; privileged desktop code is under `electron/`.
- Build, package, updater, and release configuration are defined in `package.json` and `.github/workflows/`.
- Database lifecycle and business persistence live under `electron/database/`.
- Desktop privilege boundaries and external integrations live under `electron/ipc/`, `electron/device/`, `electron/security/`, and `electron/integrations/`.
- The product name is `VR - Hub Management`, but its established Google Drive destination intentionally remains `My Drive/VR - Management`: Writer snapshots go to `Baza de date`, invoice PDFs go to `Facturi`, and Viewers never upload.
- The Writer-only `Registru separat` is intentionally absent from navigation and is opened through the guarded desktop gesture. Its authoritative state is the AES-256-GCM vault under `VR - Management/Duplicat`; never persist its decrypted state in SQLite or expose assignments through normal renderer APIs.
- Once the separate register is configured, every normal invoice preview and issuance must verify its opaque Drive routing manifest and fail closed on missing, stale, concurrent, or unverifiable state. Protected series and credit are independent from normal billing.
- Protected PDFs are plaintext only in the explicitly accepted `Duplicat/Facturi`, `Duplicat/Credit Notes`, and monthly export folders. Windows Share copies are temporary and must be deleted on session lock, timeout, quit, and next startup.
- Repository-owned service functions are under `supabase/functions/`.

Before a desktop release, verify automated tests, a clean dependency install, renderer/main/preload build, Windows packaging, upgrade with retained user data, offline behavior, authorization boundaries, backup/restore, updater metadata, and rollback readiness. Keep environment-specific identifiers, credentials, operational inventory, and incident details out of this public document.

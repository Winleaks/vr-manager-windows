# Read-only protected register on Viewer

## Shared Writer PIN (November 2026)

Update both computers, then unlock the existing register once on Writer while connected to Drive. Each updated Viewer opens the register with the current six-digit Writer PIN on the same Drive account. Writer can be closed. New register setup, PIN change and Writer recovery also publish the Viewer grant.

The Writer wraps the vault key using scrypt and AES-256-GCM in `Duplicat/registru-separat.viewer-access`. Each Viewer unlock reads this file and the verified vault, holds the key in the session, and removes legacy local Viewer credentials after successful migration. Five wrong PINs lock that device for 15 minutes. Someone with copied Drive files can try PINs offline. Update legacy Viewers to enforce the new login flow.

If Drive loses a PIN-change acknowledgement, retry the change on Writer using the previous PIN. A fresh Writer unlock with the locally committed PIN also reconciles the grant. The recovery string remains a Writer recovery credential.

## Historical workflow (September 2026)

## Approved scope

Viewer may activate using the existing recovery key entered directly in the desktop app, choose a local PIN, consult the encrypted register and open/print/share invoices and Credit Notes. Writer retains all financial, configuration and import mutations.

## Boundaries

- Activation reads the fixed `Duplicat/registru-separat.vault`, verifies the cloud file and decrypts with the recovery envelope. No new vault, cloud audit, pending reconciliation or recovery write occurs.
- Viewer PIN verifier and vault key use separate OS-protected credential names. The recovery key itself is not retained. Writer credentials and PIN are unchanged. No decrypted database or vault is persisted locally.
- IPC is explicitly allowlisted. Configure/recover Writer, change PIN, mutations, catalog/VR Baker reads and monthly exports remain denied on Viewer. The central mutation function now checks Writer before cloud I/O.
- Sessions are tied to renderer and device role, expire after inactivity and reject late activation/unlock results after lock. UI clears data on exit and checks session expiry.
- Viewer refresh reads a verified encrypted snapshot without folder creation or uploads. Within a session, older vault revisions are rejected. Client names/stores come from vault assignments/invoice snapshots, not potentially stale local mappings.
- Document operations refresh the vault, resolve document by ID, refuse cancelled/missing documents and render from snapshots without uploads. Existing protected temporary-PDF cleanup and native document handlers are reused.
- Temporary PDFs and OS-protected credentials are the only local artifacts introduced; externally opened/shared copies are outside app cleanup control. This is app-enforced read-only access, not a claim that the Google account OAuth token itself has read-only scope.

## User workflow

After publication/update: connect the Viewer to the same Google Drive account, open the five-click gesture, enter recovery key and a new local PIN, then choose Activate Viewer. Subsequent access uses that PIN. Writer need not be open; Drive must be reachable. Refresh updates the displayed data; document actions recheck automatically. Keep recovery key private and offline.

## Verification and limits

- 333 Node tests pass, including all protected IPC channel permissions, real crypto activation/unlock, lockout, wrong key, missing cloud, role changes, interrupted reads, no upload/folder creation, temporary document operations, and Writer edit/issuer-change regression coverage.
- Synthetic Chromium test covers Viewer activation form, masked recovery input, keyboard/input behavior, absence of mutation buttons, recipient history and company scoping, open/print/share dispatch. Screenshot reviewed.
- TypeScript, scoped lint and renderer/main/preload build pass; existing bundle warnings remain.
- No real recovery key, live Drive/vault, customer data or production settings accessed or modified. No release yet. Installed Windows secure storage, real Drive connectivity and native print/WhatsApp require post-update verification.
- Rollback: code/UI change only, no vault format migration. Prior Writer versions remain compatible. Viewer-specific credential names do not grant previous versions Writer access.

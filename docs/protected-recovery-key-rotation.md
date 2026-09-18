# Protected registry recovery-key replacement

## Scope and trust boundary

Version 0.1.113 adds an explicit Writer action in the unlocked protected registry settings. Publishing/installing the application does not rotate any production key. A trusted main-frame IPC request, Writer role, active session, explicit confirmation and current six-digit Writer PIN are required. Five incorrect PIN attempts trigger the existing fifteen-minute lockout. Viewer requests remain denied by the IPC policy and service.

This replaces a lost activation/recovery string; it is **not a compromised-data-key revocation mechanism**. The vault data key is unchanged, so existing Writer PIN and activated Viewers continue to work. The previous recovery string cannot unwrap the current envelope, but encrypted historical backups/revisions still use the same data key. Revoking previously authorized devices would require a separate data-key and device-access migration.

## Commit and interrupted-operation recovery

The existing serialized cloud mutation path reauthenticates before accessing the vault. It preserves financial contents and numbering, records a non-secret audit event and creates a verified encrypted backup before writing the pending envelope. The canonical vault uses expected-version checks; the encrypted routing manifest receives the new recovery wrapper. Only after verification, pending cleanup and a final session/Writer check is the new string returned for display.

No plaintext replay cache exists. Concurrent generation is rejected. An ambiguous cloud failure or lost response must not display an unconfirmed string or claim rollback. The next authorized attempt reconciles any pending commit and generates another key. Locking during an operation never reopens the session or returns the secret. Existing PIN access remains available for retry.

## One-time display

The recovery string exists only in transient process/UI memory and the intended one-time Writer display. It is not written to browser storage, navigation preferences, logs, downloads, clipboard or local business data. The input PIN is cleared on submission. The key disappears on acknowledgement, settings unmount, registry lock or after two minutes. A status check also clears it if access expires. JavaScript string cleanup is logical, not a claim of guaranteed physical memory zeroization.

On Writer: Registru separat → Setări → Generează o cheie nouă de recuperare. Store the displayed string securely outside the synchronized folder. On Viewer, connected to the same Drive, enter it at activation and choose a local PIN. Do not send the key through support chat.

## Verification and release limits

Synthetic service tests cover authorization/PIN/lockout, concurrent requests, session loss, each cloud-write stage including lost acknowledgements, retry reconciliation, backup recovery wrappers and preservation of invoices/payments/credit/order routing. Browser tests cover confirmation, transient display, failed-save feedback, retry, navigation/lock clearing, absence of browser storage and absent Viewer mutation controls. No production credentials or records are used in these tests.

No schema or vault-format migration is required. Existing clients remain compatible because the data key and envelope format are unchanged. Containment is to stop using the new action and publish a forward fix if needed; never restore an older financial vault merely to undo this feature. Physical Windows upgrade and activation on the user's real devices require user acceptance after installing the verified Windows artifact.

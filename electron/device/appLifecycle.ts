type WindowHandle = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  hide?(): void;
};

export function createAppLifecycle(options: {
  confirmClose(): boolean;
  canHideToTray?(): boolean;
  getWindow(): WindowHandle | null | undefined;
  createWindow(): void;
  quit(): void;
  cleanup: Array<() => void>;
  reportError(error: unknown): void;
}) {
  let ready = false;
  let quitting = false;
  let cleaned = false;
  return {
    ready() { ready = true; },
    beforeQuit(event: { preventDefault(): void }) {
      if (!options.confirmClose()) {
        event.preventDefault();
        return;
      }
      quitting = true;
    },
    windowClose(event: { preventDefault(): void }) {
      if (quitting) return;
      const window = options.getWindow();
      if (options.canHideToTray?.() && window?.hide && !window.isDestroyed()) {
        event.preventDefault();
        window.hide();
        return;
      }
      // A failed/missing tray must never leave an inaccessible background app.
      if (!options.confirmClose()) event.preventDefault();
    },
    sessionEnding() { quitting = true; },
    mainWindowClosed() {
      if (!quitting) options.quit();
    },
    reopen() {
      if (!ready || quitting) return;
      let window = options.getWindow();
      if (!window || window.isDestroyed()) {
        options.createWindow();
        window = options.getWindow();
      }
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
    willQuit() {
      if (cleaned) return;
      cleaned = true;
      // A failed temporary-file cleanup must not skip closing SQLite.
      for (const cleanup of options.cleanup) {
        try { cleanup(); } catch (error) { options.reportError(error); }
      }
    },
  };
}

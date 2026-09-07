export interface FeedbackNotice { id: number; message: string }
export interface FeedbackConfirmation { id: number; message: string }
interface FeedbackState {
  notices: FeedbackNotice[];
  confirmation: FeedbackConfirmation | null;
}

// DOM feedback never invokes Chromium's synchronous alert/confirm dialogs, which
// can leave editable fields without keyboard focus on Windows.
export function createFeedbackController() {
  let state: FeedbackState = { notices: [], confirmation: null };
  let sequence = 0;
  let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: FeedbackState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const clear = () => {
    const resolve = resolveConfirmation;
    resolveConfirmation = undefined;
    publish({ notices: [], confirmation: null });
    resolve?.(false);
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) clear();
      };
    },
    clear,
    notify: (message: string): void => {
      // A result from an unmounted/locked workspace must not leak into another.
      if (!listeners.size) return;
      publish({ ...state, notices: [...state.notices.slice(-3), { id: ++sequence, message }] });
    },
    dismiss: (id: number) => publish({ ...state, notices: state.notices.filter((notice) => notice.id !== id) }),
    confirmAction: (message: string): Promise<boolean> => {
      // Fail closed when no UI can ask, or another confirmation is already open.
      // Do not queue stale or double-clicked financial/destructive actions.
      if (!listeners.size || resolveConfirmation) return Promise.resolve(false);
      return new Promise((resolve) => {
        resolveConfirmation = resolve;
        publish({ ...state, confirmation: { id: ++sequence, message } });
      });
    },
    answer: (id: number, confirmed: boolean) => {
      if (state.confirmation?.id !== id) return;
      const resolve = resolveConfirmation;
      resolveConfirmation = undefined;
      publish({ ...state, confirmation: null });
      resolve?.(confirmed);
    },
  };
}

export type FeedbackController = ReturnType<typeof createFeedbackController>;
export const feedback = createFeedbackController();
export const { notify, confirmAction } = feedback;

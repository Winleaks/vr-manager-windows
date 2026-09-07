import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { feedback, type FeedbackConfirmation, type FeedbackController } from '../utils/feedback';

function Confirmation({ request, controller }: { request: FeedbackConfirmation; controller: FeedbackController }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const accept = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={messageId}
    onCancel={(event) => { event.preventDefault(); controller.answer(request.id, false); }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === cancel.current) {
        event.preventDefault(); accept.current?.focus();
      } else if (!event.shiftKey && document.activeElement === accept.current) {
        event.preventDefault(); cancel.current?.focus();
      }
    }}
    className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/60">
    <h2 id={titleId} className="text-xl font-bold">Confirmare</h2>
    <p id={messageId} className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">{request.message}</p>
    <div className="mt-6 flex justify-end gap-3">
      <button ref={cancel} type="button" onClick={() => controller.answer(request.id, false)} className="rounded-xl border border-slate-300 px-4 py-2">Renunță</button>
      <button ref={accept} type="button" onClick={() => controller.answer(request.id, true)} className="rounded-xl bg-indigo-600 px-4 py-2 font-semibold text-white">Confirmă</button>
    </div>
  </dialog>;
}

export function FeedbackHost({ controller = feedback }: { controller?: FeedbackController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    window.addEventListener('hashchange', controller.clear);
    window.addEventListener('beforeunload', controller.clear);
    return () => {
      window.removeEventListener('hashchange', controller.clear);
      window.removeEventListener('beforeunload', controller.clear);
    };
  }, [controller]);
  return <>
    <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed right-4 top-4 z-[500] flex max-h-[60vh] w-[min(92vw,28rem)] flex-col gap-2 overflow-y-auto">
      {state.notices.map((notice) => <div key={notice.id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-xl border border-indigo-200 bg-white p-4 text-sm text-slate-800 shadow-xl">
        <p className="flex-1 whitespace-pre-wrap break-words">{notice.message}</p>
        <button type="button" aria-label="Închide notificarea" onClick={() => controller.dismiss(notice.id)} className="shrink-0 rounded p-1 hover:bg-slate-100"><X size={16} /></button>
      </div>)}
    </div>
    {state.confirmation && <Confirmation key={state.confirmation.id} request={state.confirmation} controller={controller} />}
  </>;
}

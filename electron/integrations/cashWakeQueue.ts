/** Coalesce wake-ups; retry only failed/known work. There is no idle polling. */
export function createCashWakeQueue(options: {
  drain(): Promise<void>;
  nextRetry(): number | null;
  failed(error: unknown): boolean;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, running = false, requested = false, failures = 0;
  function arm(ms: number) {
    if (timer) cancel(timer);
    timer = schedule(() => { timer = undefined; wake(); }, Math.max(0, ms));
    timer.unref?.();
  }
  async function run() {
    if (running || stopped) return;
    running = true;
    try {
      do { requested = false; await options.drain(); } while (requested && !stopped);
      failures = 0;
      if (!stopped) {
        const retryAt = options.nextRetry();
        if (retryAt !== null) arm(Math.max(1000, retryAt - now()));
      }
    } catch (error) {
      if (!stopped && options.failed(error)) {
        const retryAfter = Number((error as { retryAfterMs?: number })?.retryAfterMs) || 0;
        arm(Math.max(retryAfter, Math.min(300000, 5000 * 2 ** Math.min(failures++, 6))));
      }
    } finally { running = false; }
  }
  function wake() {
    if (stopped) return;
    requested = true;
    if (timer) { cancel(timer); timer = undefined; }
    if (!running) { running = true; queueMicrotask(() => { running = false; void run(); }); }
  }
  return { wake, stop() { stopped = true; if (timer) cancel(timer); } };
}

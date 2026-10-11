/** Coalesce bursts and keep one trailing refresh when data changes during a read. */
export function createRefreshQueue(refresh: () => Promise<void>, options: { canRun?: () => boolean; debounceMs?: number } = {}) {
  let stopped = false;
  let busy = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const delay = options.debounceMs ?? 250;

  const run = async () => {
    if (stopped) return;
    pending = true;
    if (busy || options.canRun?.() === false) return;
    clearTimeout(timer);
    pending = false;
    busy = true;
    try { await refresh(); }
    catch { /* Keep the last valid data; consumers can expose a retry message. */ }
    finally {
      busy = false;
      if (pending && !stopped) schedule();
    }
  };
  const schedule = () => {
    if (stopped) return;
    pending = true;
    if (busy) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  };
  return {
    run,
    schedule,
    stop() { stopped = true; pending = false; clearTimeout(timer); },
  };
}

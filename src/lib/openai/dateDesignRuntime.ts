/** One shared design deadline and one repair across structure and route stages.
 * Configuration changes orchestration, never factual/user constraint checks. */
export function dateDesignRuntime(now = () => performance.now()) {
  const configured = Number(process.env.DATE_ENGINE_DESIGN_TIMEOUT_MS);
  const timeoutMs = Number.isSafeInteger(configured) && configured >= 5000 && configured <= 60000
    ? configured : 45000;
  const startedAt = now();
  const signal = AbortSignal.timeout(timeoutMs);
  let repairs = 0;
  const remainingMs = () => Math.max(0, Math.floor(timeoutMs - (now() - startedAt)));
  return {
    signal,
    timeoutMs,
    remainingMs,
    untilDeadline: <T>(operation: Promise<T>, fallback: T): Promise<T> => {
      if (signal.aborted) return Promise.resolve(fallback);
      return new Promise(resolve => {
        const abort = () => resolve(fallback);
        signal.addEventListener("abort", abort, { once: true });
        void operation.then(resolve, () => resolve(fallback))
          .finally(() => signal.removeEventListener("abort", abort));
      });
    },
    canGenerate: () => !signal.aborted && remainingMs() >= 1000,
    claimRepair: () => {
      if (repairs || signal.aborted || remainingMs() < 1500) return false;
      repairs++;
      return true;
    },
    get repairs() { return repairs; },
  };
}

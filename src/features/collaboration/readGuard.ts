/** Invalidate a read when its account, screen or underlying data has changed. */
export function createReadGuard(initialScope: string) {
  let scope = initialScope;
  let version = 0;
  return {
    updateScope(next: string) {
      if (next !== scope) { scope = next; version += 1; }
    },
    invalidate() { version += 1; },
    capture() {
      const capturedScope = scope;
      const capturedVersion = version;
      return () => capturedScope === scope && capturedVersion === version;
    },
  };
}

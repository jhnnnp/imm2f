/** Serializes writes that share a server revision, including date switches. */
export function createPlanSaveQueue() {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(save: () => Promise<T>): Promise<T> {
      const result = tail.then(save);
      // A rejected request must not prevent the next retry from running.
      tail = result.then(() => {}, () => {});
      return result;
    },
    async idle() {
      let observed: Promise<void>;
      do {
        observed = tail;
        await observed;
      } while (observed !== tail);
    },
  };
}

/**
 * Trailing-edge debounce, kept outside React so the timing can be tested with
 * fake timers.
 *
 * `schedule` restarts the timer on every call, so only the settled value is
 * delivered — which is what stops a search box from firing a request per
 * keystroke while still giving immediate input feedback.
 */

export interface Debounced<Args extends unknown[]> {
  schedule(...args: Args): void;
  /** Deliver the pending call right now, if there is one. */
  flush(): void;
  /** Drop the pending call. */
  cancel(): void;
  isPending(): boolean;
}

export function createDebounced<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(...args: Args) {
      pendingArgs = args;
      clear();
      timer = setTimeout(() => {
        timer = null;
        const settled = pendingArgs;
        pendingArgs = null;
        if (settled) callback(...settled);
      }, delayMs);
    },

    flush() {
      clear();
      const settled = pendingArgs;
      pendingArgs = null;
      if (settled) callback(...settled);
    },

    cancel() {
      clear();
      pendingArgs = null;
    },

    isPending() {
      return timer !== null;
    },
  };
}

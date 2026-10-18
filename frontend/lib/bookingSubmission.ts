/**
 * A single-flight gate for form submissions.
 *
 * The point is that one user action produces at most one request: a second click
 * while the first request is in flight is ignored rather than queued, and the
 * gate reopens as soon as the task settles — including when it fails, so a
 * recoverable error leaves the control usable.
 */

export type SubmissionOutcome<T> =
  | { status: "completed"; value: T }
  | { status: "ignored" };

export interface SubmissionGate {
  isInFlight(): boolean;
  run<T>(task: () => Promise<T>): Promise<SubmissionOutcome<T>>;
}

export function createSubmissionGate(): SubmissionGate {
  let inFlight = false;

  return {
    isInFlight: () => inFlight,

    async run<T>(task: () => Promise<T>): Promise<SubmissionOutcome<T>> {
      if (inFlight) return { status: "ignored" };

      inFlight = true;
      try {
        return { status: "completed", value: await task() };
      } finally {
        inFlight = false;
      }
    },
  };
}

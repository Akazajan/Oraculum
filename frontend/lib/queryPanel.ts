/**
 * The four states a query-backed panel can be in.
 *
 * Panels decide their own state instead of sharing one page-wide flag, so a
 * failing query cannot hide the panels that succeeded.
 */
export type QueryPanelState = "loading" | "error" | "empty" | "ready";

export interface QueryPanelInput {
  isLoading: boolean;
  isError: boolean;
  /** True when the query succeeded but produced nothing to render. */
  isEmpty: boolean;
}

export function queryPanelState({
  isLoading,
  isError,
  isEmpty,
}: QueryPanelInput): QueryPanelState {
  // Loading wins: a refetch after an error should show progress, not the stale
  // error, and an empty result is only "empty" once the query has settled.
  if (isLoading) return "loading";
  if (isError) return "error";
  if (isEmpty) return "empty";
  return "ready";
}

/** A failed panel can always be retried; the other states have nothing to retry. */
export function canRetryPanel(state: QueryPanelState): boolean {
  return state === "error";
}

// ── F18 — Preserve query results when a later query fails ───────────────────
//
// A second query that fails must not replace the last successful result.
// The store separates the visible data from the error, so a panel that
// previously loaded successfully can still show that data while also
// surfacing the follow-up error.

export interface QueryResultStoreState<T> {
  /** The last successful result, or null if no query has succeeded yet. */
  lastSuccess: T | null;
  /** The error from the most-recent failed query, or null when it succeeded. */
  lastError: unknown | null;
  /** True while a query is in-flight. */
  isLoading: boolean;
}

function initialQueryResultStoreState<T>(): QueryResultStoreState<T> {
  return { lastSuccess: null, lastError: null, isLoading: false };
}

/**
 * Creates a small result store that keeps the last successful query result
 * visible even after a follow-up query fails.
 *
 * Usage:
 * ```ts
 * const store = createQueryResultStore<Agent[]>();
 * store.onLoading();          // query starts
 * store.onSuccess(agents);    // query succeeded → lastSuccess = agents
 * store.onLoading();          // follow-up query starts
 * store.onError(err);         // follow-up fails → lastSuccess still set
 * ```
 */
export function createQueryResultStore<T>() {
  let state: QueryResultStoreState<T> = initialQueryResultStoreState();

  return {
    get(): QueryResultStoreState<T> {
      return state;
    },

    onLoading(): void {
      state = { ...state, isLoading: true, lastError: null };
    },

    onSuccess(data: T): void {
      state = { lastSuccess: data, lastError: null, isLoading: false };
    },

    onError(error: unknown): void {
      // Keep lastSuccess from the previous successful fetch; update only the
      // error and loading flag.
      state = { ...state, lastError: error, isLoading: false };
    },

    reset(): void {
      state = initialQueryResultStoreState();
    },
  };
// ── F17 — Sanitize query panel input before submit ───────────────────────────
//
// Raw user input may contain leading/trailing whitespace or be entirely blank.
// `sanitizeQuery` trims the string and signals rejection when the result would
// be empty, preventing a wasted round-trip to the API.

export interface SanitizeQueryResult {
  /** The trimmed, submission-ready value. Only present when `valid` is true. */
  query: string;
  /** True when the input is non-empty after trimming. */
  valid: boolean;
}

/**
 * Trims surrounding whitespace from `raw` and returns whether the result is
 * non-empty.  Call this before wiring a form submission to the API; skip the
 * request entirely when `valid` is `false`.
 */
export function sanitizeQuery(raw: string): SanitizeQueryResult {
  const query = raw.trim();
  return { query, valid: query.length > 0 };
}

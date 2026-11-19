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

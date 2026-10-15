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

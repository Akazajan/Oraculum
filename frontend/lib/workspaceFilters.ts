import type { WorkspaceType } from "./types/workspace";

/**
 * The workspace list's filter state, and its two conversions: one to and from
 * the URL (so browser navigation restores the filters) and one to the API query
 * (so clearing a filter really does fetch everything).
 */

export interface WorkspaceFilters {
  search: string;
  type: WorkspaceType | "";
}

export const EMPTY_WORKSPACE_FILTERS: WorkspaceFilters = { search: "", type: "" };

export function isWorkspaceType(
  value: string | null | undefined,
  allowed: readonly WorkspaceType[]
): value is WorkspaceType {
  return typeof value === "string" && allowed.includes(value as WorkspaceType);
}

/** Reads filters out of a URL, ignoring values the app does not recognise. */
export function filtersFromSearchParams(
  params: URLSearchParams,
  allowedTypes: readonly WorkspaceType[]
): WorkspaceFilters {
  const type = params.get("type");

  return {
    search: params.get("search") ?? "",
    type: isWorkspaceType(type, allowedTypes) ? type : "",
  };
}

/**
 * Serialises filters into a query string, omitting empty values so a cleared
 * filter produces a clean URL.
 */
export function searchParamsFromFilters(filters: WorkspaceFilters): string {
  const params = new URLSearchParams();
  const search = filters.search.trim();

  if (search) params.set("search", search);
  if (filters.type) params.set("type", filters.type);

  return params.toString();
}

export function areFiltersEqual(
  a: WorkspaceFilters,
  b: WorkspaceFilters
): boolean {
  return a.search.trim() === b.search.trim() && a.type === b.type;
}

/**
 * Builds the API query. Empty filters are omitted rather than sent as empty
 * strings, which is what makes clearing the search box fetch unfiltered results.
 */
export function toWorkspaceQuery(
  filters: WorkspaceFilters,
  page: number,
  limit: number
): Record<string, string | number> {
  const query: Record<string, string | number> = { page, limit };
  const search = filters.search.trim();

  if (search) query.search = search;
  if (filters.type) query.type = filters.type;

  return query;
}

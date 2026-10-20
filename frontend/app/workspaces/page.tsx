"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { useGetWorkspaces } from "@/lib/react-query/hooks/workspaces/useGetWorkspaces";
import { WorkspaceType } from "@/lib/types/workspace";
import WorkspaceCard from "@/components/workspaces/WorkspaceCard";
import { createDebounced } from "@/lib/debounce";
import {
  filtersFromSearchParams,
  searchParamsFromFilters,
  toWorkspaceQuery,
} from "@/lib/workspaceFilters";
import {
  Search,
  SlidersHorizontal,
  Building2,
  X,
  Loader2,
} from "lucide-react";
import { queryPanelState } from "@/lib/queryPanel";

const WORKSPACE_TYPES: { label: string; value: WorkspaceType | "" }[] = [
  { label: "All Types", value: "" },
  { label: "Coworking", value: "COWORKING" },
  { label: "Private Office", value: "PRIVATE_OFFICE" },
  { label: "Meeting Room", value: "MEETING_ROOM" },
  { label: "Hot Desk", value: "HOT_DESK" },
  { label: "Dedicated Desk", value: "DEDICATED_DESK" },
];

const WORKSPACE_TYPE_VALUES: readonly WorkspaceType[] = WORKSPACE_TYPES.map(
  (t) => t.value
).filter((value): value is WorkspaceType => value !== "");

const PAGE_SIZE = 9;

/**
 * How long typing has to pause before the term is sent to the API. The input
 * stays responsive on every keystroke; only the settled term reaches the query.
 */
const SEARCH_DEBOUNCE_MS = 300;

export default function WorkspacesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [initialFilters] = useState(() =>
    filtersFromSearchParams(
      new URLSearchParams(searchParams.toString()),
      WORKSPACE_TYPE_VALUES
    )
  );

  // `searchInput` is what the box shows; `search` is the settled term the query
  // and the URL are built from.
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [search, setSearch] = useState(initialFilters.search);
  const [type, setType] = useState<WorkspaceType | "">(initialFilters.type);
  const [page, setPage] = useState(1);

  const settleSearch = useMemo(
    () =>
      createDebounced((value: string) => {
        setSearch(value);
        setPage(1);
      }, SEARCH_DEBOUNCE_MS),
    []
  );

  useEffect(() => {
    settleSearch.schedule(searchInput);
    return () => settleSearch.cancel();
  }, [searchInput, settleSearch]);

  // Outbound: the settled filters are the single source of truth for the URL.
  const lastWrittenUrl = useRef<string | null>(null);

  useEffect(() => {
    const next = searchParamsFromFilters({ search, type });
    if (next === searchParams.toString()) return;

    lastWrittenUrl.current = next;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [search, type, pathname, router, searchParams]);

  // Inbound: restoring a URL we did not write (back/forward, or a shared link)
  // puts the controls back the way the URL describes.
  useEffect(() => {
    const current = searchParams.toString();
    if (current === lastWrittenUrl.current) return;

    const fromUrl = filtersFromSearchParams(
      new URLSearchParams(current),
      WORKSPACE_TYPE_VALUES
    );

    setSearchInput(fromUrl.search);
    setSearch(fromUrl.search);
    setType(fromUrl.type);
    setPage(1);
  }, [searchParams]);

  const { data, isLoading, isError, refetch, isFetching } = useGetWorkspaces(
    toWorkspaceQuery({ search, type }, page, PAGE_SIZE)
  );

  const workspaces = data?.data ?? [];
  const meta = data?.meta;

  // One explicit state per outcome, so loading, failure, empty and success can
  // never be mistaken for one another.
  const panel = queryPanelState({
    isLoading,
    isError,
    isEmpty: workspaces.length === 0,
  });

  const hasActiveFilters = search !== "" || type !== "";

  const handleClearFilters = () => {
    settleSearch.cancel();
    setSearchInput("");
    setSearch("");
    setType("");
    setPage(1);
  };

  return (
    <DashboardLayout>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Workspaces</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Browse and book available workspaces.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            placeholder="Search workspaces..."
            aria-label="Search workspaces"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
          {isFetching && !isLoading && (
            <Loader2
              aria-hidden="true"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin"
            />
          )}
        </div>

        <div className="relative">
          <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <select
            aria-label="Filter by workspace type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as WorkspaceType | "");
              setPage(1);
            }}
            className="pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 bg-white appearance-none cursor-pointer"
          >
            {WORKSPACE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <X className="w-4 h-4" />
            Clear Filters
          </button>
        )}
      </div>

      {/* Content */}
      {panel === "loading" ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-100 h-64 animate-pulse"
            />
          ))}
        </div>
      ) : panel === "error" ? (
        <div className="text-center py-16 text-gray-500" role="alert">
          <Building2 className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Failed to load workspaces</p>
          <p className="text-sm mt-1">Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-busy={isFetching}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {isFetching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Retrying…
              </>
            ) : (
              "Try again"
            )}
          </button>
        </div>
      ) : panel === "empty" ? (
        <div className="text-center py-16 text-gray-500">
          <Building2 className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No workspaces found</p>
          <p className="text-sm mt-1">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div aria-busy={isFetching}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {workspaces.map((ws) => (
              <WorkspaceCard key={ws.id} workspace={ws} />
            ))}
          </div>

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between mt-8">
              <p className="text-sm text-gray-500">
                Showing {(page - 1) * PAGE_SIZE + 1}-
                {Math.min(page * PAGE_SIZE, meta.total)} of {meta.total}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>

                <button
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={page === meta.totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { queryKeys } from "@/lib/react-query/keys/queryKeys";
import { Workspace, WorkspaceQuery } from "@/lib/types/workspace";

interface WorkspacesResponse {
  success: boolean;
  data: Workspace[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const useGetWorkspaces = (params: WorkspaceQuery = {}) => {
  const queryString = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)])
  ).toString();

  return useQuery({
    queryKey: queryKeys.workspaces.list(params),
    queryFn: () =>
      apiClient.get<WorkspacesResponse>(
        `/workspaces${queryString ? `?${queryString}` : ""}`
      ),
    // Keep the current page on screen while the next one loads so changing a
    // filter does not flash a skeleton over results that are still valid.
    placeholderData: keepPreviousData,
  });
};

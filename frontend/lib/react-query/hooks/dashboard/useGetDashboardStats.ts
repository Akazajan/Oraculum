"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { queryKeys } from "@/lib/react-query/keys/queryKeys";

export interface DashboardStats {
  totalMembers: number;
  verifiedMembers: number;
  activeWorkspaces: number;
  deskOccupancy: number;
}

interface DashboardStatsResponse {
  success: boolean;
  data: DashboardStats;
}

export const useGetDashboardStats = () =>
  useQuery({
    queryKey: queryKeys.dashboard.stats,
    queryFn: () =>
      apiClient.get<DashboardStatsResponse>("/dashboard/stats"),
  });

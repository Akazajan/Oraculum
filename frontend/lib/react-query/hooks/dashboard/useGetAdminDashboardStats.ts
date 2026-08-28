"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { queryKeys } from "@/lib/react-query/keys/queryKeys";

export interface AdminDashboardStats {
  users: {
    total: number;
    active: number;
    suspended: number;
    newThisMonth: number;
  };
  newsletter: {
    total: number;
    verified: number;
    active: number;
    newThisMonth: number;
    confirmationRate: number;
  };
  registrationTrend: { month: string; count: number }[];
}

interface AdminDashboardStatsResponse {
  success: boolean;
  data: AdminDashboardStats;
}

export const useGetAdminDashboardStats = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.dashboard.adminStats,
    queryFn: () =>
      apiClient.get<AdminDashboardStatsResponse>("/dashboard/admin/stats"),
    enabled,
  });

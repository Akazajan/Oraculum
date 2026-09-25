"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { queryKeys } from "@/lib/react-query/keys/queryKeys";

export interface DashboardActivityItem {
  id: string;
  type: string;
  description: string;
  timestamp: string;
}

interface DashboardActivityResponse {
  success: boolean;
  data: DashboardActivityItem[];
}

export const useGetDashboardActivity = () =>
  useQuery({
    queryKey: queryKeys.dashboard.activity,
    queryFn: () =>
      apiClient.get<DashboardActivityResponse>("/dashboard/activity"),
  });

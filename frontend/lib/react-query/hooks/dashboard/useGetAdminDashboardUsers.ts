"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { queryKeys } from "@/lib/react-query/keys/queryKeys";

export interface DashboardUserRow {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  role: string;
  isActive: boolean;
  isSuspended: boolean;
  isVerified: boolean;
  createdAt: string;
  profilePicture?: string;
}

interface AdminDashboardUsersResponse {
  success: boolean;
  data: DashboardUserRow[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export const useGetAdminDashboardUsers = (page = 1, limit = 10, enabled = true) =>
  useQuery({
    queryKey: queryKeys.dashboard.adminUsers(page, limit),
    queryFn: () =>
      apiClient.get<AdminDashboardUsersResponse>(
        `/dashboard/admin/users?page=${page}&limit=${limit}`,
      ),
    enabled,
  });

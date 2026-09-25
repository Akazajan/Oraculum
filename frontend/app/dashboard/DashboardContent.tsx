"use client";

import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StatsCards from "@/components/dashboard/StatsCards";
import ActivityFeed from "@/components/dashboard/ActivityFeed";
import QuickActions from "@/components/dashboard/QuickActions";
import AnalyticsChart from "@/components/dashboard/AnalyticsChart";
import AdminOverview from "@/components/dashboard/AdminOverview";
import AdminUserTable from "@/components/dashboard/AdminUserTable";
import MemberStatsCards from "@/components/dashboard/MemberStatsCards";
import { useAuthState } from "@/lib/store/authStore";
import { useGetDashboardStats } from "@/lib/react-query/hooks/dashboard/useGetDashboardStats";
import { useGetDashboardActivity } from "@/lib/react-query/hooks/dashboard/useGetDashboardActivity";
import { useGetAdminDashboardStats } from "@/lib/react-query/hooks/dashboard/useGetAdminDashboardStats";
import { useGetAdminDashboardUsers } from "@/lib/react-query/hooks/dashboard/useGetAdminDashboardUsers";

export default function DashboardContent() {
  const { user } = useAuthState();
  const isAdmin = user?.role === "admin";

  const statsQuery = useGetDashboardStats();
  const activityQuery = useGetDashboardActivity();
  const adminStatsQuery = useGetAdminDashboardStats(isAdmin);
  const adminUsersQuery = useGetAdminDashboardUsers(1, 10, isAdmin);

  const isLoading =
    statsQuery.isLoading ||
    activityQuery.isLoading ||
    (isAdmin && (adminStatsQuery.isLoading || adminUsersQuery.isLoading));
  const error =
    statsQuery.error ||
    activityQuery.error ||
    (isAdmin && (adminStatsQuery.error || adminUsersQuery.error));

  const refresh = () => {
    void Promise.all([
      statsQuery.refetch(),
      activityQuery.refetch(),
      isAdmin ? adminStatsQuery.refetch() : Promise.resolve(),
      isAdmin ? adminUsersQuery.refetch() : Promise.resolve(),
    ]);
  };

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {user ? `Welcome back, ${user.firstname}` : "Dashboard"}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Here&apos;s what&apos;s happening in your workspace.
        </p>
      </div>

      {isLoading ? (
        <div
          className="space-y-4"
          aria-busy="true"
          aria-label="Loading dashboard"
        >
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="bg-white rounded-xl border border-gray-100 h-32 animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 p-6"
        >
          <p className="text-sm text-red-700">
            We couldn&apos;t load your dashboard.
          </p>
          <button
            type="button"
            onClick={refresh}
            className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {isAdmin ? (
            <StatsCards stats={statsQuery.data?.data ?? null} />
          ) : (
            <MemberStatsCards />
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            <ActivityFeed activities={activityQuery.data?.data ?? []} />
            <QuickActions />
          </div>

          {isAdmin && (
            <>
              <div className="pt-6 border-t border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Admin panel
                </h2>
              </div>

              <AdminOverview stats={adminStatsQuery.data?.data ?? null} />

              {adminStatsQuery.data?.data?.registrationTrend && (
                <AnalyticsChart
                  data={adminStatsQuery.data.data.registrationTrend}
                />
              )}

              <AdminUserTable
                initialData={adminUsersQuery.data?.data ?? []}
                meta={
                  adminUsersQuery.data?.meta ?? {
                    total: 0,
                    page: 1,
                    limit: 10,
                    totalPages: 0,
                  }
                }
                onRefresh={refresh}
              />
            </>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}

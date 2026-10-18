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
import { queryPanelState } from "@/lib/queryPanel";

function PanelSkeleton({ className }: { className: string }) {
  return (
    <div
      className={`bg-white rounded-xl border border-gray-100 animate-pulse ${className}`}
      aria-busy="true"
    />
  );
}

/**
 * Failure panel for a single dashboard panel. Retrying one panel refetches only
 * that panel, so the others keep whatever they already rendered.
 */
function PanelError({
  label,
  onRetry,
  isRetrying,
}: {
  label: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-6">
      <p className="text-sm text-red-700">We couldn&apos;t load {label}.</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        aria-busy={isRetrying}
        className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
      >
        {isRetrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );
}

export default function DashboardContent() {
  const { user } = useAuthState();
  const isAdmin = user?.role === "admin";

  const statsQuery = useGetDashboardStats();
  const activityQuery = useGetDashboardActivity();
  const adminStatsQuery = useGetAdminDashboardStats(isAdmin);
  const adminUsersQuery = useGetAdminDashboardUsers(1, 10, isAdmin);

  // Each panel derives its own state: a failing query no longer replaces the
  // whole dashboard, and it cannot take the successful panels down with it.
  const statsPanel = queryPanelState({
    isLoading: statsQuery.isLoading,
    isError: Boolean(statsQuery.error),
    isEmpty: false,
  });
  const adminStatsPanel = queryPanelState({
    isLoading: adminStatsQuery.isLoading,
    isError: Boolean(adminStatsQuery.error),
    isEmpty: false,
  });
  const adminUsersPanel = queryPanelState({
    isLoading: adminUsersQuery.isLoading,
    isError: Boolean(adminUsersQuery.error),
    isEmpty: false,
  });

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

      <div className="space-y-6">
        <section aria-label="Workspace statistics">
          {statsPanel === "loading" ? (
            <PanelSkeleton className="h-32" />
          ) : statsPanel === "error" ? (
            <PanelError
              label="your statistics"
              onRetry={() => void statsQuery.refetch()}
              isRetrying={statsQuery.isFetching}
            />
          ) : isAdmin ? (
            <StatsCards stats={statsQuery.data?.data ?? null} />
          ) : (
            <MemberStatsCards />
          )}
        </section>

        <div className="grid lg:grid-cols-2 gap-6">
          <ActivityFeed
            activities={activityQuery.data?.data ?? []}
            isLoading={activityQuery.isLoading}
            error={activityQuery.error}
            onRetry={() => void activityQuery.refetch()}
            isRetrying={activityQuery.isFetching}
          />
          <QuickActions />
        </div>

        {isAdmin && (
          <>
            <div className="pt-6 border-t border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Admin panel
              </h2>
            </div>

            <section aria-label="Admin overview">
              {adminStatsPanel === "loading" ? (
                <PanelSkeleton className="h-32" />
              ) : adminStatsPanel === "error" ? (
                <PanelError
                  label="the admin overview"
                  onRetry={() => void adminStatsQuery.refetch()}
                  isRetrying={adminStatsQuery.isFetching}
                />
              ) : (
                <>
                  <AdminOverview stats={adminStatsQuery.data?.data ?? null} />

                  {adminStatsQuery.data?.data?.registrationTrend && (
                    <AnalyticsChart
                      data={adminStatsQuery.data.data.registrationTrend}
                    />
                  )}
                </>
              )}
            </section>

            <section aria-label="Member administration">
              {adminUsersPanel === "loading" ? (
                <PanelSkeleton className="h-40" />
              ) : adminUsersPanel === "error" ? (
                <PanelError
                  label="the member table"
                  onRetry={() => void adminUsersQuery.refetch()}
                  isRetrying={adminUsersQuery.isFetching}
                />
              ) : (
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
                  onRefresh={() => void adminUsersQuery.refetch()}
                />
              )}
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

"use client";

import { UserPlus, UserCheck } from "lucide-react";

export interface ActivityItem {
  id: string;
  type: string;
  description: string;
  timestamp: string;
}

interface ActivityFeedProps {
  activities: ActivityItem[];
  /** This panel owns its states, so a failed sibling query cannot hide it. */
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export default function ActivityFeed({
  activities,
  isLoading = false,
  error,
  onRetry,
  isRetrying = false,
}: ActivityFeedProps) {
  const header = (
    <h3 className="text-sm font-semibold text-gray-900 mb-4">Recent activity</h3>
  );

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        {header}
        <div
          className="space-y-3"
          aria-busy="true"
          aria-label="Loading recent activity"
        >
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-10 rounded-lg bg-gray-50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        {header}
        <div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            We couldn&apos;t load recent activity.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="mt-2 text-sm font-medium text-red-700 underline disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              {isRetrying ? "Retrying…" : "Try again"}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!activities.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        {header}
        <p className="text-sm text-gray-400">No recent activity.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      {header}
      <div className="space-y-4">
        {activities.slice(0, 6).map((item) => {
          const Icon = item.type === "member_verified" ? UserCheck : UserPlus;
          return (
            <div key={item.id} className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="w-3.5 h-3.5 text-gray-500" />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-gray-700">{item.description}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(item.timestamp).toLocaleDateString("en", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client"; // Next.js: render on the client (uses state and React Query hooks)

import { useState } from "react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
// Data hooks (React Query): fetch a page of notifications and mutate read state
import { useGetNotifications } from "@/lib/react-query/hooks/notifications/useGetNotifications";
import { useMarkNotificationRead } from "@/lib/react-query/hooks/notifications/useMarkNotificationRead";
import { useMarkAllRead } from "@/lib/react-query/hooks/notifications/useMarkAllRead";
import { Notification } from "@/lib/types/notification";
import {
  Bell,
  CheckCheck,
  CreditCard,
  BookOpen,
  AlertCircle,
  Info,
} from "lucide-react";

// Picks an icon and colour based on the notification type
function NotificationIcon({ type }: { type: Notification["type"] }) {
  const cls = "w-4 h-4"; // shared size classes for every icon
  switch (type) {
    case "PAYMENT_SUCCESS":
      return <CreditCard className={`${cls} text-emerald-600`} />;
    case "PAYMENT_FAILED":
      return <AlertCircle className={`${cls} text-red-500`} />;
    case "BOOKING_CONFIRMED":
      return <BookOpen className={`${cls} text-blue-500`} />;
    case "BOOKING_CANCELLED":
      return <BookOpen className={`${cls} text-orange-500`} />;
    // Any other/unknown type falls back to a neutral info icon
    default:
      return <Info className={`${cls} text-gray-400`} />;
  }
}

// Converts an ISO timestamp into a short relative label ("5m ago", "3h ago", "2d ago")
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime(); // elapsed milliseconds
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`; // no week/month rollup: old items show e.g. "45d ago"
}

export default function NotificationsPage() {
  // Current page number (1-based); changing it triggers a new fetch
  const [page, setPage] = useState(1);
  // Fetch `page` with 20 items per page
  const { data, isLoading, isError, refetch } = useGetNotifications(page, 20);
  // Mutations for marking a single notification / all notifications as read
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();

  // Fall back to an empty list while data is undefined
  const notifications = data?.data ?? [];
  // Pagination info plus the total unread count
  const meta = data?.meta;

  return (
    <DashboardLayout>
      {/* Page header: title, unread summary, and "Mark all read" action */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {meta?.unreadCount
              ? `${meta.unreadCount} unread`
              : "All caught up"}
          </p>
        </div>
        {/* Only show the button when there is something to mark as read */}
        {(meta?.unreadCount ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending} // prevent double-submits while the request is in flight
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <CheckCheck className="w-4 h-4" />
            Mark all read
          </button>
        )}
      </div>

      {/* Body has four mutually exclusive states: loading, error, empty, list */}
      {isLoading ? (
        // Loading: four pulsing placeholder cards (skeleton UI)
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-100 h-20 animate-pulse"
            />
          ))}
        </div>
      ) : isError ? (
        // Error: message with a retry button that refetches the query
        <div className="text-center py-16 text-gray-500">
          <Bell className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Failed to load notifications</p>
          <p className="text-sm mt-1">Please try again later.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 text-sm text-gray-900 font-medium hover:underline"
          >
            Retry
          </button>
        </div>
      ) : notifications.length === 0 ? (
        // Empty state: the user has no notifications at all
        <div className="text-center py-16 text-gray-500">
          <Bell className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No notifications yet</p>
          <p className="text-sm mt-1">
            You&apos;ll be notified about bookings, payments, and more.
          </p>
        </div>
      ) : (
        // Populated list of notification cards
        <div className="space-y-2 max-w-2xl">
          {notifications.map((n) => (
            <div
              key={n.id}
              // Unread items get a slightly darker border and tinted background
              className={`bg-white rounded-xl border p-4 flex items-start gap-3 transition-colors ${
                n.isRead
                  ? "border-gray-100"
                  : "border-gray-200 bg-gray-50/50"
              }`}
            >
              {/* Type icon in a small rounded badge */}
              <span className="w-8 h-8 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                <NotificationIcon type={n.type} />
              </span>
              {/* Text content; min-w-0 lets long messages wrap instead of overflowing */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {timeAgo(n.createdAt)}
                </p>
              </div>
              {/* Unread indicator dot, doubling as a "mark as read" button */}
              {!n.isRead && (
                <button
                  type="button"
                  onClick={() => markRead.mutate(n.id)}
                  className="shrink-0 text-xs text-gray-400 hover:text-gray-700 transition-colors pt-1"
                  title="Mark as read"
                >
                  <span className="w-2 h-2 rounded-full bg-gray-900 block" />
                </button>
              )}
            </div>
          ))}

          {/* Pagination */}
          {/* Hidden when everything fits on one page */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <button
                type="button"
                // Math.max/min keep the page within [1, totalPages]
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-gray-400">
                Page {page} of {meta.totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                disabled={page === meta.totalPages}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
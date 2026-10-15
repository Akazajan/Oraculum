"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import {
  bookingAffectedKeys,
  queryKeys,
} from "@/lib/react-query/keys/queryKeys";
import { Booking } from "@/lib/types/booking";
import { toast } from "sonner";

export const useCancelBooking = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bookingId: string) =>
      apiClient.patch<{ success: boolean; data: Booking }>(
        `/bookings/${bookingId}/cancel`
      ),
    onSuccess: async (_response, bookingId) => {
      // Cancelling frees seats, so the workspace caches are reconciled alongside
      // the booking caches. The booking's own detail entry is covered by the
      // `bookings` prefix, but is invalidated explicitly so the intent is clear.
      await Promise.all([
        ...bookingAffectedKeys.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey })
        ),
        queryClient.invalidateQueries({
          queryKey: queryKeys.bookings.detail(bookingId),
        }),
      ]);
      toast.success("Booking cancelled");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to cancel booking");
    },
  });
};

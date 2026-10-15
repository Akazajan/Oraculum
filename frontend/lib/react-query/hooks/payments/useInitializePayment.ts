"use client";

import { useCallback, useReducer } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { InitializePaymentResponse } from "@/lib/types/payment";
import {
  initialPaymentAttemptState,
  paymentAttemptReducer,
} from "@/lib/paymentAttempt";
import { toast } from "sonner";

/**
 * Starts a payment and tracks the attempt's lifecycle.
 *
 * The caller drives the provider transitions (`markSubmitted`,
 * `markProviderClosed`, `markConfirmed`) so the UI can distinguish "window
 * opened" from "payment confirmed" — success is never shown early.
 */
export const useInitializePayment = () => {
  const [attempt, dispatch] = useReducer(
    paymentAttemptReducer,
    initialPaymentAttemptState
  );

  const mutation = useMutation({
    mutationFn: (bookingId: string) =>
      apiClient.post<{ success: boolean; data: InitializePaymentResponse }>(
        "/payments/initialize",
        { bookingId }
      ),
    onMutate: () => {
      dispatch({ type: "initialize" });
    },
    onSuccess: () => {
      dispatch({ type: "initialized" });
    },
    onError: (error: Error) => {
      dispatch({ type: "failed", message: error?.message });
      toast.error(error?.message || "Failed to initialize payment");
    },
  });

  const markSubmitted = useCallback(() => dispatch({ type: "submitted" }), []);
  const markProviderClosed = useCallback(
    () => dispatch({ type: "provider-closed" }),
    []
  );
  const markConfirmed = useCallback(() => dispatch({ type: "confirmed" }), []);
  const markCancelled = useCallback(() => dispatch({ type: "cancelled" }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return {
    ...mutation,
    attempt,
    markSubmitted,
    markProviderClosed,
    markConfirmed,
    markCancelled,
    reset,
  };
};

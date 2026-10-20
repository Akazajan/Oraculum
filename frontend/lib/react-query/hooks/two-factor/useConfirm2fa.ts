"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiClient } from "@/lib/apiClient";
import { queryKeys } from "@/lib/react-query/keys/queryKeys";
import { toast } from "sonner";

interface Confirm2faResponse {
  success: boolean;
  data: {
    backupCodes: string[];
  };
}

export const INVALID_2FA_CODE_MESSAGE =
  "That code didn't work. Check your authenticator app and try again.";
export const RATE_LIMITED_2FA_MESSAGE =
  "Too many attempts. Wait a moment, then try again.";
export const EXPIRED_2FA_CHALLENGE_MESSAGE =
  "This verification request has expired. Sign in again to get a new code.";
export const UNKNOWN_2FA_ERROR_MESSAGE =
  "We couldn't verify that code. Please try again.";

/**
 * Single description of a failed 2FA step, shared by the setup modal and the
 * sign-in challenge so both surfaces explain the same failure the same way.
 *
 * The three outcomes a user can act on are told apart explicitly — invalid
 * code, rate limited, and an expired challenge — because each one needs a
 * different response (retype, wait, start over).
 */
export function describeTwoFactorError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return RATE_LIMITED_2FA_MESSAGE;
    if (error.status === 408 || error.status === 410) {
      return EXPIRED_2FA_CHALLENGE_MESSAGE;
    }
    if (
      error.status === 400 ||
      error.status === 401 ||
      error.status === 403 ||
      error.status === 422
    ) {
      return INVALID_2FA_CODE_MESSAGE;
    }
    return error.message || UNKNOWN_2FA_ERROR_MESSAGE;
  }

  if (error instanceof Error && error.message) return error.message;
  return UNKNOWN_2FA_ERROR_MESSAGE;
}

export const useConfirm2fa = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) =>
      apiClient.post<Confirm2faResponse>("/auth/2fa/confirm", { token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.twoFactor.status });
      toast.success("Two-factor authentication enabled");
    },
    onError: (error: Error) => {
      toast.error(describeTwoFactorError(error));
    },
  });
};

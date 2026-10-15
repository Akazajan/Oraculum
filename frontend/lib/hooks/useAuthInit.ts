"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "../apiClient";
import { useAuthActions } from "../store/authStore";

/**
 * Restores the persisted session and connects the API client's 401 flow to the
 * auth store, so an expired access token is refreshed once and replayed, while a
 * failed refresh clears the session and sends the user back to login.
 */
export const useAuthInit = () => {
  const router = useRouter();
  const { initializeAuth, refreshAccessToken, clearAuth } = useAuthActions();

  useEffect(() => {
    apiClient.configureAuth({
      refreshToken: () => refreshAccessToken(),
      onRefreshFailed: () => {
        clearAuth();
        router.push("/login");
      },
    });

    return () => apiClient.configureAuth(null);
  }, [clearAuth, refreshAccessToken, router]);

  useEffect(() => {
    initializeAuth(); // loads token + user from storage into Zustand
  }, [initializeAuth]);
};

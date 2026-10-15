"use client";
import { useAuthInit } from "@/lib/hooks/useAuthInit";
import { bindApiClientToAuthStore } from "@/lib/store/authStore";
import { ReactNode, useEffect } from "react";

interface AuthInitializerProviderProps {
  children: ReactNode;
}

export const AuthInitializerProvider = ({
  children,
}: AuthInitializerProviderProps) => {
  useAuthInit(); // triggers auth initialization on mount

  // Keeps the API client's Authorization header derived from the store, so a
  // logout clears it and a fresh login cannot reuse the old token.
  useEffect(() => bindApiClientToAuthStore(), []);

  return <>{children}</>; // renders nothing extra
};

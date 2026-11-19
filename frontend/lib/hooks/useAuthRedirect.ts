"use client";

import { useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthState } from '../store/authStore';

// Options a page passes in to describe its access rules
interface AuthRedirectOptions {
  // If true, only authenticated users may view the page
  requireAuth?: boolean;
  // If set, the user must also have this role
  requiredRole?: "admin" | "user";
  // Where unauthenticated users are sent (defaults to the login page)
  redirectTo?: string;
  // If set, already-authenticated users are sent here (e.g. away from /login)
  redirectIfAuthenticated?: string;
}

// What the hook gives back to the calling component
interface AuthRedirectReturn {
  // True while the auth state is still being resolved (e.g. checking a stored token)
  isLoading: boolean;
  isAuthenticated: boolean;
  // Typed as `any`, so callers get no type safety on the user object
  user: any;
  // Whether the current user is allowed to see the page; components can use this
  // to avoid rendering protected content while a redirect is in progress
  canAccess: boolean;
}

// Hook that protects a page: it computes whether the user may access it and
// redirects them when they may not. Usage:
//   useAuthRedirect({ requireAuth: true, requiredRole: 'admin' })
//   useAuthRedirect({ redirectIfAuthenticated: '/dashboard' }) // on the login page
export const useAuthRedirect = (options: AuthRedirectOptions = {}): AuthRedirectReturn => {
  // Pull out the options and apply defaults
  const {
    requireAuth = false,
    requiredRole,
    redirectTo = '/auth/login',
    redirectIfAuthenticated
  } = options;

  // Router for client-side navigation
  const router = useRouter();
  // Reads the URL query string (used for the ?redirect= parameter)
  const searchParams = useSearchParams();
  // Current auth state from the store
  const { user, isAuthenticated, isLoading } = useAuthState();

  // Compute access permissions
  // Memoized so it's only recalculated when the relevant inputs change
  const canAccess = useMemo(() => {
    // If page doesn't require auth, anyone can access
    if (!requireAuth) return true;
    
    // If authentication is required but user is not authenticated
    if (requireAuth && !isAuthenticated) return false;
    
    // If specific role is required, check user role
    if (requiredRole && user?.role !== requiredRole) return false;
    
    return true;
  }, [requireAuth, isAuthenticated, requiredRole, user?.role]);

  // Side effect: perform the actual redirects. Runs whenever auth state or options change
  useEffect(() => {
    // Don't redirect while loading
    // Otherwise a logged-in user would be briefly bounced to the login page
    // before their stored session has been checked
    if (isLoading) return;

    // Current path for redirect after login
    // Uses window.location so the path is read at redirect time, outside React state
    const currentPath = window.location.pathname;
    
    // Redirect authenticated users away from certain pages (like login)
    if (isAuthenticated && redirectIfAuthenticated) {
      // Honor ?redirect= if present (e.g. returning to the page they came from),
      // otherwise use the configured default
      const redirectPath = searchParams.get('redirect') || redirectIfAuthenticated;
      router.push(redirectPath);
      return;
    }

    // Redirect unauthenticated users to login
    if (requireAuth && !isAuthenticated) {
      // Pass the current path along so the login flow can send them back after signing in
      const loginUrl = `${redirectTo}?redirect=${encodeURIComponent(currentPath)}`;
      router.push(loginUrl);
      return;
    }

    // Redirect users without required role to dashboard
    // Authenticated but not authorized, so send them somewhere safe instead of the login page
    if (isAuthenticated && requiredRole && user?.role !== requiredRole) {
      router.push('/dashboard');
      return;
    }
  }, [
    // Effect re-runs if any of these change
    isLoading, 
    isAuthenticated, 
    requireAuth, 
    requiredRole, 
    user?.role, 
    redirectTo, 
    redirectIfAuthenticated, 
    router, 
    searchParams
  ]);

  // Expose the state so components can show loaders or hide protected content
  return {
    isLoading,
    isAuthenticated,
    user,
    canAccess
  };
};
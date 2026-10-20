import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAuthStore } from "@/lib/store/authStore";
import { toast } from "sonner";

// Shape of the data submitted by the login form
type LoginBody = {
  email: string;
  password: string;
  rememberMe: boolean;
};

// Custom hook that encapsulates the login flow: calling the auth store,
// showing toast feedback, tracking loading state, and redirecting afterwards
export function useLogin() {
  // Router for client-side navigation after a successful login
  const router = useRouter();
  // Reads the URL query string (e.g. /login?redirect=/settings)
  const searchParams = useSearchParams();
  // Select only the `login` action from the store, so this component
  // doesn't re-render when unrelated auth state changes
  const login = useAuthStore((s) => s.login);

  // True while the login request is in flight; useful for disabling the submit button
  const [loading, setLoading] = useState(false);

  const handleLogin = async (payload: LoginBody) => {
    setLoading(true);

    try {
      // Only email and password are sent; `rememberMe` is not passed to the store
      await login({ email: payload.email, password: payload.password });

      toast.success("Login successful");

      // If the user was sent here from a protected page, return them there
      const redirect = searchParams.get("redirect");
      if (redirect) {
        router.push(redirect);
      } else {
        // Otherwise go to the default landing page
        router.push("/dashboard");
      }
    } catch (err) {
      // Show the error's message if there is one, otherwise a generic fallback
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      toast.error(msg);
    } finally {
      // Always clear the loading state, whether login succeeded or failed
      setLoading(false);
    }
  };
  // ...compat.extends("next/core-web-vitals", "next/typescript"),
  // (Stray comment: this looks like a leftover ESLint config line and has nothing to do with this hook)

  // Expose the handler (renamed to `login`) and the loading flag to the component
  return { login: handleLogin, loading };
}
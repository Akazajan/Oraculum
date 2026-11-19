"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { apiClient } from "@/lib/apiClient";
import { useAuthStore } from "@/lib/store/authStore";
import { storage } from "@/lib/storage";
import { Shield, ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { describeTwoFactorError } from "@/lib/react-query/hooks/two-factor/useConfirm2fa";

type ChallengeMode = "totp" | "backup";

const CODE_HINT_ID = "verify-2fa-code-hint";
const CODE_ERROR_ID = "verify-2fa-code-error";
const CHALLENGE_STATUS_ID = "verify-2fa-status";

function Verify2FAForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tempToken = searchParams.get("tempToken") ?? "";
  const email = searchParams.get("email") ?? "";

  const [mode, setMode] = useState<ChallengeMode>("totp");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // A missing temporary token cannot be completed: the user has to sign in
  // again to be issued a fresh challenge.
  const hasChallenge = tempToken.trim().length > 0;
  const isTotp = mode === "totp";
  const codeComplete = isTotp ? code.length === 6 : code.trim().length >= 6;
  const canSubmit = hasChallenge && codeComplete && !isSubmitting;

  useEffect(() => {
    codeInputRef.current?.focus();
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setStatus(
      isTotp
        ? "Verifying your authentication code…"
        : "Verifying your backup code…"
    );
    setIsSubmitting(true);

    try {
      const endpoint = isTotp ? "/auth/2fa/verify" : "/auth/2fa/backup-code";
      const body = isTotp
        ? { token: code.trim(), tempToken }
        : { backupCode: code.trim(), tempToken };

      const response = await apiClient.post<{
        user: any;
        accessToken: string;
        backupCodesRemaining?: number;
      }>(endpoint, body);

      apiClient.setToken(response.accessToken);
      useAuthStore.getState().setUser(response.user);
      useAuthStore.getState().setToken(response.accessToken);
      storage.setToken(response.accessToken);
      storage.setUser(response.user);

      if (!isTotp && response.backupCodesRemaining !== undefined) {
        const remaining = response.backupCodesRemaining;
        setStatus(
          `Backup code accepted. ${remaining} backup ${
            remaining === 1 ? "code" : "codes"
          } remaining. Signing you in…`
        );
        toast.success(`Signed in. ${remaining} backup codes remaining.`);
      } else {
        setStatus("Code accepted. Signing you in…");
        toast.success("Signed in successfully");
      }

      // Success continues the auth flow.
      router.push("/dashboard");
    } catch (caught) {
      const message = describeTwoFactorError(caught);
      setError(message);
      setStatus(null);
      toast.error(message);
      // Keyboard users land back on the field they need to correct.
      codeInputRef.current?.focus();
      codeInputRef.current?.select();
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((current) => (current === "totp" ? "backup" : "totp"));
    setCode("");
    setError(null);
    setStatus(null);
  };

  return (
    <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-gray-100 p-4 rounded-full">
              <Shield className="h-10 w-10 text-gray-700" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">
            Two-factor verification
          </h2>
          <p className="mt-2 text-gray-600">
            {isTotp
              ? "Enter the 6-digit code from your authenticator app."
              : "Enter one of your saved backup codes."}
          </p>
          {email && (
            <p className="mt-1 text-sm text-gray-400">
              Signing in as{" "}
              <span className="font-medium text-gray-700">{email}</span>
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          {!hasChallenge && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This verification request is no longer valid.{" "}
                <Link href="/login" className="font-medium underline">
                  Sign in again
                </Link>{" "}
                to start a new one.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label
                htmlFor="verify-2fa-code"
                className="block text-xs font-medium text-gray-500 mb-1.5"
              >
                {isTotp ? "Authentication code" : "Backup code"}
              </label>
              <input
                id="verify-2fa-code"
                ref={codeInputRef}
                type="text"
                inputMode={isTotp ? "numeric" : "text"}
                autoComplete={isTotp ? "one-time-code" : "off"}
                maxLength={isTotp ? 6 : 20}
                value={code}
                disabled={!hasChallenge || isSubmitting}
                aria-invalid={error ? true : undefined}
                aria-describedby={
                  [CODE_HINT_ID, error ? CODE_ERROR_ID : null]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onChange={(e) => {
                  setError(null);
                  setCode(
                    isTotp
                      ? e.target.value.replace(/\D/g, "")
                      : e.target.value
                  );
                }}
                placeholder={isTotp ? "000000" : "e.g. a1b2c3d4e5"}
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 text-center font-mono ${
                  isTotp ? "text-lg tracking-widest" : "tracking-normal text-base"
                } ${
                  error ? "border-red-300 focus:ring-red-200" : "border-gray-200"
                }`}
              />
              <p id={CODE_HINT_ID} className="mt-1.5 text-xs text-gray-400">
                {isTotp
                  ? "6 digits from your authenticator app."
                  : "Each backup code can only be used once."}
              </p>
              {error && (
                <p
                  id={CODE_ERROR_ID}
                  role="alert"
                  className="mt-1.5 flex items-start gap-1.5 text-xs text-red-600"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              aria-busy={isSubmitting}
              className="w-full bg-gray-900 text-white py-3 px-4 rounded-lg font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Verifying...
                </>
              ) : (
                "Verify & sign in"
              )}
            </button>

            {/* Progress and success are announced without moving focus. */}
            <p
              id={CHALLENGE_STATUS_ID}
              role="status"
              aria-live="polite"
              className="min-h-4 text-center text-xs text-gray-500"
            >
              {status ?? ""}
            </p>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={switchMode}
              disabled={isSubmitting || !hasChallenge}
              aria-describedby={CODE_HINT_ID}
              className="text-sm text-gray-500 hover:text-gray-900 underline transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isTotp
                ? "Use a backup code instead"
                : "Use authenticator app instead"}
            </button>
          </div>

          <div className="mt-4 text-center">
            <Link
              href="/login"
              className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to sign in
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400">
          &copy; 2026 Oraculum. All rights reserved.
        </p>
      </div>
    </div>
  );
}

export default function Verify2FAPage() {
  return (
    <Suspense>
      <Verify2FAForm />
    </Suspense>
  );
}

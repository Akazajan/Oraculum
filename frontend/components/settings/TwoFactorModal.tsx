"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X, Shield, Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import { useSetup2fa } from "@/lib/react-query/hooks/two-factor/useSetup2fa";
import {
  describeTwoFactorError,
  useConfirm2fa,
} from "@/lib/react-query/hooks/two-factor/useConfirm2fa";
import { useDisable2fa } from "@/lib/react-query/hooks/two-factor/useDisable2fa";

type Mode = "setup" | "disable";

interface Props {
  mode: Mode;
  onClose: () => void;
}

const TITLE_ID = "two-factor-modal-title";
const TOKEN_HINT_ID = "two-factor-token-hint";
const TOKEN_ERROR_ID = "two-factor-token-error";
const MODAL_STATUS_ID = "two-factor-modal-status";

export default function TwoFactorModal({ mode, onClose }: Props) {
  const setup2fa = useSetup2fa();
  const confirm2fa = useConfirm2fa();
  const disable2fa = useDisable2fa();

  // Setup flow state
  const [step, setStep] = useState<"qr" | "verify" | "backup">("qr");
  const [qrData, setQrData] = useState<{
    secret: string;
    qrCodeDataUrl: string;
  } | null>(null);
  const [totpToken, setTotpToken] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  // Disable flow state
  const [password, setPassword] = useState("");
  // Text for the polite live region: what is happening or what just happened.
  const [status, setStatus] = useState<string | null>(null);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  // Keyboard support: Escape closes the dialog from anywhere inside it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Move focus into the dialog so keyboard and screen-reader users start here.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Focus the field a rejected code has to be corrected in.
  useEffect(() => {
    if (step === "verify" && confirm2fa.isError) {
      tokenInputRef.current?.focus();
      tokenInputRef.current?.select();
    }
  }, [confirm2fa.isError, step]);

  const confirmErrorMessage = confirm2fa.isError
    ? describeTwoFactorError(confirm2fa.error)
    : null;
  const setupErrorMessage = setup2fa.isError
    ? describeTwoFactorError(setup2fa.error)
    : null;
  const disableErrorMessage = disable2fa.isError
    ? describeTwoFactorError(disable2fa.error)
    : null;

  const handleStartSetup = async () => {
    setStatus("Generating your setup key…");
    try {
      const res = await setup2fa.mutateAsync();
      setQrData(res.data);
      setStep("qr");
      setStatus("Setup key ready. Scan the QR code, then enter the code it generates.");
    } catch {
      setStatus(null);
    }
  };

  const handleConfirm = async () => {
    setStatus("Verifying your authentication code…");
    try {
      const res = await confirm2fa.mutateAsync(totpToken);
      setBackupCodes(res.data.backupCodes);
      setStep("backup");
      setStatus(
        `Two-factor authentication enabled. ${res.data.backupCodes.length} backup codes generated.`
      );
    } catch {
      setStatus(null);
    }
  };

  const handleDisable = async () => {
    setStatus("Disabling two-factor authentication…");
    try {
      await disable2fa.mutateAsync(password);
      onClose();
    } catch {
      setStatus(null);
    }
  };

  const handleCopySecret = () => {
    if (qrData?.secret) {
      navigator.clipboard.writeText(qrData.secret);
      setCopied(true);
      setStatus("Setup key copied to the clipboard.");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopied(true);
    setStatus("Backup codes copied to the clipboard.");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={MODAL_STATUS_ID}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 relative overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-gray-600" />
            <h2 id={TITLE_ID} className="text-sm font-semibold text-gray-900">
              {mode === "setup"
                ? "Set up two-factor authentication"
                : "Disable two-factor authentication"}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close two-factor authentication dialog"
            className="p-1 rounded-md hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          {/* ── DISABLE FLOW ── */}
          {mode === "disable" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 bg-orange-50 border border-orange-100 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                <p className="text-xs text-orange-700">
                  Disabling 2FA will make your account less secure. Enter your
                  password to confirm.
                </p>
              </div>

              <div>
                <label
                  htmlFor="two-factor-password"
                  className="block text-xs font-medium text-gray-500 mb-1.5"
                >
                  Your password
                </label>
                <input
                  id="two-factor-password"
                  type="password"
                  value={password}
                  disabled={disable2fa.isPending}
                  aria-invalid={disableErrorMessage ? true : undefined}
                  aria-describedby={
                    disableErrorMessage ? TOKEN_ERROR_ID : undefined
                  }
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 ${
                    disableErrorMessage ? "border-red-300" : "border-gray-200"
                  }`}
                />
                {disableErrorMessage && (
                  <p
                    id={TOKEN_ERROR_ID}
                    role="alert"
                    className="mt-1.5 text-xs text-red-600"
                  >
                    {disableErrorMessage}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleDisable}
                  disabled={!password || disable2fa.isPending}
                  aria-busy={disable2fa.isPending}
                  className="flex-1 px-5 py-2.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {disable2fa.isPending ? "Disabling..." : "Disable 2FA"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-5 py-2.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── SETUP FLOW — Step 0: initiate ── */}
          {mode === "setup" && !qrData && step !== "backup" && (
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto">
                <Shield className="w-6 h-6 text-gray-500" />
              </div>
              <p className="text-sm text-gray-600">
                Use an authenticator app like Google Authenticator or Authy to
                scan a QR code and generate time-based codes.
              </p>
              {setupErrorMessage && (
                <p
                  role="alert"
                  className="flex items-start justify-center gap-1.5 text-xs text-red-600"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{setupErrorMessage}</span>
                </p>
              )}
              <button
                type="button"
                onClick={handleStartSetup}
                disabled={setup2fa.isPending}
                aria-busy={setup2fa.isPending}
                className="w-full px-5 py-2.5 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {setup2fa.isPending ? "Generating..." : "Get started"}
              </button>
            </div>
          )}

          {/* ── SETUP FLOW — Step 1: QR code ── */}
          {mode === "setup" && qrData && step === "qr" && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Scan this QR code with your authenticator app, then click
                &ldquo;Next&rdquo; to verify.
              </p>

              {/* QR code */}
              <div className="flex justify-center">
                <div className="p-3 border border-gray-200 rounded-xl">
                  <Image
                    src={qrData.qrCodeDataUrl}
                    alt="QR code for setting up two-factor authentication"
                    width={160}
                    height={160}
                    unoptimized
                  />
                </div>
              </div>

              {/* Manual entry */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">
                  Can&apos;t scan? Enter this key manually:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg font-mono break-all">
                    {qrData.secret}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopySecret}
                    aria-label="Copy setup key"
                    className="shrink-0 p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    {copied ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStep("verify")}
                className="w-full px-5 py-2.5 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors"
              >
                Next — enter the code
              </button>
            </div>
          )}

          {/* ── SETUP FLOW — Step 2: verify TOTP ── */}
          {mode === "setup" && step === "verify" && (
            <div className="space-y-4" aria-busy={confirm2fa.isPending}>
              <p className="text-xs text-gray-500">
                Enter the 6-digit code from your authenticator app to confirm
                setup.
              </p>

              <div>
                <label
                  htmlFor="two-factor-token"
                  className="block text-xs font-medium text-gray-500 mb-1.5"
                >
                  Authentication code
                </label>
                <input
                  id="two-factor-token"
                  ref={tokenInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpToken}
                  disabled={confirm2fa.isPending}
                  aria-invalid={confirmErrorMessage ? true : undefined}
                  aria-describedby={
                    [TOKEN_HINT_ID, confirmErrorMessage ? TOKEN_ERROR_ID : null]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className={`w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 text-center tracking-widest font-mono text-lg ${
                    confirmErrorMessage ? "border-red-300" : "border-gray-200"
                  }`}
                />
                <p id={TOKEN_HINT_ID} className="mt-1.5 text-xs text-gray-400">
                  6 digits from your authenticator app.
                </p>
                {confirmErrorMessage && (
                  <p
                    id={TOKEN_ERROR_ID}
                    role="alert"
                    className="mt-1.5 flex items-start gap-1.5 text-xs text-red-600"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{confirmErrorMessage}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setStep("qr")}
                  disabled={confirm2fa.isPending}
                  className="flex-1 px-5 py-2.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={totpToken.length !== 6 || confirm2fa.isPending}
                  aria-busy={confirm2fa.isPending}
                  className="flex-1 px-5 py-2.5 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {confirm2fa.isPending ? "Verifying..." : "Enable 2FA"}
                </button>
              </div>
            </div>
          )}

          {/* ── SETUP FLOW — Step 3: backup codes ── */}
          {mode === "setup" && step === "backup" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700">
                  Save these backup codes in a safe place. Each can only be
                  used once if you lose access to your authenticator.
                </p>
              </div>

              <div
                role="group"
                aria-label={`${backupCodes.length} backup codes`}
                className="bg-gray-50 border border-gray-200 rounded-lg p-4"
              >
                <div className="grid grid-cols-2 gap-1.5">
                  {backupCodes.map((code) => (
                    <code
                      key={code}
                      className="text-xs font-mono text-gray-700 bg-white border border-gray-100 rounded px-2 py-1 text-center"
                    >
                      {code}
                    </code>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyBackupCodes}
                className="w-full flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {copied ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copied ? "Copied!" : "Copy backup codes"}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full px-5 py-2.5 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors"
              >
                Done
              </button>
            </div>
          )}

          {/* Pending, success and recovery outcomes are announced politely. */}
          <p
            id={MODAL_STATUS_ID}
            role="status"
            aria-live="polite"
            className="mt-4 min-h-4 text-center text-xs text-gray-500"
          >
            {status ?? ""}
          </p>
        </div>
      </div>
    </div>
  );
}

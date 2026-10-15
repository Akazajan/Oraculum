'use client';

import { useEffect, useReducer } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  DEFAULT_RESEND_COOLDOWN_SECONDS,
  canRequestOtpResend,
  initialOtpResendState,
  otpResendLabel,
  otpResendReducer,
} from '@/lib/otpResend';

export interface ResendButtonProps {
  /**
   * Performs the resend request. It must reject when the request fails so the
   * control can surface the failure through its live region.
   */
  onResend: () => Promise<void>;
  /** Seconds the control stays disabled after a successful request. */
  cooldownSeconds?: number;
  /** Class names applied to the wrapping element. */
  className?: string;
}

const ResendButton = ({
  onResend,
  cooldownSeconds = DEFAULT_RESEND_COOLDOWN_SECONDS,
  className,
}: ResendButtonProps) => {
  const [state, dispatch] = useReducer(otpResendReducer, initialOtpResendState);
  const canRequest = canRequestOtpResend(state);

  // Drives the cooldown countdown one second at a time.
  useEffect(() => {
    if (state.status !== 'cooldown') return;
    const timer = setTimeout(() => dispatch({ type: 'tick' }), 1000);
    return () => clearTimeout(timer);
  }, [state.status, state.secondsRemaining]);

  const handleClick = async () => {
    // The button is disabled in every non-resting state; this guard makes the
    // no-duplicate-request guarantee independent of that rendering detail.
    if (!canRequest) return;

    dispatch({ type: 'request' });
    try {
      await onResend();
      dispatch({ type: 'succeeded', cooldownSeconds });
    } catch (error) {
      dispatch({
        type: 'failed',
        message: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const isSending = state.status === 'sending';

  return (
    <div className={className}>
      <Button
        type="button"
        onClick={handleClick}
        disabled={!canRequest}
        loading={isSending}
        aria-busy={isSending}
        icon={<Clock />}
        className="w-full"
      >
        {otpResendLabel(state)}
      </Button>
      <p
        role="status"
        aria-live="polite"
        className="mt-2 min-h-5 text-center text-sm text-gray-600"
      >
        {state.announcement ?? ''}
      </p>
    </div>
  );
};

export default ResendButton;

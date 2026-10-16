'use client';

import { ArrowLeft, CheckCircle, Mail } from 'lucide-react';
import Link from 'next/link';
import Alert from '../ui/Alert';
import ResendButton from './ResendButton';
import ResetPasswordCard from './ResetPasswordCard';
import { useForgotPassword } from '@/lib/react-query/hooks/auth/useForgotPassword';

/**
 * The address the reset instructions were sent to. Kept in one place so the copy
 * and the resend request can never disagree.
 */
const RESET_EMAIL = 'testuser@gmail.com';

const ResendPassword = () => {
  const forgotPassword = useForgotPassword();

  const handleResend = async () => {
    await forgotPassword.mutateAsync({ email: RESET_EMAIL });
  };

  return (
    <ResetPasswordCard
      heading='Check Your Email'
      subHeading="we've sent password reset instructions to your email"
    >
      <article className='flex flex-col font-medium mb-8 items-center gap-2'>
        <div className='h-20 w-20 mb-3  rounded-full grid place-items-center bg-green-100'>
          <CheckCircle className='text-green-500 w-10 h-10' />
        </div>

        <p className='text-[#787f8b]'>
          We&apos;ve sent a password reset link to
        </p>
        <p className='text-[#101828]'>{RESET_EMAIL}</p>
      </article>

      <Alert icon={<Mail />} title='Didn’t receive the email?'>
        Check your spam folder or click the resend button below
      </Alert>

      <ResendButton onResend={handleResend} />

      {/* Back to sign in */}
      <div className='flex items-center mt-6 gap-2 font-medium text-primary text-sm'>
        <ArrowLeft size={20} />
        <Link href='sign-in'>Back to Sign in</Link>
      </div>
    </ResetPasswordCard>
  );
};

export default ResendPassword;

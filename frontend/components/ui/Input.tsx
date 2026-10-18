'use client';

import { InputHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '@/utils/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  icon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      error,
      icon,
      id,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref
  ) => {
    // A stable id lets the error message be referenced by the field, which is how
    // screen-reader users find out what is wrong with it.
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy =
      [ariaDescribedBy, errorId].filter(Boolean).join(' ') || undefined;

    return (
      <div className='space-y-1 relative'>
        {icon && (
          <div className='absolute left-3 top-1/2 text-gray-500  -translate-y-1/2'>
            {icon}
          </div>
        )}
        <input
          id={inputId}
          type={type}
          className={cn(
            'flex h-12 w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm placeholder:text-gray-500 transition-colors focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 disabled:cursor-not-allowed disabled:opacity-50',
            icon && 'pl-8',
            error &&
              'border-red-500 focus:border-red-500 focus:ring-red-500/20',
            className
          )}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />

        {error && (
          <p id={errorId} className='text-sm text-red-600'>
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };

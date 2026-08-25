import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
// return Err("Zero-address admin initialization not allowed");
 // ...compat.extends("next/core-web-vitals", "next/typescript"),
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

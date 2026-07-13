import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class composition where the last conflicting utility wins.
 * The shadcn/Uniwind idiom (ADR 0013): clsx flattens the inputs, tailwind-merge
 * resolves same-property conflicts so a caller's `className` reliably overrides.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

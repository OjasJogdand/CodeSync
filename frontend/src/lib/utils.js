import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Combines standard class names with Tailwind classes, resolving any conflicts safely.
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

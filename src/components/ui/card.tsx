import { View, type ViewProps } from 'react-native';

import { cn } from '@/lib/cn';

/**
 * A rounded surface (ADR 0013 primitive) — the repeated `bg-background-element`
 * card idiom (session sheet, run summary). Caller `className` merges last via cn().
 */
export function Card({ className, ...props }: ViewProps) {
  return <View className={cn('rounded-2xl bg-background-element p-4', className)} {...props} />;
}

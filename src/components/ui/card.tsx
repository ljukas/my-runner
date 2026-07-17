import { cva, type VariantProps } from 'class-variance-authority';
import { View, type ViewProps } from 'react-native';

import { cn } from '@/lib/cn';

/**
 * A rounded surface (ADR 0013 primitive). `surface` picks the pairing:
 * `element` is the gray-on-white idiom (session sheet), `card` the iOS
 * grouped white-on-gray idiom (run summary, Apple Health look). Corners are
 * Apple-style squircles: `borderCurve: 'continuous'` eases the curve into the
 * straight edges (iOS-only prop, ignored elsewhere). Caller `className`
 * merges last via cn().
 */
const cardVariants = cva('rounded-3xl p-4', {
  variants: {
    surface: {
      element: 'bg-background-element',
      card: 'bg-background-card',
    },
  },
  defaultVariants: { surface: 'element' },
});

export type CardProps = ViewProps & VariantProps<typeof cardVariants>;

export function Card({ className, surface, style, ...props }: CardProps) {
  return (
    <View
      className={cn(cardVariants({ surface }), className)}
      style={[{ borderCurve: 'continuous' }, style]}
      {...props}
    />
  );
}

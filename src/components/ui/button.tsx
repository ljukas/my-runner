import { cva, type VariantProps } from 'class-variance-authority';
import { Pressable, type PressableProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

/**
 * The app's pill call-to-action (ADR 0013), replacing the former PrimaryButton.
 * `variant` selects a surface + label token pair; only `primary` is exercised
 * today, the rest are seeded per ADR 0013 §4. This is the RN counterpart to the
 * SwiftUI `Island.Button`. Pass `testID` — it lands on the tappable Pressable.
 */
export const buttonVariants = cva('items-center justify-center rounded-full', {
  variants: {
    variant: {
      primary: 'bg-primary',
      secondary: 'bg-background-element',
      destructive: 'bg-destructive',
      ghost: 'bg-transparent',
    },
    size: {
      default: 'px-6 py-4',
      sm: 'px-4 py-2',
    },
  },
  defaultVariants: { variant: 'primary', size: 'default' },
});

// RN text does not inherit color from its container (unlike CSS), so the label
// carries its own variant map, keyed by the same axis.
const buttonTextVariants = cva('', {
  variants: {
    variant: {
      primary: 'text-primary-foreground',
      secondary: 'text-foreground',
      destructive: 'text-destructive-foreground',
      ghost: 'text-primary',
    },
  },
  defaultVariants: { variant: 'primary' },
});

export type ButtonProps = PressableProps & VariantProps<typeof buttonVariants> & { label: string };

export function Button({ className, variant, size, label, ...props }: ButtonProps) {
  return (
    <Pressable className={cn(buttonVariants({ variant, size }), className)} {...props}>
      <Text className={cn(buttonTextVariants({ variant }))}>{label}</Text>
    </Pressable>
  );
}

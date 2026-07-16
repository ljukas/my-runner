import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

/**
 * A small status pill (ADR 0013). `tone` colours the label; the surface is the
 * neutral element background in both cases.
 */
const badgeLabelVariants = cva('font-semibold', {
  variants: {
    tone: {
      positive: 'text-primary',
      neutral: 'text-foreground-secondary',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export type BadgeProps = { label: string; className?: string } & VariantProps<
  typeof badgeLabelVariants
>;

export function Badge({ label, tone, className }: BadgeProps) {
  return (
    <View className={cn('self-start rounded-full bg-background-element px-2.5 py-1', className)}>
      <Text variant="footnote" className={cn(badgeLabelVariants({ tone }))}>
        {label}
      </Text>
    </View>
  );
}

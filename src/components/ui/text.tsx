import { cva, type VariantProps } from 'class-variance-authority';
import { Platform, Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { cn } from '@/lib/cn';

/**
 * The app's text primitive (ADR 0013), replacing the former ThemedText.
 * `variant` is the typographic scale; `tone` is the color — a separate axis
 * because RN text does not inherit color from its container the way CSS does.
 * Caller `className` is merged last via cn() so it wins conflicts.
 */
export const textVariants = cva('', {
  variants: {
    variant: {
      default: 'text-base font-medium',
      title: 'text-5xl font-semibold',
      largeTitle: 'text-[34px] font-bold',
      subtitle: 'text-[32px] font-semibold',
      footnote: 'text-[13px]',
      small: 'text-sm font-medium',
      smallBold: 'text-sm font-bold',
      link: 'text-sm',
      code: `font-mono text-xs ${Platform.select({ android: 'font-bold' }) ?? 'font-medium'}`,
    },
    tone: {
      default: 'text-foreground',
      secondary: 'text-foreground-secondary',
      primary: 'text-primary',
    },
  },
  defaultVariants: { variant: 'default', tone: 'default' },
});

export type TextProps = RNTextProps & VariantProps<typeof textVariants>;

export function Text({ className, variant, tone, ...props }: TextProps) {
  // No fixed `leading-*` on the variants: RN derives a line height from the
  // (Dynamic-Type-scaling) fontSize, so leading scales too and text no longer
  // clips at large accessibility sizes.
  return <RNText className={cn(textVariants({ variant, tone }), className)} {...props} />;
}

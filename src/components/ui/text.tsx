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
      default: 'text-base leading-6 font-medium',
      title: 'text-5xl leading-[52px] font-semibold',
      largeTitle: 'text-[34px] leading-[41px] font-bold',
      subtitle: 'text-[32px] leading-[44px] font-semibold',
      footnote: 'text-[13px] leading-[18px]',
      small: 'text-sm leading-5 font-medium',
      smallBold: 'text-sm leading-5 font-bold',
      link: 'text-sm leading-[30px]',
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
  return <RNText className={cn(textVariants({ variant, tone }), className)} {...props} />;
}

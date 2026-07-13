import { Platform, Text, type TextProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'largeTitle'
    | 'footnote'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code';
  themeColor?: ThemeColor;
  className?: string;
};

const colorClasses: Record<ThemeColor, string> = {
  text: 'text-foreground',
  textSecondary: 'text-foreground-secondary',
  background: 'text-background',
  backgroundElement: 'text-background-element',
  backgroundSelected: 'text-background-selected',
  primary: 'text-primary',
};

const typeClasses: Record<NonNullable<ThemedTextProps['type']>, string> = {
  default: 'text-base leading-6 font-medium',
  title: 'text-5xl leading-[52px] font-semibold',
  largeTitle: 'text-[34px] leading-[41px] font-bold',
  footnote: 'text-[13px] leading-[18px]',
  small: 'text-sm leading-5 font-medium',
  smallBold: 'text-sm leading-5 font-bold',
  subtitle: 'text-[32px] leading-[44px] font-semibold',
  link: 'text-sm leading-[30px]',
  linkPrimary: 'text-sm leading-[30px]',
  code: `text-xs font-mono ${Platform.select({ android: 'font-bold' }) ?? 'font-medium'}`,
};

export function ThemedText({ type = 'default', themeColor, className, ...rest }: ThemedTextProps) {
  const colorClass = themeColor
    ? colorClasses[themeColor]
    : type === 'linkPrimary'
      ? 'text-primary'
      : 'text-foreground';

  return <Text className={`${colorClass} ${typeClasses[type]} ${className ?? ''}`} {...rest} />;
}

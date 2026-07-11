import { View, type ViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';

export type ThemedViewProps = ViewProps & {
  type?: ThemeColor;
  className?: string;
};

const backgroundClasses: Record<ThemeColor, string> = {
  background: 'bg-background',
  backgroundElement: 'bg-background-element',
  backgroundSelected: 'bg-background-selected',
  text: 'bg-foreground',
  textSecondary: 'bg-foreground-secondary',
};

export function ThemedView({ type, className, ...otherProps }: ThemedViewProps) {
  return (
    <View
      className={`${backgroundClasses[type ?? 'background']} ${className ?? ''}`}
      {...otherProps}
    />
  );
}

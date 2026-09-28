import { Text, type TextProps } from '@expo/ui/jetpack-compose';

import { useTheme } from '@/hooks/use-theme';

type Tone = 'default' | 'secondary';

/** Compose `Text` carrying its theme colour (ADR 0013); an explicit `color` still wins. */
export function IslandText({ tone = 'default', ...props }: TextProps & { tone?: Tone }) {
  const colors = useTheme();
  return <Text color={tone === 'secondary' ? colors.textSecondary : colors.text} {...props} />;
}

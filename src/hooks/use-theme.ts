/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useColorScheme } from 'react-native';

import { ChartGridColors, Colors, SegmentColors, StatColors } from '@/constants/theme';

export function useTheme() {
  const scheme = useColorScheme();
  const theme = scheme === 'unspecified' ? 'light' : scheme;

  return Colors[theme];
}

export function useSegmentColors() {
  const scheme = useColorScheme();
  return SegmentColors[scheme === 'dark' ? 'dark' : 'light'];
}

export function useStatColors() {
  const scheme = useColorScheme();
  return StatColors[scheme === 'dark' ? 'dark' : 'light'];
}

export function useChartGridColor() {
  const scheme = useColorScheme();
  return ChartGridColors[scheme === 'dark' ? 'dark' : 'light'];
}

import { useColorScheme } from 'react-native';

import { materialTheme } from '@/constants/material-theme';
import { ChartGridColors, SegmentColors, StatColors } from '@/constants/theme';

export function useTheme() {
  const scheme = useColorScheme();
  return materialTheme(scheme === 'dark' ? 'dark' : 'light');
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

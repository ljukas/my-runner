import { matchFont } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

import type { ProfilePoint } from '@/domain/run-profile';
import { useStatColors, useTheme } from '@/hooks/use-theme';

const AXIS_FONT_SIZE = 11;
const CHART_HEIGHT = 200;

/**
 * Pace against distance (spec §7.2). The only file importing victory-native — if it is ever
 * swapped for hand-drawn Skia, nothing outside this file changes.
 */
export function RunProfileChart({ points }: { points: ProfilePoint[] }) {
  const stat = useStatColors();
  // why: victory-native's axis defaults are hardcoded black — invisible on the dark-mode card.
  const colors = useTheme();
  const font = useMemo(() => matchFont({ fontSize: AXIS_FONT_SIZE }), []);

  // why inverted: pace is seconds per km, so a LOWER value is faster and belongs higher.
  const paceDomain = useMemo(() => {
    const paces = points.map((p) => p.paceSecPerKm).filter((p): p is number => p !== null);
    if (paces.length === 0) return undefined;
    return [Math.max(...paces), Math.min(...paces)] as [number, number];
  }, [points]);

  return (
    <View
      style={{ height: CHART_HEIGHT }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <CartesianChart
        // why cast: ProfilePoint is a declared `interface`, and TS does not treat an
        // interface as satisfying `Record<string, unknown>` structurally — a `type` alias
        // would, but the domain module isn't ours to change here.
        data={points as (ProfilePoint & Record<string, unknown>)[]}
        xKey="distanceM"
        yKeys={['paceSecPerKm']}
        yAxis={[
          {
            yKeys: ['paceSecPerKm'],
            axisSide: 'left',
            font,
            domain: paceDomain,
            labelColor: colors.textSecondary,
            lineColor: colors.textSecondary,
          },
        ]}
      >
        {({ points: rendered }) => (
          <Line points={rendered.paceSecPerKm} color={stat.pace} strokeWidth={2} />
        )}
      </CartesianChart>
    </View>
  );
}

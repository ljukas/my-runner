import { matchFont } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { PixelRatio, View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

import { formatDistanceKm, paceParts } from '@/domain/format';
import type { ProfilePoint } from '@/domain/run-profile';
import { useChartGridColor, useStatColors, useTheme } from '@/hooks/use-theme';

const AXIS_FONT_SIZE = 11;
const CHART_HEIGHT = 200;
// why capped, and at the same 1.6 as route-map-card's chip: Skia takes raw pixels and scales
// nothing itself, and past ~1.6× the axis labels claim more of the card than the line does.
const MAX_FONT_SCALE = 1.6;

// why module scope: a fresh array identity here misses victory's axis and transform memos on every
// parent render, re-measuring each label through Skia font metrics and re-parsing the path.
const Y_KEYS: 'paceSecPerKm'[] = ['paceSecPerKm'];

const formatPaceTick = (secondsPerKm: number | null) => paceParts(secondsPerKm).value;

/**
 * Pace against distance (spec §7.2). The only file importing victory-native — if it is ever
 * swapped for hand-drawn Skia, nothing outside this file changes.
 */
export function RunProfileChart({ points }: { points: ProfilePoint[] }) {
  const stat = useStatColors();
  // why: victory-native's axis defaults are hardcoded black (`cartesian/utils/axisDefaults.ts`) —
  // invisible on the dark-mode card, and latent only for as long as no axis rendered at all.
  const colors = useTheme();
  const grid = useChartGridColor();
  const fontScale = Math.min(PixelRatio.getFontScale(), MAX_FONT_SCALE);
  const font = useMemo(
    () => matchFont({ fontSize: Math.round(AXIS_FONT_SIZE * fontScale) }),
    [fontScale],
  );

  const xAxis = useMemo(
    () => ({
      font,
      labelColor: colors.textSecondary,
      lineColor: grid,
      formatXLabel: formatDistanceKm,
    }),
    [font, colors.textSecondary, grid],
  );

  // why inverted: pace is seconds per km, so a LOWER value is faster and belongs higher.
  const paceDomain = useMemo(() => {
    const paces = points.map((p) => p.paceSecPerKm).filter((p): p is number => p !== null);
    if (paces.length === 0) return undefined;
    return [Math.max(...paces), Math.min(...paces)] as [number, number];
  }, [points]);

  const yAxis = useMemo(
    () => [
      {
        yKeys: Y_KEYS,
        axisSide: 'left' as const,
        font,
        domain: paceDomain,
        labelColor: colors.textSecondary,
        lineColor: grid,
        formatYLabel: formatPaceTick,
      },
    ],
    [font, paceDomain, colors.textSecondary, grid],
  );

  return (
    <View
      style={{ height: Math.round(CHART_HEIGHT * fontScale) }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <CartesianChart data={points} xKey="distanceM" yKeys={Y_KEYS} xAxis={xAxis} yAxis={yAxis}>
        {({ points: rendered }) => (
          <Line points={rendered.paceSecPerKm} color={stat.pace} strokeWidth={2} />
        )}
      </CartesianChart>
    </View>
  );
}

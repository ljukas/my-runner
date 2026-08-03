import { DashPathEffect, matchFont } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { PixelRatio, View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

import { distanceParts, paceParts } from '@/domain/format';
import type { ProfilePoint } from '@/domain/run-profile';
import { useChartGridColor, useStatColors, useTheme } from '@/hooks/use-theme';

const AXIS_FONT_SIZE = 11;
// why 160 and not the former 200: the x axis spends ~30 pt on its tick row and unit, leaving a
// ~130 pt plot — the "not full-height" band HIG "Charts" asks of a card-sized chart, and still
// tall enough to keep a W1D1's eight run/walk swings distinct (verified on device).
const CHART_HEIGHT = 160;
// why capped, at route-map-card's 1.6: Skia takes raw pixels and scales nothing itself, and past
// ~1.6× the axis labels claim more of the card than the line does.
const MAX_FONT_SCALE = 1.6;

// why module scope: a fresh identity misses victory's axis and transform memos on every parent
// render, re-measuring each label through Skia font metrics and re-parsing the path.
const Y_KEYS: 'paceSecPerKm'[] = ['paceSecPerKm'];

// Ticks stay bare numbers; each axis names its own unit once (spec §7.2).
const formatPaceTick = (secondsPerKm: number | null) => paceParts(secondsPerKm).value;
const formatDistanceTick = (meters: number) => distanceParts(meters).value;

// why the x unit sits here and the y unit in the card's title: victory renders an x title
// horizontally under the tick row, but a y title only rotated 90° (`YAxis.tsx` hardcodes the
// transform) — and WWDC22 110340 rejects a y-axis label as "small and off to the side" in favour
// of naming the unit in the heading. `end` prints "km" once at the axis's end, not on all five
// ticks. Module scope keeps the identity stable for victory's axis memo, as with `Y_KEYS`.
const X_AXIS_TITLE = { text: 'km', position: 'end' } as const;

// why fewer ticks as text grows: victory's default 5 labels are ~64 pt each at the 1.6× cap,
// needing ~320 pt of a ~285 pt plot area on a 393 pt phone — they collide before they clip.
const DEFAULT_TICK_COUNT = 5;

// why 3 and not DEFAULT_TICK_COUNT: the y axis (pace) follows Apple's Screen Time card, which
// uses three; the x axis (distance) keeps its own five-tick baseline above. Same
// fewer-ticks-as-text-grows shape, different baseline.
const Y_AXIS_TICK_COUNT = 3;

// why the container needs right padding now: `axisSide: 'right'` draws the pace labels starting
// at the chart's own right edge with no margin to the canvas boundary, and the x-axis title's
// `end` position (`km`) draws flush with that same edge — both clip without room to breathe.
const CHART_PADDING_RIGHT = 40;

// why [1, 3] and not evenly split: a hairline stroke this thin needs a short dash and a longer
// gap to read as dotted rather than dashed at chart scale.
const Y_GRID_DASH_INTERVALS = [1, 3];

/**
 * Pace against distance (spec §7.2). The only file importing victory-native — if it is ever
 * swapped for hand-drawn Skia, nothing outside this file changes.
 */
export function RunProfileChart({ points }: { points: ProfilePoint[] }) {
  const stat = useStatColors();
  // why every axis color is passed: victory's defaults are hardcoded black (`axisDefaults.ts`),
  // latent only for as long as no axis rendered at all.
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
      formatXLabel: formatDistanceTick,
      title: X_AXIS_TITLE,
      tickCount: Math.max(2, Math.round(DEFAULT_TICK_COUNT / fontScale)),
    }),
    [font, colors.textSecondary, grid, fontScale],
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
        axisSide: 'right' as const,
        font,
        domain: paceDomain,
        labelColor: colors.textSecondary,
        lineColor: grid,
        formatYLabel: formatPaceTick,
        tickCount: Math.max(2, Math.round(Y_AXIS_TICK_COUNT / fontScale)),
        linePathEffect: <DashPathEffect intervals={Y_GRID_DASH_INTERVALS} />,
      },
    ],
    [font, paceDomain, colors.textSecondary, grid, fontScale],
  );

  return (
    <View
      style={{ height: Math.round(CHART_HEIGHT * fontScale) }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <CartesianChart
        data={points}
        xKey="distanceM"
        yKeys={Y_KEYS}
        xAxis={xAxis}
        yAxis={yAxis}
        padding={{ right: CHART_PADDING_RIGHT }}
      >
        {({ points: rendered }) => (
          <Line
            points={rendered.paceSecPerKm}
            color={stat.pace}
            strokeWidth={2}
            // why monotoneX and no other curve: it's shape-preserving — the drawn line never goes
            // beyond the data's own min/max. natural/cardinal/catmullRom/basis all overshoot,
            // which here means drawing a pace faster than the runner ever ran. Don't swap this for
            // a smoother-looking curve; that trade would draw fabricated paces.
            curveType="monotoneX"
          />
        )}
      </CartesianChart>
    </View>
  );
}

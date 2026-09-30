import { DashPathEffect, matchFont, Rect } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { PixelRatio, View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

import { SKIA_FONT_FAMILY } from '@/constants/skia-font';
import { distanceParts, paceParts } from '@/domain/format';
import type { ProfileBands } from '@/domain/profile-bands';
import {
  elevationChartDomain,
  paceChartDomain,
  type ProfilePoint,
  type ProfileSeriesKey,
} from '@/domain/run-profile';
import { useChartGridColor, useSegmentColors, useStatColors, useTheme } from '@/hooks/use-theme';

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
const PACE_KEYS: ProfileSeriesKey[] = ['paceSecPerKm'];
const ELEVATION_KEYS: ProfileSeriesKey[] = ['elevationM'];
const ALL_KEYS: ProfileSeriesKey[] = ['paceSecPerKm', 'elevationM'];

// Ticks stay bare numbers; each axis names its own unit once (spec §7.2).

// why U+2007 and not a plain space: a right-side axis places every label at the same left edge
// (`YAxis.tsx` returns `chartBounds.right + labelOffset` regardless of label width), so "6:40"
// and "13:20" ragged-right against each other. FIGURE SPACE is a digit's width by definition, so
// padding the short form to the long one's length right-aligns them with no layout control.
const FIGURE_SPACE = ' ';
const PACE_TICK_WIDTH = 5; // "MM:SS"

const formatPaceTick = (secondsPerKm: number | null) =>
  paceParts(secondsPerKm).value.padStart(PACE_TICK_WIDTH, FIGURE_SPACE);

const formatElevationTick = (meters: number | null) =>
  meters === null ? '' : String(Math.round(meters));

// why trimmed here rather than in `distanceParts`: that helper feeds the stat tiles, where a run
// reads "2.31 km" and the two decimals are the point. On an axis they are noise — the owner wants
// 1, 1.5, 2.5 — and a tick is the only place a whole kilometre should lose its ".00".
const formatDistanceTick = (meters: number) => String(Number(distanceParts(meters).value));

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

// why [1, 3] and not evenly split: a hairline stroke this thin needs a short dash and a longer
// gap to read as dotted rather than dashed at chart scale.
const Y_GRID_DASH_INTERVALS = [1, 3];

// why a strip under the axis rather than tinted columns: shading the plot competes with the pace and
// elevation lines, and the owner chose the strip (ADR 0026 §5, stage 4). Why below the plot and not
// inside it: the pace domain puts the slowest pace on the plot's bottom edge, which is exactly where
// a walk is drawn. Why two heights: run and walk must not differ by hue alone (spec §7.3).
const BAND_STRIP_HEIGHT = { run: 4, walk: 2 } as const;
// victory's default x `labelOffset` (`axisDefaults.ts`), plus room for the strip above the labels
const X_LABEL_OFFSET_WITH_BANDS = 2 + BAND_STRIP_HEIGHT.run + 2;
const STOP_MARKER_WIDTH = 2;

/**
 * Pace, and relative elevation when the run carries it, against distance (spec §7.2). The only file importing victory-native — if it is ever
 * swapped for hand-drawn Skia, nothing outside this file changes.
 */
export function RunProfileChart({
  points,
  bands = null,
}: {
  points: ProfilePoint[];
  /** A free run's buckets, drawn as a run/walk strip and a hairline per stop. */
  bands?: ProfileBands | null;
}) {
  const stat = useStatColors();
  const segment = useSegmentColors();
  // why every axis color is passed: victory's defaults are hardcoded black (`axisDefaults.ts`),
  // latent only for as long as no axis rendered at all.
  const colors = useTheme();
  const grid = useChartGridColor();
  const fontScale = Math.min(PixelRatio.getFontScale(), MAX_FONT_SCALE);
  const font = useMemo(
    () =>
      matchFont({ fontFamily: SKIA_FONT_FAMILY, fontSize: Math.round(AXIS_FONT_SIZE * fontScale) }),
    [fontScale],
  );

  const banded = bands !== null;
  const xAxis = useMemo(
    () => ({
      font,
      labelColor: colors.textSecondary,
      lineColor: grid,
      formatXLabel: formatDistanceTick,
      title: X_AXIS_TITLE,
      tickCount: Math.max(2, Math.round(DEFAULT_TICK_COUNT / fontScale)),
      ...(banded ? { labelOffset: X_LABEL_OFFSET_WITH_BANDS } : null),
    }),
    [font, colors.textSecondary, grid, fontScale, banded],
  );

  const paceDomain = useMemo(() => paceChartDomain(points), [points]);
  const elevationDomain = useMemo(() => elevationChartDomain(points), [points]);

  const yAxis = useMemo(() => {
    const tickCount = Math.max(2, Math.round(Y_AXIS_TICK_COUNT / fontScale));
    const pace = {
      yKeys: PACE_KEYS,
      axisSide: 'right' as const,
      font,
      domain: paceDomain,
      labelColor: colors.textSecondary,
      lineColor: grid,
      formatYLabel: formatPaceTick,
      tickCount,
      linePathEffect: <DashPathEffect intervals={Y_GRID_DASH_INTERVALS} />,
    };
    if (!elevationDomain) return [pace];
    return [
      pace,
      {
        yKeys: ELEVATION_KEYS,
        axisSide: 'left' as const,
        font,
        domain: elevationDomain,
        labelColor: stat.elevation,
        // why no gridlines: the pace axis already draws them, and two unaligned sets read as noise.
        lineWidth: 0,
        formatYLabel: formatElevationTick,
        tickCount,
      },
    ];
  }, [font, paceDomain, elevationDomain, colors.textSecondary, stat.elevation, grid, fontScale]);

  return (
    <View
      style={{ height: Math.round(CHART_HEIGHT * fontScale) }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <CartesianChart
        data={points}
        xKey="distanceM"
        yKeys={elevationDomain ? ALL_KEYS : PACE_KEYS}
        xAxis={xAxis}
        yAxis={yAxis}
        // why outside: this layer is not clipped to the plot, so the strip can hang under its axis
        renderOutside={({ xScale, chartBounds }) =>
          bands?.runWalk.map((band, index) => {
            const from = Math.max(xScale(band.fromM), chartBounds.left);
            const to = Math.min(xScale(band.toM), chartBounds.right);
            return (
              <Rect
                key={`band-${index}`}
                x={from}
                y={chartBounds.bottom}
                width={Math.max(0, to - from)}
                height={BAND_STRIP_HEIGHT[band.kind]}
                color={segment[band.kind]}
              />
            );
          })
        }
      >
        {({ points: rendered, xScale, chartBounds }) => (
          <>
            {bands?.stopsAtM.map((atM, index) => (
              <Rect
                key={`stop-${index}`}
                // why clamped: points sit at bucket centres, so the axis starts half a bucket in and
                // a stop at 0 m would fall wholly outside the clipped plot
                x={
                  Math.min(
                    Math.max(xScale(atM), chartBounds.left + STOP_MARKER_WIDTH / 2),
                    chartBounds.right - STOP_MARKER_WIDTH / 2,
                  ) -
                  STOP_MARKER_WIDTH / 2
                }
                y={chartBounds.top}
                width={STOP_MARKER_WIDTH}
                height={chartBounds.bottom - chartBounds.top}
                color={segment.stopped}
              />
            ))}
            {/* Drawn first so pace, the run's primary measure, stays on top. */}
            {elevationDomain ? (
              <Line
                points={rendered.elevationM}
                color={stat.elevation}
                strokeWidth={2}
                curveType="monotoneX"
              />
            ) : null}
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
          </>
        )}
      </CartesianChart>
    </View>
  );
}

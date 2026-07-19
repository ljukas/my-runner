import { StatGrid } from '@/components/stat-grid';
import { SegmentColors } from '@/constants/theme';
import type { Run, RunSegment } from '@/db/schema';
import { clockParts } from '@/domain/format';
import { runStats } from '@/domain/run-stats';

/**
 * The run summary's Apple-Health-style stat grid (ADR 0013 domain component):
 * owns which four stats appear and their symbols, tints, and units, deriving
 * them from the run and its segments.
 */
export function RunStatGrid({ run, segments }: { run: Run; segments: RunSegment[] }) {
  const stats = runStats(segments);
  return (
    <StatGrid>
      <StatGrid.Tile
        icon="figure.run"
        color={SegmentColors.run}
        label="Running"
        {...clockParts(stats.timeRunningS)}
      />
      <StatGrid.Tile
        icon="repeat"
        color={SegmentColors.warmup}
        label="Intervals"
        value={String(stats.runIntervals)}
        unit="runs"
      />
      <StatGrid.Tile
        icon="stopwatch.fill"
        color={SegmentColors.cooldown}
        label="Active Time"
        {...clockParts(run.activeDurationS)}
      />
      <StatGrid.Tile
        icon="trophy.fill"
        color={SegmentColors.walk}
        label="Longest Run"
        {...clockParts(stats.longestRunS)}
      />
    </StatGrid>
  );
}

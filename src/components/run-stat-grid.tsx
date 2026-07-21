import { StatGrid } from '@/components/stat-grid';
import type { Run, RunSegment } from '@/db/schema';
import { clockParts } from '@/domain/format';
import { runStats } from '@/domain/run-stats';
import { useStatColors } from '@/hooks/use-theme';

/**
 * The run summary's Apple-Health-style stat grid (ADR 0013 domain component):
 * owns which four stats appear and their symbols, tints, and units, deriving
 * them from the run and its segments.
 */
export function RunStatGrid({ run, segments }: { run: Run; segments: RunSegment[] }) {
  const stats = runStats(segments);
  const stat = useStatColors();
  return (
    <StatGrid>
      <StatGrid.Tile
        icon="figure.run"
        color={stat.running}
        label="Running"
        {...clockParts(stats.timeRunningS)}
      />
      <StatGrid.Tile
        icon="repeat"
        color={stat.intervals}
        label="Intervals"
        value={String(stats.runIntervals)}
        unit="runs"
      />
      <StatGrid.Tile
        icon="stopwatch.fill"
        color={stat.activeTime}
        label="Active Time"
        {...clockParts(run.activeDurationS)}
      />
      <StatGrid.Tile
        icon="trophy.fill"
        color={stat.longestRun}
        label="Longest Run"
        {...clockParts(stats.longestRunS)}
      />
    </StatGrid>
  );
}

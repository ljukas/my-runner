import { StatGrid } from '@/components/stat-grid';
import type { Run, RunSegment } from '@/db/schema';
import { clockParts, distanceParts, paceParts } from '@/domain/format';
import { hasMeasuredDistance, paceSecPerKm, runStats } from '@/domain/run-stats';
import { useStatColors } from '@/hooks/use-theme';

/**
 * The run summary's Apple-Health-style stat grid (ADR 0013 domain component):
 * owns which stats appear and their symbols, tints, and units, deriving
 * them from the run and its segments. Distance and pace are derived here, never
 * stored (ADR 0021), and drop out entirely for a run that recorded no measured
 * movement — GPS off, or drift too slow to be a measurement (spec §8).
 */
export function RunStatGrid({ run, segments }: { run: Run; segments: RunSegment[] }) {
  const stats = runStats(segments);
  const stat = useStatColors();
  const distanceM = hasMeasuredDistance(run.distanceM, run.activeDurationS) ? run.distanceM : null;
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
      {distanceM !== null ? (
        <>
          <StatGrid.Tile
            icon="location.fill"
            color={stat.distance}
            label="Distance"
            {...distanceParts(distanceM)}
          />
          <StatGrid.Tile
            icon="speedometer"
            color={stat.pace}
            label="Avg Pace"
            {...paceParts(paceSecPerKm(distanceM, run.activeDurationS))}
          />
        </>
      ) : null}
    </StatGrid>
  );
}

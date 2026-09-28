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
        icon={{ ios: 'figure.run', android: 'directions_run' }}
        color={stat.running}
        label="Running"
        {...clockParts(stats.timeRunningS)}
      />
      <StatGrid.Tile
        icon={{ ios: 'stopwatch.fill', android: 'timer' }}
        color={stat.activeTime}
        label="Active Time"
        {...clockParts(run.activeDurationS)}
      />
      {distanceM !== null ? (
        <>
          <StatGrid.Tile
            icon={{ ios: 'location.fill', android: 'my_location' }}
            color={stat.distance}
            label="Distance"
            {...distanceParts(distanceM)}
          />
          <StatGrid.Tile
            icon={{ ios: 'speedometer', android: 'speed' }}
            color={stat.pace}
            label="Avg Pace"
            {...paceParts(paceSecPerKm(distanceM, run.activeDurationS))}
          />
        </>
      ) : null}
    </StatGrid>
  );
}

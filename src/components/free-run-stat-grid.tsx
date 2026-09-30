import { StatGrid } from '@/components/stat-grid';
import type { Run, RunSegment } from '@/db/schema';
import { clockParts, distanceParts, elevationParts, paceParts } from '@/domain/format';
import { freeRunStats } from '@/domain/run-stats';
import type { SummaryElevation } from '@/domain/run-summary';
import { useStatColors } from '@/hooks/use-theme';

/** `RunStatGrid`'s free-run sibling (spec §5.3): Active Time alone for a run that measured no distance. */
export function FreeRunStatGrid({
  run,
  segments,
  elevation,
}: {
  run: Run;
  segments: RunSegment[];
  elevation: SummaryElevation | null;
}) {
  const stats = freeRunStats(run, segments);
  const stat = useStatColors();
  return (
    <StatGrid>
      <StatGrid.Tile
        icon={{ ios: 'stopwatch.fill', android: 'timer' }}
        color={stat.activeTime}
        label="Active Time"
        {...clockParts(stats.activeS)}
      />
      {stats.distanceM !== null ? (
        <>
          <StatGrid.Tile
            icon={{ ios: 'figure.run', android: 'directions_run' }}
            color={stat.running}
            label="Moving Time"
            {...clockParts(stats.movingTimeS)}
          />
          <StatGrid.Tile
            icon={{ ios: 'location.fill', android: 'my_location' }}
            color={stat.distance}
            label="Distance"
            {...distanceParts(stats.distanceM)}
          />
          <StatGrid.Tile
            icon={{ ios: 'speedometer', android: 'speed' }}
            color={stat.pace}
            label="Moving Pace"
            {...paceParts(stats.movingPaceSecPerKm)}
          />
          <StatGrid.Tile
            icon={{ ios: 'hare.fill', android: 'directions_run' }}
            color={stat.pace}
            label="Run Pace"
            {...paceParts(stats.runPaceSecPerKm)}
          />
          <StatGrid.Tile
            icon={{ ios: 'figure.walk', android: 'directions_walk' }}
            color={stat.pace}
            label="Walk Pace"
            {...paceParts(stats.walkPaceSecPerKm)}
          />
          {elevation?.status === 'estimated' ? (
            <StatGrid.Tile
              icon={{ ios: 'mountain.2.fill', android: 'terrain' }}
              color={stat.elevation}
              label="Elevation Gain"
              width="full"
              {...elevationParts(elevation.gainM)}
            />
          ) : null}
        </>
      ) : null}
    </StatGrid>
  );
}

import type { PlannedSegment, SegmentKind } from './plan';

export interface TimelineSegment {
  kind: SegmentKind;
  plannedSeconds: number;
  effectiveSeconds: number;
  /** Active-elapsed seconds at which this segment begins. */
  startsAt: number;
  wasSkipped: boolean;
}

export type SegmentPosition =
  | { done: false; index: number; secondsInto: number; secondsRemaining: number }
  | { done: true };

/**
 * The session timeline: prefix sums over planned durations, adjusted by skip
 * events. A skip stamps the then-current segment's actual end at the skip
 * moment, truncating it and shifting everything after it earlier (spec §5).
 */
export function buildTimeline(segments: PlannedSegment[], skipAts: number[]): TimelineSegment[] {
  const timeline: TimelineSegment[] = segments.map((s) => ({
    kind: s.kind,
    plannedSeconds: s.seconds,
    effectiveSeconds: s.seconds,
    startsAt: 0,
    wasSkipped: false,
  }));
  restack(timeline);

  for (const skipAt of [...skipAts].sort((a, b) => a - b)) {
    const pos = positionAt(timeline, skipAt);
    if (pos.done) continue;
    const segment = timeline[pos.index];
    segment.effectiveSeconds = pos.secondsInto;
    segment.wasSkipped = true;
    restack(timeline);
  }
  return timeline;
}

function restack(timeline: TimelineSegment[]): void {
  let at = 0;
  for (const segment of timeline) {
    segment.startsAt = at;
    at += segment.effectiveSeconds;
  }
}

export function totalSeconds(timeline: TimelineSegment[]): number {
  const last = timeline[timeline.length - 1];
  return last ? last.startsAt + last.effectiveSeconds : 0;
}

export function positionAt(timeline: TimelineSegment[], activeElapsed: number): SegmentPosition {
  for (let index = 0; index < timeline.length; index++) {
    const segment = timeline[index];
    const end = segment.startsAt + segment.effectiveSeconds;
    if (activeElapsed < end) {
      return {
        done: false,
        index,
        secondsInto: activeElapsed - segment.startsAt,
        secondsRemaining: end - activeElapsed,
      };
    }
  }
  return { done: true };
}

export type SegmentKind = 'warmup' | 'run' | 'walk' | 'cooldown';

export interface PlannedSegment {
  kind: SegmentKind;
  seconds: number;
}

export interface PlanSession {
  key: string;
  week: number;
  day: number;
  segments: PlannedSegment[];
}

const warmup: PlannedSegment = { kind: 'warmup', seconds: 300 };
const cooldown: PlannedSegment = { kind: 'cooldown', seconds: 300 };
const run = (seconds: number): PlannedSegment => ({ kind: 'run', seconds });
const walk = (seconds: number): PlannedSegment => ({ kind: 'walk', seconds });

/** `count` runs with walks between them — ends on a run. */
function alternate(count: number, runSeconds: number, walkSeconds: number): PlannedSegment[] {
  const out: PlannedSegment[] = [];
  for (let i = 0; i < count; i++) {
    out.push(run(runSeconds));
    if (i < count - 1) out.push(walk(walkSeconds));
  }
  return out;
}

function session(week: number, day: number, intervals: PlannedSegment[]): PlanSession {
  return { key: `w${week}d${day}`, week, day, segments: [warmup, ...intervals, cooldown] };
}

/** Three identical days sharing one interval structure. */
function week(weekNo: number, intervals: PlannedSegment[]): PlanSession[] {
  return [1, 2, 3].map((day) => session(weekNo, day, intervals));
}

/** The classic 9-week NHS Couch-to-5K plan (design spec Appendix A). */
export const NHS_PLAN: PlanSession[] = [
  ...week(1, alternate(8, 60, 90)),
  ...week(2, alternate(6, 90, 120)),
  ...week(3, [run(90), walk(90), run(180), walk(180), run(90), walk(90), run(180), walk(180)]),
  ...week(4, [run(180), walk(90), run(300), walk(150), run(180), walk(90), run(300)]),
  session(5, 1, [run(300), walk(180), run(300), walk(180), run(300)]),
  session(5, 2, [run(480), walk(300), run(480)]),
  session(5, 3, [run(1200)]),
  session(6, 1, [run(300), walk(180), run(480), walk(180), run(300)]),
  session(6, 2, [run(600), walk(180), run(600)]),
  session(6, 3, [run(1500)]),
  ...week(7, [run(1500)]),
  ...week(8, [run(1680)]),
  ...week(9, [run(1800)]),
];

/**
 * Dev-only plan for E2E flows and demos: same 27 sessions and segment
 * structure, but every duration is compressed to ~1 s per minute
 * (minimum 2 s so each segment is observable/tappable).
 */
export const COMPRESSED_PLAN: PlanSession[] = NHS_PLAN.map((s) => ({
  ...s,
  segments: s.segments.map((seg) => ({
    ...seg,
    seconds: Math.max(2, Math.round(seg.seconds / 60)),
  })),
}));

export function getSession(plan: PlanSession[], key: string): PlanSession | undefined {
  return plan.find((s) => s.key === key);
}

export function sessionTotalSeconds(session: PlanSession): number {
  return session.segments.reduce((sum, s) => sum + s.seconds, 0);
}

export function sessionRunSeconds(session: PlanSession): number {
  return session.segments.filter((s) => s.kind === 'run').reduce((sum, s) => sum + s.seconds, 0);
}

/** First session in plan order without a completed run — free repeats need no special-casing. */
export function nextSessionKey(
  plan: PlanSession[],
  completedKeys: ReadonlySet<string>,
): string | null {
  return plan.find((s) => !completedKeys.has(s.key))?.key ?? null;
}

export function parseSessionKey(key: string): { week: number; day: number } | null {
  const match = /^w(\d+)d(\d+)$/.exec(key);
  return match ? { week: Number(match[1]), day: Number(match[2]) } : null;
}

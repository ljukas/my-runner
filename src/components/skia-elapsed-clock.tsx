import { SkiaClockFace } from '@/components/skia-clock';
import { elapsedParts, formatElapsed } from '@/domain/elapsed';

/** A free run's count-up clock: `M:SS`, and `H:MM:SS` from an hour (spec §5.2). */
export function SkiaElapsedClock({ seconds, color }: { seconds: number; color: string }) {
  return <SkiaClockFace {...elapsedParts(seconds)} label={formatElapsed(seconds)} color={color} />;
}

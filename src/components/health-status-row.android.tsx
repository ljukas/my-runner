import type { Run } from '@/db/schema';

// No health store until the Health Connect stage (ADR 0025).
export function HealthStatusRow(_props: { run: Run }) {
  return null;
}

import type { Run } from '@/db/schema';

// Field-data export accompanies the barometer capture, which Android does not do yet (ADR 0025).
export function RunExportRow(_props: { run: Run }) {
  return null;
}

import { padding } from '@expo/ui/jetpack-compose/modifiers';

import { Island } from '@/components/island';
import { RUN_NOTICE_TEXT, type RunNotice } from '@/domain/run-notice';

/** Why the last free run left no summary, as the Plan list's first item while it lasts. */
export function RunNoticeRow({ notice }: { notice: RunNotice | null }) {
  if (notice === null) return null;
  return (
    <Island.Text
      tone="secondary"
      style={{ typography: 'bodyMedium' }}
      modifiers={[padding(16, 16, 16, 4)]}
    >
      {RUN_NOTICE_TEXT[notice]}
    </Island.Text>
  );
}

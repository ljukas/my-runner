import { padding } from '@expo/ui/swift-ui/modifiers';

import { Island } from '@/components/island';
import { RUN_NOTICE_TEXT, type RunNotice } from '@/domain/run-notice';

export function RunNoticeRow({ notice }: { notice: RunNotice | null }) {
  if (notice === null) return null;
  return (
    <Island.Text tone="secondary" modifiers={[padding({ horizontal: 4 })]}>
      {RUN_NOTICE_TEXT[notice]}
    </Island.Text>
  );
}

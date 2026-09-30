import { Section } from '@expo/ui/swift-ui';

import { Island } from '@/components/island';
import { RUN_NOTICE_TEXT, type RunNotice } from '@/domain/run-notice';

/** Why the last free run left no summary, as the Plan list's first section while it lasts. */
export function RunNoticeRow({ notice }: { notice: RunNotice | null }) {
  if (notice === null) return null;
  return (
    <Section>
      <Island.Text tone="secondary">{RUN_NOTICE_TEXT[notice]}</Island.Text>
    </Section>
  );
}

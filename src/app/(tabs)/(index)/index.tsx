import { Island } from '@/components/island';
import { RunModeCard } from '@/components/run-mode-card';
import { RunNoticeRow } from '@/components/run-notice-row';
import { FREE_RUN_CARD } from '@/domain/free-run-view';
import { nextRunLabel, planCardDetail } from '@/domain/plan-progress';
import { usePlanProgress } from '@/hooks/use-plan-progress';
import { useRunEntry } from '@/hooks/use-run-entry';
import { useRunNotice } from '@/services/run-notice/use-run-notice';

export default function RunScreen() {
  const progress = usePlanProgress();
  const entry = useRunEntry();
  const notice = useRunNotice();
  const { next } = progress;
  const nextLabel = nextRunLabel(progress);

  return (
    <Island>
      <RunModeCard.List>
        <RunNoticeRow notice={notice} />
        <RunModeCard
          featured
          title="Couch to 5K"
          detail={planCardDetail(progress)}
          symbol={{ ios: 'calendar', android: 'calendar_month' }}
          progress={progress.done / progress.total}
          hint="Opens the week list"
          onPress={entry.openPlan}
          action={
            next && nextLabel
              ? {
                  label: nextLabel,
                  disabled: entry.disabled,
                  onPress: () => entry.openSession(next.key),
                }
              : undefined
          }
        />
        <RunModeCard
          title={FREE_RUN_CARD.title}
          detail={FREE_RUN_CARD.detail}
          symbol={{ ios: 'figure.run', android: 'directions_run' }}
          hint="Opens the free-run sheet"
          disabled={entry.disabled}
          onPress={entry.openFreeRun}
        />
      </RunModeCard.List>
    </Island>
  );
}

import { Button, ConfirmationDialog, HStack, Text } from '@expo/ui/swift-ui';

import { Island } from '@/components/island';
import type { RunTransportEnd } from '@/components/run-transport-end';
import { FREE_RUN_END_DIALOG } from '@/domain/free-run-view';
import { useEndRunDialog } from '@/hooks/use-end-run-dialog';
import { useTheme } from '@/hooks/use-theme';
import { runEngine } from '@/services/run-engine';

/**
 * The run screen's transport row. Stays SwiftUI (ADR 0005) because `End`
 * presents the real system action sheet, which exists only inside a SwiftUI
 * tree, and because the buttons' native disabled dimming is the whole of the run
 * lock's "you are locked" feedback. One host for all of them: the dialog has to
 * share its trigger's tree.
 */
export function RunTransport({
  paused,
  locked,
  end,
}: {
  paused: boolean;
  locked: boolean;
  end: RunTransportEnd;
}) {
  const colors = useTheme();
  const dialog = useEndRunDialog(end);

  return (
    <Island matchContents>
      <HStack spacing={40}>
        <ConfirmationDialog
          title={end.mode === 'open' ? FREE_RUN_END_DIALOG.title : 'End this run?'}
          isPresented={dialog.open}
          onIsPresentedChange={dialog.setOpen}
          titleVisibility="visible"
        >
          <ConfirmationDialog.Trigger>
            <Island.IconButton
              systemName="stop.fill"
              size={30}
              color={colors.textSecondary}
              label="End"
              disabled={locked}
              onPress={dialog.requestEnd}
            />
          </ConfirmationDialog.Trigger>
          <ConfirmationDialog.Actions>
            {end.mode === 'open' ? (
              <>
                <Button label={FREE_RUN_END_DIALOG.save} onPress={() => dialog.finish('save')} />
                <Button
                  role="destructive"
                  label={FREE_RUN_END_DIALOG.discard}
                  onPress={() => dialog.finish('discard')}
                />
              </>
            ) : (
              <Button role="destructive" label="End run" onPress={() => dialog.finish()} />
            )}
          </ConfirmationDialog.Actions>
          <ConfirmationDialog.Message>
            <Text>
              {end.mode === 'open'
                ? FREE_RUN_END_DIALOG.message
                : end.endsAsCompleted
                  ? 'This run is done — it will be saved as completed.'
                  : 'Progress so far is saved as a partial run.'}
            </Text>
          </ConfirmationDialog.Message>
        </ConfirmationDialog>
        <Island.IconButton
          systemName={paused ? 'play.fill' : 'pause.fill'}
          size={48}
          color={colors.text}
          label={paused ? 'Resume' : 'Pause'}
          disabled={locked}
          onPress={() => (paused ? runEngine.resume() : runEngine.pause())}
        />
        {end.mode === 'scripted' ? (
          <Island.IconButton
            systemName="forward.fill"
            size={30}
            color={colors.textSecondary}
            label="Skip"
            disabled={locked}
            onPress={() => runEngine.skipSegment()}
          />
        ) : null}
      </HStack>
    </Island>
  );
}

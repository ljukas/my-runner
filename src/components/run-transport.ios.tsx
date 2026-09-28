import { Button, ConfirmationDialog, HStack, Text } from '@expo/ui/swift-ui';
import { useState } from 'react';

import { Island } from '@/components/island';
import { useTheme } from '@/hooks/use-theme';
import { runEngine } from '@/services/run-engine';

/**
 * The run screen's transport row. Stays SwiftUI (ADR 0005) because `End`
 * presents the real system action sheet, which exists only inside a SwiftUI
 * tree, and because the buttons' native disabled dimming is the whole of the run
 * lock's "you are locked" feedback. One host for all three: the dialog has to
 * share its trigger's tree.
 */
export function RunTransport({
  paused,
  locked,
  endsAsCompleted,
}: {
  paused: boolean;
  locked: boolean;
  endsAsCompleted: boolean;
}) {
  const colors = useTheme();
  const [endDialogOpen, setEndDialogOpen] = useState(false);

  return (
    <Island matchContents>
      <HStack spacing={40}>
        <ConfirmationDialog
          title="End this run?"
          isPresented={endDialogOpen}
          onIsPresentedChange={setEndDialogOpen}
          titleVisibility="visible"
        >
          <ConfirmationDialog.Trigger>
            <Island.IconButton
              systemName="stop.fill"
              size={30}
              color={colors.textSecondary}
              label="End"
              disabled={locked}
              onPress={() => setEndDialogOpen(true)}
            />
          </ConfirmationDialog.Trigger>
          <ConfirmationDialog.Actions>
            <Button role="destructive" label="End run" onPress={() => runEngine.endEarly()} />
          </ConfirmationDialog.Actions>
          <ConfirmationDialog.Message>
            <Text>
              {endsAsCompleted
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
        <Island.IconButton
          systemName="forward.fill"
          size={30}
          color={colors.textSecondary}
          label="Skip"
          disabled={locked}
          onPress={() => runEngine.skipSegment()}
        />
      </HStack>
    </Island>
  );
}

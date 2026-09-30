import { AlertDialog, Column, Text, TextButton } from '@expo/ui/jetpack-compose';
import { View } from 'react-native';

import { Island } from '@/components/island';
import type { RunTransportEnd } from '@/components/run-transport-end';
import { FREE_RUN_END_DIALOG } from '@/domain/free-run-view';
import { useEndRunDialog } from '@/hooks/use-end-run-dialog';
import { useTheme } from '@/hooks/use-theme';
import { runEngine } from '@/services/run-engine';

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
    <View className="flex-row items-center gap-10">
      <Island.IconButton
        systemName={{ android: 'stop' }}
        size={30}
        color={colors.textSecondary}
        label="End"
        disabled={locked}
        onPress={dialog.requestEnd}
      />
      <Island.IconButton
        systemName={{ android: paused ? 'play_arrow' : 'pause' }}
        size={48}
        color={colors.text}
        label={paused ? 'Resume' : 'Pause'}
        disabled={locked}
        onPress={() => (paused ? runEngine.resume() : runEngine.pause())}
      />
      {end.mode === 'scripted' ? (
        <Island.IconButton
          systemName={{ android: 'skip_next' }}
          size={30}
          color={colors.textSecondary}
          label="Skip"
          disabled={locked}
          onPress={() => runEngine.skipSegment()}
        />
      ) : null}
      {/* why conditional: an AlertDialog is presented by mounting, so it exists only while open. */}
      {dialog.open ? (
        <Island matchContents>
          <AlertDialog onDismissRequest={() => dialog.setOpen(false)}>
            <AlertDialog.Title>
              <Text>{end.mode === 'open' ? FREE_RUN_END_DIALOG.title : 'End this run?'}</Text>
            </AlertDialog.Title>
            <AlertDialog.Text>
              {end.mode === 'open' ? (
                // why Discard in the body: Material's dialog has two action slots, which Save Run
                // and Cancel take (owner decision, 2026-09-29)
                <Column>
                  <Text>{FREE_RUN_END_DIALOG.message}</Text>
                  <TextButton onClick={() => dialog.finish('discard')}>
                    <Text color={colors.destructive}>{FREE_RUN_END_DIALOG.discard}</Text>
                  </TextButton>
                </Column>
              ) : (
                <Text>
                  {end.endsAsCompleted
                    ? 'This run is done — it will be saved as completed.'
                    : 'Progress so far is saved as a partial run.'}
                </Text>
              )}
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              {end.mode === 'open' ? (
                <TextButton onClick={() => dialog.finish('save')}>
                  <Text>{FREE_RUN_END_DIALOG.save}</Text>
                </TextButton>
              ) : (
                <TextButton onClick={() => dialog.finish()}>
                  <Text color={colors.destructive}>End run</Text>
                </TextButton>
              )}
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => dialog.setOpen(false)}>
                <Text>Cancel</Text>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        </Island>
      ) : null}
    </View>
  );
}

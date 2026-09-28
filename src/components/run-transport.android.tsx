import { AlertDialog, Text, TextButton } from '@expo/ui/jetpack-compose';
import { useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { useTheme } from '@/hooks/use-theme';
import { runEngine } from '@/services/run-engine';

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
    <View className="flex-row items-center gap-10">
      <Island.IconButton
        systemName={{ android: 'stop' }}
        size={30}
        color={colors.textSecondary}
        label="End"
        disabled={locked}
        onPress={() => setEndDialogOpen(true)}
      />
      <Island.IconButton
        systemName={{ android: paused ? 'play_arrow' : 'pause' }}
        size={48}
        color={colors.text}
        label={paused ? 'Resume' : 'Pause'}
        disabled={locked}
        onPress={() => (paused ? runEngine.resume() : runEngine.pause())}
      />
      <Island.IconButton
        systemName={{ android: 'skip_next' }}
        size={30}
        color={colors.textSecondary}
        label="Skip"
        disabled={locked}
        onPress={() => runEngine.skipSegment()}
      />
      {/* why conditional: an AlertDialog is presented by mounting, so it exists only while open. */}
      {endDialogOpen ? (
        <Island matchContents>
          <AlertDialog onDismissRequest={() => setEndDialogOpen(false)}>
            <AlertDialog.Title>
              <Text>End this run?</Text>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <Text>
                {endsAsCompleted
                  ? 'This run is done — it will be saved as completed.'
                  : 'Progress so far is saved as a partial run.'}
              </Text>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton
                onClick={() => {
                  setEndDialogOpen(false);
                  runEngine.endEarly();
                }}
              >
                <Text color={colors.destructive}>End run</Text>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => setEndDialogOpen(false)}>
                <Text>Cancel</Text>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        </Island>
      ) : null}
    </View>
  );
}

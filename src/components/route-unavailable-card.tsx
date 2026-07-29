import * as Linking from 'expo-linking';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { locationTracker, type LocationPermissionStatus } from '@/services/location-tracker';

/**
 * Stands in for the map when a finished run has no drawable route (ADR 0013 domain component).
 * why not render nothing: location is optional by design, so a real cohort finishes every run
 * without a route — the run screen is honest about that and the summary must be too (spec §8).
 */
export function RouteUnavailableCard({
  recordedFixes,
  permission,
}: {
  recordedFixes: boolean;
  permission: LocationPermissionStatus | null;
}) {
  // why: the reason comes from the run, the CTA from the live permission. Reading the reason off
  // today's permission misattributes every earlier run once the user changes it.
  const denied = permission === 'denied';
  const offerCta = denied || permission === 'undetermined';

  return (
    <Card surface="card" className="gap-2">
      <Text
        variant="footnote"
        tone="secondary"
        className="font-semibold"
        accessibilityRole="header"
      >
        No route for this run
      </Text>
      <Text variant="small" tone="secondary">
        {recordedFixes
          ? 'No GPS signal for this run — common indoors or on a treadmill. Your time and intervals were still recorded.'
          : 'No location was recorded for this run, so there is no map. Your time and intervals were still recorded.'}
      </Text>
      {offerCta ? (
        <View className="flex-row">
          <Button
            variant="secondary"
            size="sm"
            // why: mirrors run-location-banner — Settings has no Location row for an app that has
            // never asked, so 'undetermined' must re-prompt natively instead (ADR 0008 §2).
            label={denied ? 'Open Settings' : 'Enable Location'}
            onPress={() =>
              void (denied ? Linking.openSettings() : locationTracker.requestPermission())
            }
          />
        </View>
      ) : null}
    </Card>
  );
}

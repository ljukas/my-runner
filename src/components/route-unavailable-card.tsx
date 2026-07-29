import * as Linking from 'expo-linking';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

/**
 * Stands in for the map when a finished run has no drawable route (ADR 0013 domain component).
 * why not render nothing: location is optional by design, so a real cohort finishes every run
 * without a route — the run screen is honest about that and the summary must be too (spec §8).
 */
export function RouteUnavailableCard({ locationOff }: { locationOff: boolean }) {
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
        {locationOff
          ? 'Location is off, so this run has no map. Your time and intervals were still recorded.'
          : 'No usable GPS signal for this run — indoors or on a treadmill, there is nothing to map.'}
      </Text>
      {locationOff ? (
        <View className="flex-row">
          <Button
            variant="secondary"
            size="sm"
            label="Open Settings"
            onPress={() => void Linking.openSettings()}
          />
        </View>
      ) : null}
    </Card>
  );
}

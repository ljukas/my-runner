import * as Linking from 'expo-linking';
import { SymbolView } from 'expo-symbols';
import { PixelRatio, View } from 'react-native';

import { Island } from '@/components/island';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { locationTracker, type LocationPermissionStatus } from '@/services/location-tracker';

const SYMBOL_POINTS = 17;

/**
 * What a run without location loses, and the one tap out of it (ADR 0008 §5).
 * In flow above the run's column rather than an overlay, so the rows below keep
 * their own space instead of running under it.
 */
export function RunLocationBanner({
  status,
  locked,
}: {
  status: Exclude<LocationPermissionStatus, 'granted'>;
  locked: boolean;
}) {
  const colors = useTheme();
  const denied = status === 'denied';
  return (
    <View className="items-center gap-6">
      <View className="items-center gap-2">
        <View className="flex-row items-center gap-1.5">
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <SymbolView
              name="location.slash"
              size={Math.round(SYMBOL_POINTS * Math.min(PixelRatio.getFontScale(), 1.6))}
              tintColor={colors.textSecondary}
            />
          </View>
          <Text variant="footnote" tone="secondary">
            Location is off
          </Text>
        </View>
        <Text variant="caption" tone="secondary" className="text-center" numberOfLines={2}>
          Distance and pace unavailable.
        </Text>
      </View>

      <Island.Button
        variant="secondary"
        label={denied ? 'Open Settings' : 'Enable Location'}
        disabled={locked}
        onPress={() => void (denied ? Linking.openSettings() : locationTracker.requestPermission())}
      />
    </View>
  );
}

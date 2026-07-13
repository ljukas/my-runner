import { HStack, Spacer, Toggle } from '@expo/ui/swift-ui';

import { Island } from '@/components/island';
import type { SettingsValues } from '@/services/settings';
import { settingsStore, useSetting } from '@/services/settings-store';

/**
 * A settings row bound to a boolean setting (ADR 0013). Renders the label and
 * the switch as separate elements in an `HStack` — rather than the `Toggle`'s
 * own `label` — so the switch is its own accessibility element. A Maestro tap
 * by `testID` then lands on the switch itself, not the merged row's dead centre
 * (retiring the coordinate tap that ADR 0016 recorded as an escape hatch).
 * Owns the store read/write, so screens pass only a key.
 */
export function SettingsToggle({
  label,
  settingKey,
  testID,
}: {
  label: string;
  settingKey: keyof SettingsValues;
  testID?: string;
}) {
  const value = useSetting(settingKey);
  return (
    <HStack>
      <Island.Text>{label}</Island.Text>
      <Spacer />
      <Toggle
        testID={testID}
        isOn={value}
        onIsOnChange={(next) => settingsStore.set(settingKey, next)}
      />
    </HStack>
  );
}

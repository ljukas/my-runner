import { Toggle } from '@expo/ui/swift-ui';

import type { SettingsValues } from '@/services/settings';
import { settingsStore, useSetting } from '@/services/settings-store';

/**
 * A settings row bound to a boolean setting (ADR 0013): it owns the store
 * read/write so screens pass only a key, and renders the system `Toggle` with
 * its native label.
 */
export function SettingsToggle({
  label,
  settingKey,
}: {
  label: string;
  settingKey: keyof SettingsValues;
}) {
  const value = useSetting(settingKey);
  return (
    <Toggle
      label={label}
      isOn={value}
      onIsOnChange={(next) => settingsStore.set(settingKey, next)}
    />
  );
}

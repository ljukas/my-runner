import { ListItem, Switch, Text } from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';

import type { SettingsValues } from '@/services/settings';
import { settingsStore, useSetting } from '@/services/settings-store';

/**
 * A Material list row bound to a boolean setting: it owns the store read/write
 * so screens pass only a key. The whole row toggles, not just the switch.
 */
export function SettingsToggle({
  label,
  description,
  settingKey,
}: {
  label: string;
  description?: string;
  settingKey: keyof SettingsValues;
}) {
  const value = useSetting(settingKey);
  const toggle = () => settingsStore.set(settingKey, !value);
  return (
    <ListItem modifiers={[clickable(toggle)]}>
      <ListItem.HeadlineContent>
        <Text>{label}</Text>
      </ListItem.HeadlineContent>
      {description ? (
        <ListItem.SupportingContent>
          <Text>{description}</Text>
        </ListItem.SupportingContent>
      ) : null}
      <ListItem.TrailingContent>
        <Switch value={value} onCheckedChange={(next) => settingsStore.set(settingKey, next)} />
      </ListItem.TrailingContent>
    </ListItem>
  );
}

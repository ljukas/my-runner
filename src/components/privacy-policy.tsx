import { Platform, View } from 'react-native';

import { Text } from '@/components/ui/text';

// The platform health store is the one sentence-level fork; the policy is otherwise the same text
// as docs/privacy-policy.md, which stays the hosted copy for the store listings.
const STORE = Platform.select({ android: 'Health Connect', default: 'Apple Health' });
const REVOKE_IN = Platform.select({ android: 'Health Connect', default: 'the Health app' });

const SECTIONS: readonly { title: string; body: string }[] = [
  {
    title: 'RunBro does not collect your data',
    body: 'RunBro has no backend, no accounts, and no analytics. Nothing you do in the app is sent anywhere. There is no server to send it to.',
  },
  {
    title: 'Where your data lives',
    body: `Your runs — times, distances, and recorded GPS routes — are stored in a database on your phone. They are included in your phone's own cloud backup, under your account and its provider's terms; RunBro has no access to that backup and no account of its own. Deleting the app deletes this data.`,
  },
  {
    title: 'Location',
    body: `RunBro uses your location only while a run is in progress, to measure distance and record your route, and only with the permission you grant it. Your location stays on your phone, except where you ask for it to be written to ${STORE} — see below.`,
  },
  {
    title: STORE,
    body: `If you allow it, RunBro writes finished runs to ${STORE} as workouts, with their duration, distance, and route. From there, ${STORE} governs the data like any other workout you've saved to it — including syncing it and sharing it with any other app you've separately given access to.\n\nRunBro only ever writes to ${STORE}. It requests no read access and never reads your health data — not your steps, not your heart rate, nothing. You can change or turn this off at any time in ${REVOKE_IN}.`,
  },
  {
    title: 'Contact',
    body: 'Open an issue at https://github.com/ljukas/my-runner.',
  },
];

export function PrivacyPolicy() {
  return (
    <View className="gap-6">
      <Text variant="footnote" tone="secondary">
        Last updated 22 September 2026
      </Text>
      {SECTIONS.map((section) => (
        <View key={section.title} className="gap-2">
          <Text variant="title2" className="font-semibold" accessibilityRole="header">
            {section.title}
          </Text>
          <Text tone="secondary">{section.body}</Text>
        </View>
      ))}
    </View>
  );
}

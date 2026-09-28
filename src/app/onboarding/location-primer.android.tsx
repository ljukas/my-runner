import { PermissionStepScreen } from '@/components/permission-step-screen';
import { locationTracker } from '@/services/location-tracker';

// Android's copy deliberately differs from the iOS primer (ADR 0025); read both before editing.
// The disclosure is Play's prominent-disclosure text, so it stays on screen, never behind a link.
export default function LocationPrimerScreen() {
  return (
    <PermissionStepScreen
      stepId="location-primer-v1"
      symbol={{ ios: 'location.fill', android: 'my_location' }}
      headline="Location for distance and cues"
      body="While you run, RunBro measures distance and pace, draws your route, and keeps the timer going when the screen is off."
      rows={[
        {
          symbol: { ios: 'speedometer', android: 'speed' },
          text: 'Distance and pace, live from GPS',
        },
        { symbol: { ios: 'map', android: 'map' }, text: 'Your route, drawn in the run log' },
        {
          symbol: { ios: 'bell', android: 'notifications' },
          text: 'A run notification keeps cues going with the screen off',
        },
      ]}
      disclosure="RunBro collects location data to measure distance, draw your route and keep cues running while the screen is off, including when the app is in the background. Location stays on your phone and is never shared. Not now is fine: every run is still timed, but without location there is no distance and cues stop once the screen is off. You can change this in Settings."
      primaryLabel="Continue"
      // "Not now" needs no handler: skipping is just advancing, and the just-in-time ask at the
      // first run start is the second chance (ADR 0008 §2).
      secondaryLabel="Not now"
      onPrimaryPress={async (advance) => {
        try {
          await locationTracker.requestPermission();
        } catch (error) {
          console.warn('[onboarding] location prompt failed', error);
        }
        // A denial advances exactly like "Not now" — location is optional (ADR 0008 §5).
        advance();
      }}
    />
  );
}

import { PermissionStepScreen } from '@/components/permission-step-screen';
import { requestWriteAccess } from '@/services/health';

// Health Connect's onboarding guidance is educate → consent → request, and asks that the data
// types written be named up front (carousel design §5.4) — hence the three rows below.
export default function HealthPrimerScreen() {
  return (
    <PermissionStepScreen
      stepId="health-primer-v1"
      symbol={{ ios: 'heart.fill', android: 'favorite' }}
      headline="Your runs, in Health Connect"
      body="Each finished run is saved as a running session, so apps that read Health Connect, like Fitbit or your watch's, pick it up."
      rows={[
        {
          symbol: { ios: 'figure.run', android: 'directions_run' },
          text: 'Exercise sessions, one for every finished run',
        },
        {
          symbol: { ios: 'map.fill', android: 'route' },
          text: 'Distance, and your route too if location is on',
        },
        {
          symbol: { ios: 'arrow.up.forward', android: 'arrow_outward' },
          text: 'Only ever writes. Not your steps, not your heart rate, nothing is read',
        },
      ]}
      disclosure="Not now is fine: your runs are saved here either way. You can set this up later in Settings, and change what RunBro may write at any time in Health Connect."
      primaryLabel="Set up Health Connect"
      secondaryLabel="Not now"
      onPrimaryPress={async (advance) => {
        // requestWriteAccess catches and logs its own failures (the composition seam, ADR 0011).
        const status = await requestWriteAccess();
        // A refusal advances exactly like "Not now" — Health Connect is optional (ADR 0011 §4).
        // Still undetermined means the dialog never answered — the user opened the privacy policy
        // from it, or it failed — so the step stays for a second tap or "Not now".
        if (status !== 'notDetermined') advance();
      }}
    />
  );
}

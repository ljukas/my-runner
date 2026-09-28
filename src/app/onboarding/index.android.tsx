import { useRouter } from 'expo-router';

import { OnboardingCarousel, type OnboardingCarouselPage } from '@/components/onboarding-carousel';
import { completeAndAdvance } from '@/services/onboarding-store';

// Android's copy deliberately differs from the iOS welcome (ADR 0025); read both before editing.
const PAGES: readonly OnboardingCarouselPage[] = [
  {
    shape: 'clover',
    symbol: { ios: 'figure.run', android: 'directions_run' },
    headline: 'From couch to 5K',
    body: 'Three short sessions a week for nine weeks. Walking at first, running thirty minutes straight by the end.',
    note: 'Couch to 5K is made for beginners. If you have a health condition or an old injury, have a word with your doctor first, and listen to your body.',
  },
  {
    shape: 'pillStar',
    symbol: { ios: 'timer', android: 'timer' },
    headline: 'Guided intervals',
    body: 'The timer tells you when to walk and when to run, and a cue lets you know at every switch.',
  },
  {
    shape: 'squircle',
    symbol: { ios: 'lock.fill', android: 'lock' },
    headline: 'Private and free',
    body: 'No account, no ads, no tracking. Your runs live on your phone and nowhere else.',
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <OnboardingCarousel
      pages={PAGES}
      finishLabel="Get started"
      onFinish={() => completeAndAdvance(router, 'welcome-v1')}
    />
  );
}

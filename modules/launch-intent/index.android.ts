import { requireNativeModule } from 'expo';

interface LaunchIntentModule {
  /** The action of the intent that launched the activity; `null` for a plain launcher start. */
  getAction(): string | null;
  addListener(
    event: 'onIntent',
    listener: (event: { action: string | null }) => void,
  ): { remove(): void };
}

export const LaunchIntent = requireNativeModule<LaunchIntentModule>('LaunchIntent');

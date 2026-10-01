# Free run — stage 5c: one health module on both platforms

Date: 2026-10-01
Spec: [free-run design](../specs/2026-09-29-free-run-design.md) §6 · ADRs:
[0011](../../adr/0011-apple-health-kingstinct-healthkit.md),
[0025](../../adr/0025-android-staged-migration.md),
[0026](../../adr/0026-free-run-open-mode-motion-buckets.md) · stacked on 5b (#92) · closes #90

## Goal

Health Connect writes become the app's own code, as HealthKit's did in 5b, and the two share one
API: one module, one adapter, one set of states.

## Owner decisions (2026-10-01)

- **One module, one adapter:** `modules/apple-health/` becomes `modules/health/` (JS name `Health`,
  neutral types). Android caches its status natively and answers synchronously. The
  `health-connect.ts` mapping moves into Kotlin.
- **The rationale moves into the module:** it watches the rationale intents, `requestWriteAccess`
  resolves `notDetermined` when the dialog was interrupted, and an event opens the privacy screen.
  `modules/launch-intent/` goes.
- **Offer to install Health Connect:** a new `updateRequired` state (Android 9–13, Health Connect
  missing or too old) with _Get Health Connect_, which opens the Play Store.
- **Session title:** _Week 1 · Day 1_ or _Free run_. HealthKit has no field Health shows, so iOS
  drops it.
- **Authorized means the exercise grant**, as on iOS; a refused route or distance is left out.
- **Test `updateRequired` on an API 33 image** (`RunBro_API_33`) rather than only on a device.

## Design

- **`modules/health/`:**
  - `index.ts` and `types.ts`, shared by both platforms: `authorizationStatus()` (synchronous),
    `requestWriteAccess()` (resolves with the status), `saveWorkout()` (`{ plain }`),
    `openSettings()`, `openStore()`, `consumeRationale()`, and the events
    `onAuthorizationChange` and `onRationale`.
  - `ios/`: the 5b Swift, renamed (`HealthModule`, `Health.podspec`), plus `unavailable`, a native
    `openSettings` (`x-apple-health://`, then Settings) and no-op `openStore` and
    `consumeRationale`.
  - `android/` (Kotlin, `connect-client` 1.1.0):
    - `HealthStatus` keeps the cached status and the "asked once" memory (SharedPreferences), and
      re-probes on creation, on every return to the foreground, after a request and after a
      refused save.
    - `Rationale` watches both rationale actions.
    - `HealthModule` shows the dialog through the activity's `ActivityResultRegistry` and decides
      the interruption.
    - `WorkoutWriter` deletes the app's distance records in the window, then makes one atomic
      insert (the session with its title, segments with PAUSE, the route, and a distance record per
      interval). On `IllegalArgumentException` it retries the insert without segments.
  - The module manifest declares the permissions and the Health Connect `<queries>` entry.
- **`plugins/with-health.js`** combines the iOS plist and entitlement with Android's rationale
  intent filter and `ViewPermissionUsageActivity` alias.
- **JS:**
  - `services/health/adapter.ts` replaces both forks.
  - `health-payload.ts` (renamed `healthkit.ts`) builds the payload for both platforms.
  - The port gains `updateRequired`, `openSettings`, `openStore` and `subscribeRationale`.
  - `health-status-row.tsx` is one file, with its store name from `constants/health-store.ts`.
  - The Settings screens and the Android primer handle `updateRequired`.
- **Removed:** `react-native-health-connect` and its patch, `modules/launch-intent/`, the forked
  adapter and the `open-health-app` and `rationale-intent` modules with their tests, and the
  `android-expo` fingerprint ignore path.

## Verification

- `bun test`, both typechecks, lint, and `bunx expo export` for both platforms.
- Fingerprints moved on both platforms, as accepted:

  | Variant               | 5b         | 5c         |
  | --------------------- | ---------- | ---------- |
  | iOS unset             | `620c1db…` | `a4a2693…` |
  | iOS `development`     | `40b4c43…` | `80002a3…` |
  | iOS `e2e`             | `f44dc76…` | `87ca7be…` |
  | Android unset         | `4a83a62…` | `a9fbe3c…` |
  | Android `development` | `273badd…` | `9bab200…` |
  | Android `e2e`         | `3ebafb7…` | `a3f9da7…` |

- On the emulators and the simulator, below. On devices: H1–H5 and C1–C4.

## Found on the emulators (2026-10-01)

- **The first build never resolved a request.** Through `RegisterActivityContracts`, _Don't allow_
  and the privacy link both left `requestWriteAccess` pending, and the lock it held stopped every
  later request from opening the dialog. On Android 14+ Health Connect's contract is a
  runtime-permission request, which Expo's registry starts with `requestPermissions`; the answer
  goes to `onRequestPermissionsResult`, which that registry never gets. The dialog now goes through
  the activity's own registry.
- **API 37:** the privacy link opened the policy and left _Not set up_. An exercise-only grant
  resolved `authorized` after 19 s of the dialog being open, and Settings turned to _Saving
  workouts_ from the event. A save with only that grant, then a save with all three: the data
  browser lists _Week 1 · Day 1_ and _Free run_ as single entries. The free run has its route and
  the segments Walking, Running, Rest, Walking, Pause and Walking, and its distance is five parts
  summing to 0.178 mi (286.7 m), with the 5a-era single record gone. A re-save left the same five.
  A revoke killed the process; the cold start read _Off_, and _Open Health Connect_ opened Health
  Connect. Granting there flipped Settings back on return. Health Connect's _Read privacy policy_
  opened ours. Overlapping segments saved plain (`{ plain: true }`; that probe left a "Fallback
  probe" session on 29 Sep in the emulator).
- **API 33 without Health Connect:** the primer and Settings showed _Get Health Connect_ and
  _Update needed_, and the button opened the Play Store, which stopped at sign-in.
- **iOS 26.5 simulator:** _Saving Workouts_, a re-save that ignored the extra `title` key, and
  `openSettings` opening Health with the back link to RunBro.

## Found in review (2026-10-01)

Four reviewers: Android and Health Connect best practice plus the Expo Modules Kotlin API
(against the `connect-client` AAR and the expo-modules-core sources), iOS and the JS↔native
contract (tests, both typechecks, both exports), ADR compliance, and comment density. None found a
Critical. Fixed:

- **A stale dialog result** stored by the activity's registry, when an activity was destroyed
  under an earlier dialog, would have answered the next request inside `register()`. The callback
  now ignores results until its own launch.
- **An interrupted dialog** published `notDetermined` even for a runner who had refused before; the
  earlier status now stands.
- **A fix without an altitude** went to Health Connect as 0 m with 0 m accuracy, a measured sea
  level. It now has no altitude.
- **Times** are checked as whole milliseconds, the same values Health Connect validates, and the
  distance records are built inside the fallback's reach.
- **The rationale subscription** listens before it consumes, so a request between the two calls is
  not held.
- **Docs:** ADR 0003's amendment for the single adapter, the port's growth to six members in ADR
  0011, and comments trimmed to the why.

Not changed:

- **The distance delete runs before the insert,** as on iOS, so a failed insert costs an earlier
  save its distance until the next save.
- **The Android manifest logic lives in `with-health.js`,** which iOS hashes. Every plugin file in
  `app.json` is a source on both platforms, so a separate file would not keep iOS out.
- **A restore from Recents after process death** can reopen the privacy screen, as before.
- **No migration of the old kv-store "asked" key**: Android has not shipped.

After the fixes, on API 37: asking again from _Off_ opened the dialog, _Allow all_ resolved
`authorized`, and a re-save left the free run's five distance parts (0.178 mi).

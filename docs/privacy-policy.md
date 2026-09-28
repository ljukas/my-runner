# RunBro — Privacy Policy

> **Placeholder — not yet hosted.** App Review requires this to be reachable at
> a public URL before submission, and that URL then has to be set in App Store
> Connect and linked from the app. Neither has been done: RunBro is not being
> submitted yet.

**Last updated:** 2026-09-22

The same text ships inside the app (`src/components/privacy-policy.tsx`),
reachable from Android Settings and from Health Connect's permission dialog.

## RunBro does not collect your data

RunBro has no backend, no accounts, and no analytics. Nothing you do in the app
is sent anywhere. There is no server to send it to.

## Where your data lives

Your runs — times, distances, and recorded GPS routes — are stored in a
database on your phone. They are included in your phone's own cloud backup
(iCloud on iPhone, Google's backup on Android), under your account and its
provider's terms; RunBro has no access to that backup and no account of its
own.

Deleting the app deletes this data.

## Location

RunBro uses your location only while a run is in progress, to measure distance
and record your route, and only with the permission you grant it while using
the app. Your location stays on your phone, except where you ask it to be
written to Apple Health or Health Connect — see below.

## Apple Health and Health Connect

If you allow it, RunBro writes finished runs to Apple Health (iPhone) or Health
Connect (Android) as workouts, with their duration, distance, and route. From
there, the health store governs the data like any other workout you've saved to
it — including syncing it and sharing it with any other app you've separately
given access to.

RunBro only ever **writes** to the health store. It requests no read access and
never reads your health data — not your steps, not your heart rate, nothing.
You can change or turn this off at any time in the Health app or in Health
Connect.

## Contact

Open an issue at https://github.com/ljukas/my-runner.

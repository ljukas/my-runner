# My Runner 🏃

A free Couch-to-5K app: it guides someone who can barely run through a progressive
walk/run program until they can run 5 km. Inspired by the paid App Store
equivalents — but free.

- **Private by design** — no backend, no accounts, no analytics. All your data
  stays on your device; iCloud is the only backup/sync mechanism.
- **Mobile only** — iOS first, Android second. There is no web version.
- Built with [Expo](https://expo.dev) (React Native), using
  [Bun](https://bun.sh) as the package manager.

## Running the app in development

You'll need Node LTS, Bun, and Xcode (for iOS) or Android Studio (for Android).

```bash
bun install       # install dependencies
bun run ios       # build + install the dev client on the iOS simulator
bun run start     # day-to-day: start the dev server, press i / a to open the app
```

`bun run ios` (or `bun run android`) is needed on first run and again after any
native change — the app uses a custom dev client, not Expo Go. For everyday
JS/UI work, `bun run start` with an already-installed dev client is enough.

## Installing on your own iPhone

There is no Apple Developer account set up yet, so **this is currently the only
way to get the app onto a physical iPhone**:

```bash
bun expo run:ios --device --configuration Release
```

That builds a standalone release version and installs it on a connected iPhone,
signed with a free Apple ID (Xcode "personal team"). One-time setup: sign into
Xcode with an Apple ID, enable Developer Mode on the phone, and trust the
developer certificate in Settings.

Things to know about free signing:

- The app **stops launching after 7 days**. Just run the command again — it
  reinstalls over the top and everything keeps working.
- Your data **survives** every install-over-the-top (newer versions included).
  It's only lost if you delete the app.

## Builds & releases

Cloud builds run on [EAS](https://expo.dev/eas); profiles live in `eas.json`.
The `internal` profile produces a prod-like build for personal devices, but it
**requires a paid Apple Developer membership** (register the device with
`eas device:create`, then `eas build -p ios --profile internal`) — blocked until
that account exists.

Store releases are fully automated: merging a release PR tags a version and
ships it, over-the-air when possible. Don't hand-edit `CHANGELOG.md` or version
fields — the release tooling owns them.

## More documentation

- [`AGENTS.md`](AGENTS.md) — contributor & agent guidance (commands, conventions, architecture)
- [`docs/adr/`](docs/adr/) — architectural decision records
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — design specs, including the master C25K app design

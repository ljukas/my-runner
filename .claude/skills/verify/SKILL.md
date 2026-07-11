---
name: verify
description: Use when a change in this repo needs runtime evidence — confirming UI, navigation, styling, or behavior works on the iOS simulator, or gathering before/after proof for a fix.
---

# Verifying changes in this app (argent simulator loop)

All runtime verification happens on the iOS simulator through the argent MCP tools.
Follow `.claude/rules/argent.md` (device selection, discovery-before-tap) and load the
matching argent skill first: `argent-ios-simulator-setup` (boot + UDID),
`argent-react-native-app-workflow` (run the app, Metro, build/runtime errors),
`argent-device-interact` (tap/type/screenshot), `argent-screenshot-diff` (visual
regressions).

## The loop

1. **Metro** — start on an explicit free port; NEVER 8081/8082 (the user's own dev
   servers may occupy them — never kill those). A port is free when
   `lsof -tiTCP:<port> -sTCP:LISTEN` prints nothing; try 8090 first:
   ```bash
   EXPO_NO_TELEMETRY=1 CI=1 bun expo start --port 8090
   ```
2. **Simulator** — `list-devices` → prefer a booted device, else `boot-device`.
   (`list-devices` also gives the `<udid>` used below.)
3. **Open the app** — while `expo-dev-client` is absent from package.json (the current
   state), the app runs in **Expo Go** (`host.exp.Exponent`): argent `open-url` with
   `exp://127.0.0.1:<port>`. If Expo Go isn't on the simulator, kill your Metro and
   rerun the step-1 command with `--ios` appended — Expo CLI installs Expo Go and opens
   the project; keep that server as your Metro. (Once a later stage adds
   `expo-dev-client`, build with `bun expo run:ios` and use `launch-app` with
   `se.lukaslindqvist.myrunner` instead.)
4. **Drive & verify** — discovery tool (`describe` / `debugger-component-tree`) before
   every tap; `await-ui-element` to wait for state, never screenshot-polling;
   `screenshot` for evidence. Don't hardcode routes or screen names — the screen set
   changes every delivery stage; discover what's actually there.
5. **Clean up** — `stop-all-simulator-servers`; kill only the Metro you started:
   `lsof -tiTCP:<port> -sTCP:LISTEN | xargs kill`.

## Fast probes (no simulator needed)

- `bun run typecheck` — `tsc --noEmit`.
- Native bundle smoke (uses the Metro from step 1; proves the Metro transform incl.
  Uniwind compiles for iOS):
  ```bash
  curl "http://localhost:<port>/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&lazy=false"
  ```
  200 + no error in the server log = the iOS bundle builds. Smoke test only —
  rendering evidence requires the simulator loop above.

## Theming checks (Uniwind)

Flip the simulator's system theme (device options go through `xcrun`, per the argent
rule):

```bash
xcrun simctl ui <udid> appearance dark   # or: light
```

Take a `screenshot` before and after the flip (or use `argent-screenshot-diff`).
Both Uniwind `className` tokens AND JS-driven colors (`useColorScheme` via
`src/constants/theme.ts`) must follow. If Uniwind tokens flip but JS colors don't,
the `Colors` mirror is out of sync with `src/global.css`. Restore the original
appearance when done.

## Gotchas

- `expo-env.d.ts` and `.expo/types/` are gitignored generated files — a fresh worktree
  fails `bun run typecheck` until they exist (run `expo start` once, or copy from the
  main checkout).
- `bun run lint` scaffolds `eslint.config.js` on first run (intentionally not committed).

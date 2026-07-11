---
name: verify
description: Build, launch, and drive this Expo app to verify a change at runtime (web surface + native bundle probe).
---

# Verifying changes in this app

## Launch (web surface — fastest)

```bash
EXPO_NO_TELEMETRY=1 CI=1 bun expo start --port 8090   # pick a free port; NEVER use 8081/8082
```

Wait for `Waiting on http://localhost:<port>`, then drive `http://localhost:<port>` in a browser.
First web bundle takes ~10s; the page is client-rendered, so curl only proves the server is up —
use a real browser for rendering evidence.

## Useful probes

- **Theme tokens (Uniwind):** on web, check `getComputedStyle(document.documentElement).getPropertyValue('--color-background')` etc.
- **Dark mode without changing OS theme:** `document.documentElement.classList.add('dark')` flips all
  Uniwind CSS variables (ships as both a `prefers-color-scheme` media query and a `.dark` class).
  JS-driven colors (`useColorScheme`) won't flip this way — that's expected, not a bug.
- **Native style pipeline without a simulator:** force Metro to compile the iOS bundle:
  `curl "http://localhost:<port>/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&lazy=false"`
  — 200 + no error output in the server log means the native transform (incl. Uniwind) succeeded.
- Both tab screens are `/` (Home) and `/explore`.

## Gotchas

- `expo-env.d.ts` and `.expo/types/` are gitignored generated files — a fresh worktree fails
  `tsc` until they exist (copy from the main checkout or run `expo start` once).
- `bun run lint` scaffolds `eslint.config.js` on first run (intentionally not committed).
- Kill only the dev server you started (`lsof -tiTCP:<port> -sTCP:LISTEN | xargs kill`).

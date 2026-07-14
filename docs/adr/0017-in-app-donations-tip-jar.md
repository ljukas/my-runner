# 17. In-app donations: a client-only tip jar behind a Tip-jar port via expo-iap, RevenueCat and external links excluded from the default

Date: 2026-07-14

## Status

Proposed — draft for review. Flip to `Accepted` on merge.

## Context

My Runner is free with no monetization (`AGENTS.md`). The goal is narrow: let a
small fraction of users optionally chip in enough to offset the one fixed cost —
the ~$99/yr Apple Developer membership — without turning the app into a paid or
freemium product. The feature was researched through the feasibility and
local-first lenses first; full evidence and citations are in
[`docs/superpowers/research/2026-07-14-in-app-donations.md`](../superpowers/research/2026-07-14-in-app-donations.md).
The findings that constrain this decision:

- **Apple permits tipping the developer, but only through IAP.** Guideline 3.1.1:
  *"Apps may use in-app purchase currencies to enable customers to 'tip' the
  developer."* The charity/nonprofit route (3.2.1(vi), 3.2.2(iv)) is closed to an
  individual for-profit developer, and the no-IAP gift exception (3.2.1(vii)) is
  person-to-person, not user-to-developer. So a compliant, global money button
  **is** an IAP.
- **The "unlocks nothing" property is load-bearing, not a detail.** A tip that
  grants no feature removes the only reason IAP flows normally reach a server
  (receipt validation to protect an entitlement). That deletes an entire
  dimension — server validation, entitlement state, restore — from the design,
  which is what lets the capability stay **fully local-first** and keeps its
  interface tiny.
- **The stack has no first-party IAP module.** `expo-in-app-purchases` is
  unmaintained (last publish ~3 years ago) and dropped from the Expo guide. The
  official guide endorses exactly two options: **`expo-iap`** (a client-side Expo
  Module wrapping iOS StoreKit 2 and Android Play Billing 8.x, config-plugin/CNG
  friendly, consumables via `finishTransaction({ isConsumable: true })`) and
  **RevenueCat** (`react-native-purchases`, which is a client for a managed
  **backend** doing receipt validation, entitlements, **analytics**, and sync).
- **`AGENTS.md` hard constraints:** no backend, no accounts, no analytics;
  on-device data with iCloud as the only sync; iOS-primary, Android-secondary; the
  app is marketed as free.
- **Architecture reality (codebase exploration).** [ADR 0003](0003-platform-ports-and-adapters.md)
  ("platform capabilities behind ports & adapters") is **Accepted but not yet
  realized as a native-SDK port** — no `services/<capability>/port.ts`, no
  `adapter.ios.ts`, no `moduleSuffixes` fork mechanism exist. The only module that
  embodies ADR 0003's *spirit* today is the persistence seam: the `RunPersistence`
  interface (`src/services/run-engine/types.ts`) implemented by `dbRunPersistence`
  (`src/db/save-run.ts`) and constructor-injected at the composition root
  (`src/services/run-engine/index.ts`). The elevation port ([ADR 0015](0015-run-elevation-on-device-barometer.md))
  is Proposed and unbuilt. **This capability would be the first to use ADR 0003's
  prescribed `port.ts` + `adapter.ios.ts` layout for real.**
- **Where it lives.** The natural surface is a new `Section` in
  `src/app/(tabs)/settings.tsx`, which already composes `@expo/ui` via the `Island`
  seam ([ADR 0005](0005-system-native-ui-expo-ui.md)/[ADR 0013](0013-component-design-conventions.md))
  with a tap-to-act `Button … onPress` idiom (e.g. "Reset onboarding"). Because the
  tip unlocks nothing, **no persistence is required** — neither the settings store
  nor the Drizzle DB ([ADR 0004](0004-local-storage-expo-sqlite-drizzle.md)) is
  touched by the core flow.

## Decision

**Build a *tip jar* behind a `services/tip-jar` port ([ADR 0003](0003-platform-ports-and-adapters.md)),
using `expo-iap` consumables, client-only, on the App Store Small Business Program
(15%). The user-facing label is "Support the app" — never "Donate". RevenueCat and
an external payment link are excluded from the default.** Accepted now to fix the
approach; implemented when the tip jar ships (the same "decide the shape before the
stage" posture as ADR 0010 and ADR 0015).

1. **The seam — a Tip-jar port.** `services/tip-jar/port.ts` exposes a small,
   platform-free interface holding only types — no `expo-iap` import. Its shape is
   settled at build time but is deliberately narrow, roughly:
   `isAvailable(): Promise<boolean>`, `getTiers(): Promise<TipTier[]>`,
   `tip(tierId): Promise<TipResult>` (a result union:
   `purchased | cancelled | unavailable | failed`). **It carries no
   entitlement, receipt, or restore method** — because the tip unlocks nothing,
   there is nothing to restore or validate, and the interface must not grow those.
   The settings surface imports the port *type* and a service singleton; it never
   imports `expo-iap`.
2. **The adapter.** `services/tip-jar/adapter.ios.ts` wraps `expo-iap` (StoreKit 2)
   and owns the entire purchase lifecycle behind the port — StoreKit connection,
   product fetch, `requestPurchase`, the purchase listener, `finishTransaction({
   purchase, isConsumable: true })`, and the error taxonomy. `adapter.android.ts`
   (Play Billing, same port) lands with the Android pass. Nothing outside
   `services/` imports `expo-iap`; enforce with the ADR 0003 `no-restricted-imports`
   rule when it is added.
3. **Depth (why a port earns its keep here).** The "unlocks nothing" invariant is
   what makes this a *deep* module: it strips the server-validation and
   entitlement-state machinery that normally makes an IAP integration shallow and
   leaky, leaving a ~3-method interface over a large amount of hidden StoreKit
   sequencing — high leverage for a tiny surface. Applying the deletion test to the
   port: deleting it does not remove complexity, it **scatters** the StoreKit
   lifecycle into `settings.tsx`, imports a native SDK into the view layer (against
   ADR 0003's discipline), and forces the Android retrofit to touch the screen. So
   the port *concentrates* complexity behind a stable seam — the signal that it is a
   real deepening, not indirection for its own sake.
4. **No server-side validation.** Client-only is safe **because the tip unlocks
   nothing**: a spoofed local "success" moves no money to the developer and, with no
   analytics, corrupts no metric. This is the crux that keeps the capability
   `Fully local`.
5. **No storage.** The core flow persists nothing. A later "you've tipped — soften
   the ask" nicety would be a single additive `SettingsValues` boolean, not a
   purchases/transactions table; it stays on-device.
6. **The surface.** A "Support" `Section` in `src/app/(tabs)/settings.tsx`, one
   tap-to-act `Island.Button … onPress` per tier, composed only from `ui/` +
   `island/` primitives (ADR 0013/0005) — a domain component (`TipJarSection`) that
   binds the singleton, mirroring `SettingsToggle`'s store-binding precedent. No
   raw RN `Text`/`Pressable` in the screen.
7. **Metadata / positioning.** Accept the unavoidable "In-App Purchases" store
   badge (any IAP triggers it). Keep the "100% free — every feature, no paywalls,
   no ads" claim, which stays truthful; **never** claim "no in-app purchases"
   (false, and rejectable), and disclose the tip (guideline 2.3.2). Keep the word
   "free" out of the app *name* (2.3.7).
8. **Commission.** Enroll in the App Store Small Business Program (15%); new
   developers qualify. Google Play's equivalent 15%-first-$1M program covers Android.

## Consequences

- **First real ADR 0003 native-SDK port.** This establishes the prescribed
  `services/<capability>/port.ts` + `adapter.ios.ts` + `moduleSuffixes` layout in
  the codebase for the first time (the persistence seam only embodies the spirit;
  the elevation port is unbuilt). Whichever of tip-jar or elevation ships first
  pays the one-time cost of introducing `moduleSuffixes` to `tsconfig.json`.
- **A community-dependency exception — but a narrow one.** `expo-iap` is not
  first-party, so per the official-tooling preference it is an explicit, priced
  exception, like react-native-maps in [ADR 0010](0010-maps-expo-maps-ios18-floor.md).
  It is *narrower* than the rejected RevenueCat alternative (no backend, no account,
  no analytics) and, unlike [ADR 0015](0015-run-elevation-on-device-barometer.md)'s
  fully first-party sensors, this capability cannot avoid a community dependency at
  all — Apple has no first-party RN IAP module.
- **Fully local-first is preserved.** No backend, no account, no analytics; Apple /
  Google act only as the payment rail, exactly as they already do for App Store
  distribution.
- **The interface is the test surface.** A fake `TipJar` port lets `TipJarSection`
  and any tip-prompt logic be unit-tested under `bun test` with no native mocking
  (ADR 0003 §7); the adapter gets device-level verification (a StoreKit sandbox
  spike + a Maestro/manual check), not SDK-internal mocks.
- **Native change with release implications.** Adding `expo-iap` needs a dev build,
  a config plugin, and per-store product configuration (App Store Connect / Play
  Console). It changes the `@expo/fingerprint`, so the first release carrying it is
  a native store build, not an OTA update ([ADR 0012](0012-release-please-fingerprint-gated-releases.md)).
- **Android is "write an adapter only"** — the port, the surface, and the tests are
  untouched by the Android pass.
- **Cost:** one more port + adapter pair that must resist method bloat like the
  others (ADR 0003), and a store badge the app must live with.

## Alternatives considered

- **RevenueCat (`react-native-purchases`)** — rejected: its value *is* a managed
  backend + account + analytics/attribution, which directly violates the
  no-backend/no-accounts/no-analytics line in `AGENTS.md`. It buys cross-platform
  entitlement sync and receipt validation that a tip granting nothing does not need.
- **A US-only external payment link (Ko-fi / PayPal / GitHub Sponsors) as the
  primary mechanism** — rejected as primary: it is US-storefront-only (must be
  region-gated or it fails review elsewhere), rests on a legally unsettled
  commission carve-out (Dec 2025 Ninth Circuit remand), needs your own payment
  processor, and is a "component that's really an adapter" leaking a browser link
  into the screen. Its one advantage — no store badge — does not outweigh losing
  global reach and local-first simplicity. **Retained as a possible deferred,
  opt-in *additive*** behind the same port (an `external-link` tier surfaced only to
  US users) if avoiding the badge ever outranks global reach — a pure adapter
  extension, no reshaping.
- **Framing it as a "donation" / using the charity route** — rejected: 3.2.2(iv)
  bars a non-nonprofit from collecting charity funds in-app and the word "donate"
  tends to route the app into the nonprofit review lane and a rejection. Both the
  internal domain term (*tip*) and the UI label ("Support the app") avoid it.
- **A non-consumable "unlock nothing" product** — rejected: a tip should be
  repeatable, so a **consumable** is the correct StoreKit type; it also needs no
  restore flow, keeping the port narrow.
- **Direct `expo-iap` calls in `settings.tsx` (no port)** — rejected by the
  deletion test (see Decision §3): it scatters the StoreKit lifecycle into the view
  layer and imports a native SDK there, against ADR 0003.
- **`expo-in-app-purchases`** — rejected: unmaintained (last publish ~3 years ago)
  and dropped from the official Expo guide.
- **Defer donations entirely** — viable and not precluded: this ADR fixes *how* a
  tip jar is built if built, not *that* it must be. The build commitment remains a
  separate call.

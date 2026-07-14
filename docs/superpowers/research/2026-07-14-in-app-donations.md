# In-app donations (tip jar) — research

Date: 2026-07-14
Status: **research / options under consideration** — not a decision to build.

**Question:** Can My Runner accept optional user donations to offset its running
cost (the $99/yr Apple Developer fee) while staying 100% free, on-device, and
App-Store-compliant — and which mechanism (in-app purchase vs. external link)
fits the local-first constraints and the "100% free" positioning?

## TL;DR

- **Feasibility:** `Feasible` (iOS and Android) — a "tip the developer" consumable
  is explicitly permitted by Apple guideline 3.1.1 and buildable on Expo SDK 57 +
  CNG with a config-plugin library and no custom native code. The only build cost
  is a store-side product setup and a **community IAP dependency** (there is no
  first-party Expo IAP module) — an explicit, priced tooling exception like ADR 0010.
- **Local-first fit:** `Fully local` for the recommended path — a consumable that
  **unlocks nothing** needs no server-side receipt validation, so the whole flow is
  client-only StoreKit/Play Billing: no backend, no account, no analytics. (The
  RevenueCat route is `Requires network/backend` and is disqualified; an external
  link is `Local, optional network`.)
- **Recommended approach:** **Option A** — a client-only consumable tip jar via
  **`expo-iap`**, labelled "Support the app" (not "Donate"), on the App Store
  Small Business Program (15%). It stays fully local-first and global, at the cost
  of the unavoidable "In-App Purchases" badge on the store listing. This is an
  assessment, not a commitment to build.

## Context

My Runner is free with no monetization (`AGENTS.md`). The owner's goal is narrow:
let a small fraction of users optionally chip in enough to cover the one fixed
cost — the Apple Developer membership — without turning the app into a paid or
freemium product. Every feature must remain free; the money button must be
*optional* and grant *nothing*.

This is a **new capability**, not part of a numbered delivery stage; it sits on
the roadmap for after the current stages. Subsystems / decisions it touches:

- **`AGENTS.md` hard constraints** — no backend, no accounts, no analytics;
  on-device data with iCloud as the only sync; iOS-primary, Android-secondary;
  the app is marketed as free. Any donation mechanism must hold all of these.
- **[ADR 0003](../../adr/0003-platform-ports-and-adapters.md) (ports & adapters)** —
  a purchase/"support" capability is a platform capability and belongs behind a
  port, like every other native seam.
- **[ADR 0005](../../adr/0005-system-native-ui-expo-ui.md) (@expo/ui islands)** and
  **[ADR 0013](../../adr/0013-component-design-conventions.md) (component conventions)** —
  the "Support the app" surface (likely a settings row → screen/sheet) composes
  existing `ui/`/`island/` primitives; no new visual system.
- **CNG / `app.json`** — IAP requires a **development build** (custom native code),
  a config plugin, and App Store Connect / Play Console product configuration. The
  `ios.bundleIdentifier` / `android.package` (`se.lukaslindqvist.myrunner`) are
  already set.
- **Store metadata** — interacts directly with the "100% free" positioning (see
  the App Store-presentation finding below).

## Findings

### Apple explicitly allows tipping the developer — but only through IAP

- **A developer tip jar is a first-class, permitted use of IAP.** Guideline 3.1.1:
  *"Apps may use in-app purchase currencies to enable customers to 'tip' the
  developer or digital content providers in the app."* The tip must unlock
  nothing; the moment a payment grants a feature it is a normal purchase (still
  IAP). ([App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), verified 2026-07-14.)
- **You cannot route a developer tip outside IAP by calling it a "donation".**
  The charity path is closed to an individual for-profit developer: 3.2.2(iv)
  bars *"collecting funds within the app for charities and fundraisers"* unless you
  are an **approved nonprofit** (3.2.1(vi), Apple-Pay-based); 3.2.1(vii)'s no-IAP
  gift exception is **person-to-person** ("100% of the funds go to the receiver"),
  not user-to-developer. ([Guidelines](https://developer.apple.com/app-store/review/guidelines/), verified 2026-07-14; adversarial check — charity apps by non-nonprofits are routinely rejected under 3.2.2: [Apple Developer Forums thread 130952](https://developer.apple.com/forums/thread/130952), 2026-07-14.)
- **Naming matters at review.** Label the button "tip" / "support the developer" /
  "buy me a coffee", **not** "donate" — the latter tends to route the app into the
  charity/nonprofit review lane and draws a "are you a registered nonprofit?"
  rejection. (Same forum evidence, 2026-07-14.)

### Any IAP product forces the "In-App Purchases" badge — this is the one hard cost

- **A consumable tip makes the store listing show "Offers In-App Purchases".** The
  label appears near the Get button on the product page and cannot be hidden or
  exempted by IAP type (consumable, non-consumable, or subscription all trigger
  it). ([Apple Support — In-App Purchases](https://support.apple.com/en-us/102383), verified 2026-07-14.)
- **The "100% free" claim stays truthful and compliant if worded precisely.**
  Guideline 2.3 only forbids *misleading* metadata. "Every feature is free" is
  accurate; **"no in-app purchases" would be false** (the badge proves otherwise)
  and rejectable. 2.3.2 requires disclosing what IAPs are for — naming the tip
  satisfies that; 2.3.7 keeps promotional/price words like "free" out of the app
  *name* (fine — the app is "My Runner", not "My Runner Free"). ([Guidelines 2.3.2 / 2.3.7](https://developer.apple.com/app-store/review/guidelines/), verified 2026-07-14; [metadata-rejection guidance](https://shopapper.com/fix-app-store-metadata-rejection-guideline-5-2-1-2-3-7/), 2026-07-14.) Net: the app can still brag *"100% free — every feature, no paywalls, no ads; the only in-app purchase is an optional tip that unlocks nothing."*

### External-link donations avoid the badge but are US-only and legally unsettled

- **Since May 2025, the US storefront allows external payment links with no
  entitlement.** Guideline 3.1.1(a) now carves out the US: apps *may* include
  "buttons, external links, or other calls to action" to outside payment methods
  (Ko-fi, PayPal, GitHub Sponsors), and an external link is **not** an IAP product,
  so it does **not** trigger the store badge. ([9to5Mac, 2025-05-01](https://9to5mac.com/2025/05/01/apple-app-store-guidelines-external-links/); [Guidelines 3.1.1(a)](https://developer.apple.com/app-store/review/guidelines/), verified 2026-07-14.)
- **It is US-storefront-only and must be region-gated.** The guideline still
  states that in all storefronts *except* the US, apps and metadata *"may not
  include buttons, external links, or other calls to action that direct customers
  to purchasing mechanisms other than in-app purchase."* An un-gated external
  button fails review outside the US. ([Guidelines 3.1.1(a)](https://developer.apple.com/app-store/review/guidelines/), verified 2026-07-14.)
- **The zero-commission window is closing.** In December 2025 the Ninth Circuit
  ruled Apple *may* charge a "reasonable commission" on external-link purchases and
  remanded to set the amount; no commission was being charged at that time, but the
  "keep ~100%" advantage is not durable. ([MacRumors, 2025-12-11](https://www.macrumors.com/2025/12/11/apple-app-store-fees-external-payment-links/), verified 2026-07-14.)

### The stack has no first-party IAP module; the Expo-endorsed options are `expo-iap` and RevenueCat

- **`expo-in-app-purchases` is dead.** Unmaintained, last published ~3 years ago
  (v14.5.0) and dropped from the official guide. ([npm: expo-in-app-purchases](https://www.npmjs.com/package/expo-in-app-purchases), verified 2026-07-14.)
- **The official Expo guide recommends exactly two libraries:** `expo-iap` ("a
  React Native library for in-app purchases that conforms to the OpenIAP
  specification") and `react-native-purchases` (RevenueCat). It notes IAP
  *"require[s] configuring custom native code"* → a **development build** is
  mandatory. ([Expo — Using in-app purchases](https://docs.expo.dev/guides/in-app-purchases/), verified 2026-07-14.)
- **`expo-iap` is a client-side Expo Module (config plugin / CNG friendly).** It
  wraps iOS StoreKit 2 and Android Play Billing 8.x, supports consumables via
  `requestPurchase(...)` → `finishTransaction({ purchase, isConsumable: true })`,
  and needs no custom native code beyond the plugin. ([expo-iap docs](https://hyochan.github.io/expo-iap/) via Context7 `/hyochan/expo-iap` v3.1.23, verified 2026-07-14.)
- **Server-side receipt validation is a fraud control for *unlocking* content —
  it does not apply to a tip.** `expo-iap`'s docs push "validate on your server
  before granting the item" for security, but the thing being protected is the
  granted entitlement. A tip grants nothing, so there is no entitlement to protect
  and no fraud incentive (a spoofed local "success" moves no money to the developer
  and, with no analytics, corrupts no metric). Client-only is therefore genuinely
  safe *for a non-unlocking tip specifically*. ([expo-iap purchases guide](https://github.com/hyochan/expo-iap/blob/main/docs/docs/guides/purchases.md), verified 2026-07-14; reasoning, flagged as analysis not a cited claim.)
- **RevenueCat bundles a backend, account, and analytics.** `react-native-purchases`
  is a client for the RevenueCat *backend service* that handles receipt validation,
  entitlements, **analytics**, cross-platform sync, and webhooks to attribution
  tools. That is precisely the backend + account + analytics that `AGENTS.md`
  forbids. ([RevenueCat Expo install](https://www.revenuecat.com/docs/getting-started/installation/expo); [RevenueCat/react-native-purchases](https://github.com/RevenueCat/react-native-purchases), verified 2026-07-14.)

### Economics and platform reach

- **Apple takes 15%, not 30%.** The App Store Small Business Program cuts commission
  to 15% for developers with ≤ $1M USD proceeds/year; **new developers qualify**,
  and it applies 15 days after the fiscal month of approval. To net the ~$99 fee the
  app needs ~$117/yr in gross tips. ([Apple — Small Business Program](https://developer.apple.com/app-store/small-business-program/), verified 2026-07-14.)
- **Both target platforms are covered.** `expo-iap` handles iOS (primary) and
  Android (secondary) with one API; Google Play has an equivalent 15%-first-$1M
  program. A tip is a momentary, user-initiated interaction — **no background work,
  no sensors → negligible battery impact.**

## Options

### Option A — Client-only consumable tip jar via `expo-iap`  ✅ recommended
A "Support the app" surface offering a few consumable products (e.g. $1.99 / $4.99
/ $9.99) through `expo-iap`. On success, call `finishTransaction({ isConsumable:
true })` and show a thank-you — **grant nothing**, run **no** server validation
(unnecessary for a non-unlocking tip). Behind an ADR 0003 port. Global (iOS +
Android), 15% via Small Business Program.
*Trade-offs:* forces the unavoidable "In-App Purchases" store badge; pulls in a
community IAP dependency (priced exception); requires a dev build + App Store
Connect / Play Console product setup.

### Option B — Same tip jar via RevenueCat (`react-native-purchases`)
Identical UX, but purchases flow through RevenueCat's managed backend, which adds
turnkey cross-platform handling and restore.
*Trade-offs:* **directly violates `AGENTS.md`** — it introduces a third-party
backend, a RevenueCat account, and analytics/attribution telemetry. Buys
convenience the app doesn't need (no subscriptions, no cross-device entitlements —
a tip grants nothing to sync). Documented for contrast; **not aligned with this app.**

### Option C — US-only external "support" link
No IAP. A "Support the developer" row opens an external page (Ko-fi / PayPal /
GitHub Sponsors) via `expo-web-browser`/`Linking`, shown **only** to US-storefront
users behind a region check.
*Trade-offs:* avoids the store badge and (for now) keeps ~100%, but is
**US-only** (must region-gate or fail review elsewhere), depends on a legally
**unsettled** commission carve-out (Dec 2025 remand), needs your own payment
account, and carries higher review friction. Best considered only as an *additive*
US secondary later — not the primary mechanism.

## Comparison

| | A — `expo-iap` tip jar | B — RevenueCat tip jar | C — US external link |
|---|---|---|---|
| Feasibility | `Feasible` (both platforms) | `Feasible` | `Feasible` (US only) |
| Local-first | **`Fully local`** (client-only, no backend) | `Requires network/backend` — violates `AGENTS.md` | `Local, optional network` |
| Battery / power | Negligible (user-initiated, momentary) | Negligible | Negligible |
| Platform reach | iOS + Android | iOS + Android | US iOS only (region-gated) |
| Store "IAP" badge | **Yes** (unavoidable) | Yes | **No** |
| Cost | 15% (Small Business Program) | 15% + RevenueCat free-tier ceiling | ~0% now, "reasonable" fee TBD |
| Maintenance / tooling | Community Expo module (priced exception) | Community lib **+ permanent 3rd-party backend/account** | 1st-party link APIs + own payment processor |

## Feasibility assessment

**`Feasible` on both platforms.** A developer tip is expressly permitted by
guideline 3.1.1, and `expo-iap` implements consumable purchases on iOS StoreKit 2
and Android Play Billing through a config plugin with no custom native code — it
fits Expo SDK 57 + CNG. The real costs are operational, not architectural: a
development build, per-store product configuration in App Store Connect / Play
Console, and a **community dependency** (there is no first-party Expo IAP module
since `expo-in-app-purchases` was abandoned). Per the project's official-tooling
preference, that dependency is an explicit, priced exception — the same posture
ADR 0010 takes toward react-native-maps — and `expo-iap` is the Expo-guide-endorsed,
client-side choice that minimizes it.

## Local-first assessment

**`Fully local` for Option A.** A tip that unlocks nothing removes the only reason
IAP flows usually reach a server (receipt validation to protect an entitlement),
so the entire transaction is client-side StoreKit / Play Billing. Apple/Google act
as the payment rail — exactly as they already do for App Store distribution itself
— so there is no *app* backend, no account, and no analytics. That holds the
`AGENTS.md` line exactly. **Option B fails it**: RevenueCat's value *is* a backend
+ account + analytics. **Option C is `Local, optional network`**: it opens an
external page (network needed only at that moment) and the app remains fully
functional offline, but it moves payment off-device to a third party and is
US-gated. The feasible ∩ fully-local ∩ global intersection is precisely Option A.

## Recommendation

If/when donations are built, adopt **Option A**: a client-only consumable tip jar
via `expo-iap`, labelled "Support the app / Buy me a coffee" (never "Donate"),
granting nothing, behind an ADR 0003 port, on the Small Business Program (15%). It
is the only mechanism that is simultaneously compliant, fully local-first, and
global. Its one real cost is the "In-App Purchases" store badge — which is a
*product/positioning* trade-off, not a rules problem: the app can still truthfully
advertise "100% free — every feature, no paywalls, no ads" as long as it never
claims "no in-app purchases" and discloses the tip (2.3.2). Keep **Option C** in
reserve as an optional, US-only *additive* link if avoiding the badge later proves
to matter more than global reach. Reject **Option B** on local-first grounds.

> This is an assessment, not a decision to build. A build commitment belongs in an
> ADR (it would record the mechanism, the `expo-iap` community-dependency exception,
> and the store-badge-vs-positioning trade-off, and sit behind an ADR 0003 port).

## Open questions / next steps

- **Positioning call (ADR-level):** is preserving a badge-free "100% free" listing
  worth giving up global reach (Option C) — or is the "In-App Purchases" badge an
  acceptable cost for a global, local-first tip jar (Option A)? This is the crux an
  ADR must decide.
- **Product shape:** fixed price points vs. a small ladder; where the entry lives
  (settings row, onboarding end, run-summary celebration); one-tap vs. a dedicated
  screen — all composed from existing `ui/`/`island/` primitives (ADR 0013/0005).
- **Restore / re-tipping:** consumables are re-purchasable by design and need no
  restore flow; confirm no non-consumable "remove-nothing" product is needed.
- **Store setup:** create the consumable products in App Store Connect / Play
  Console; verify the dev-build config-plugin path for `expo-iap` on this stack;
  confirm Small Business Program enrollment.
- **ADR:** if greenlit, record the decision as the next ADR number, behind an
  ADR 0003 port, citing this doc.

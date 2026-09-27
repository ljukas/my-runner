# Android release — one-time setup checklist

The Android half of the release pipeline ([ADR 0012](adr/0012-release-please-fingerprint-gated-releases.md))
is wired in the repo: `eas.json` builds a store AAB from the `production` profile and
submits it to Play's **internal** track as a **draft**, and
`.eas/workflows/deploy-production.yml` runs the Android jobs on every release. What
the repo cannot do is create the Play listing, the signing key, the service account
or the store declarations. This checklist is that gap ([ADR 0025](adr/0025-android-staged-migration.md)
stage 7). Work through it once, in order; the numbered steps depend on each other.

Until step 6 is done, **do not approve** `approve_android_submission` in a release's
EAS workflow run — `submit_android` cannot succeed before Play has seen one manual
upload. The iOS jobs in the same run are independent and ship regardless.

## Before the Play account is verified

- [ ] **1. Maps key in EAS.** Create the environment variable for the builds that
      render maps (`production` for store builds, `preview` for internal APKs):
      ```
      eas env:create --name GOOGLE_MAPS_ANDROID_API_KEY --value <key> \
        --environment production --environment preview --visibility sensitive
      ```
      One key serves every variant. Without it a cloud build bakes the
      `MISSING_GOOGLE_MAPS_ANDROID_API_KEY` placeholder and route maps render blank
      ([ADR 0010](adr/0010-maps-expo-maps-ios18-floor.md)'s 2026-09-21 amendment).
- [ ] **2. Upload keystore.** Run the first production build interactively so EAS
      generates and stores the upload key (non-interactive runs — the release
      workflow — cannot create credentials):
      ```
      export COREPACK_ENABLE_AUTO_PIN=0
      bunx eas-cli build -p android --profile production
      ```
      Answer yes to "Generate a new Android Keystore?". Keep the resulting AAB; it
      is the manual upload in step 6.
- [ ] **3. Upload key SHA-1 on the Maps key.** `bunx eas-cli credentials -p android`
      → `production` → shows the keystore's SHA-1. Add it (package
      `se.lukaslindqvist.runbro`) to the key's Android restriction in Google Cloud,
      beside the existing debug-keystore entry. Internal `preview` APKs are signed
      with this key, not Play's.

## Once the Play account is verified

Developer account id `8846992213517983364`.

- [ ] **4. Create the app.** Play Console → Create app: name RunBro, app, free.
      Package name comes from the first upload: `se.lukaslindqvist.runbro`.
- [ ] **5. Internal testers.** Test and release → Internal testing → Testers: create
      the list (email addresses) and copy the opt-in link.
- [ ] **6. First upload, by hand.** Internal testing → Create new release → upload
      the AAB from step 2 (download it from the build page on expo.dev). Accept
      **Play App Signing** when asked (Google holds the app-signing key; the EAS key
      from step 2 becomes the upload key). Google's API cannot create an app's first
      release, which is why EAS Submit cannot do this step.
- [ ] **7. App-signing SHA-1 on the Maps key.** Test and release → App integrity →
      App signing → copy the **app signing key** SHA-1 and add it to the Maps key's
      restriction. Store-installed builds are re-signed with this key; without the
      entry their maps are blank.
- [ ] **8. Service account for EAS Submit.** Follow <https://expo.fyi/creating-google-service-account>:
      Google Cloud service account + JSON key, invited in Play Console → Users and
      permissions with release permissions for this app. Upload the JSON on
      expo.dev → project → Credentials → Android → `se.lukaslindqvist.runbro` →
      Service Credentials → Add a Google Service Account Key. Nothing goes in the
      repo; `eas.json` carries no key path.

## Store declarations (App content)

Play blocks releases, internal ones included, until these are complete.

- [ ] **Privacy policy URL.** Must be a public web page (the in-app `privacy`
      route from stage 5 does not count). It needs to cover location, Health
      Connect writes and the fact that nothing leaves the device.
- [ ] **Data safety.** No data is collected or shared: everything stays on the
      device, and iCloud / device backup is the only copy. Declare location and
      health & fitness data as *processed on device only* according to Google's
      current definitions, and re-check the form when anything starts leaving the
      device.
- [ ] **Health apps declaration.** Health Connect permissions the app requests:
      `WRITE_EXERCISE`, `WRITE_EXERCISE_ROUTE`, `WRITE_DISTANCE` (write only, no
      reads — [ADR 0011](adr/0011-apple-health-kingstinct-healthkit.md)'s 2026-09-22
      amendment). Purpose: save completed runs to the user's health records.
- [ ] **Foreground service declaration.** Type `location`: the run's GPS heartbeat
      keeps recording route and distance with the screen off, started by the user
      beginning a run ([ADR 0008](adr/0008-background-execution-location-heartbeat.md)'s
      2026-09-21 amendment). Play asks for a short video of the feature in use —
      record one on a device. The app does **not** request background location.
- [ ] **Remaining questionnaires:** content rating, target audience (not aimed at
      children), ads (none), app access (no login), government / financial / news
      (no).

## After the first green `e2e-android` run

- [ ] Add `e2e-android` to the `main` ruleset's required status checks, beside
      `checks`, `precheck` and `e2e-ios`.

## Steady state

A release PR merge runs `deploy-production.yml`. If a production AAB with the
current Android fingerprint exists, Android gets an OTA update; otherwise EAS
builds a new AAB, waits for approval, and submits it to internal testing as a
draft — promote it to testers in Play Console. Moving to the production track is a
later decision (`submit.production.android.track` in `eas.json`).

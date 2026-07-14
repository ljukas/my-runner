# Domain glossary

Names used consistently across code, ADRs, and architecture reviews. Grown
lazily — add a term when a module gets named after it.

## Training domain

- **Plan** — the ordered 27-session C25K program (`NHS_PLAN`; `COMPRESSED_PLAN`
  is its dev/E2E-only time-compressed twin).
- **Session** — one planned workout (`w3d2`): warmup + intervals + cooldown.
- **Segment** — one timed stretch of a session with a kind
  (warmup | run | walk | cooldown).
- **Run** — one recorded attempt at a session (DB row; `completed` or
  `partial`, soft-deleted via `deleted_at`).
- **Run engine** — the wall-clock, event-log state machine that derives the
  active run's state (ADR 0007).

## View layer

- **Primitive** — a style component in `src/components/ui/`: carries cva
  variants, pure, domain-blind (`Button`, `Text`). (ADR 0013)
- **Island** — a self-contained @expo/ui SwiftUI subtree inside a `Host`
  (ADR 0005); the `island/` module set names the seam (`Island`,
  `Island.Text`, `Island.Button`).
- **Domain component** — a component named after an app concept
  (`SegmentBar`, `StatList.Row`, `SettingsToggle`); may bind stores and
  compose either side of the island seam.
- **Compound** — a dot-notation multi-part component wired by internal
  context (`RadioToggle.Group` / `RadioToggle.Item`).
- **Token pair** — a surface color and its `-foreground` partner
  (`bg-primary` / `text-primary-foreground`); the palette's unit of growth.

## Support

- **Tip** — an optional, repeatable payment a user makes to support the
  developer. Grants **nothing** (no feature unlock); that invariant is what keeps
  the tip jar local-first and its port interface narrow (ADR 0017). A
  StoreKit / Play Billing **consumable**.
- **Tip jar** — the capability that offers tips: the `services/tip-jar` port
  (ADR 0003) plus its `expo-iap` adapter, surfaced as a "Support" section in
  settings. The user-facing label is **"Support the app"**, never "Donate" — the
  latter routes App Review into the charity/nonprofit lane (ADR 0017).

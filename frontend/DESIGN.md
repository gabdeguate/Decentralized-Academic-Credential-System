---
version: alpha
name: DACS-design-system
description: |
  DACS (Decentralized Academic Credential System) is a wallet-first Ethereum
  dApp for issuing, holding, and verifying academic credentials. Its frontend
  is a dark, modern Web3 console — an elevated, card-based dark UI in the spirit
  of contemporary crypto dashboards. A near-black navy canvas pairs with a cyan
  primary (`#22d3ee`), soft elevation (real shadows), 12px rounded cards, and
  IBM Plex Sans throughout. Every wallet address and credential hash is rendered
  in a cyan-tinted monospace face. Color carries brand (cyan), role identity
  (Issuer / Holder / Verifier), and status (active / revoked / pending). The
  product favors legibility and scannable data with a confident dark aesthetic.

colors:
  # Brand / action
  primary: "#22d3ee"          # cyan — brand, primary CTAs, active tab, stat numbers, logo
  primary-deep: "#0891b2"     # deeper cyan — gradients, active foreground/borders
  secondary: "#60a5fa"        # blue — links, focus ring, Holder actions
  verify-fill: "#0e7490"      # deep cyan — Verifier "Verify" terminal button
  mono-accent: "#67e8f9"      # cyan — wallet addresses, credential hashes, CIDs
  on-accent: "#06222b"        # dark ink on cyan fills

  # Canvas & surface (dark)
  canvas: "#0b0f17"           # app background (darkest)
  surface: "#141a24"          # header, panels, cards
  surface-2: "#1a212e"        # elevated cards (cred-card, stat-card), panel-head, secondary buttons
  field: "#11161f"            # input background
  soft: "#161d28"             # inset note / reason / grant-form blocks

  # Lines
  border: "#232b3a"           # default hairline + card border
  border-2: "#313c52"         # stronger border — inputs, hover, dashed empty-state
  divider-faint: "#1e2531"    # row dividers inside data tables

  # Text
  text: "#e5e9f0"             # primary text
  heading: "#f4f7fb"          # headings (brighter than body)
  muted: "#8b95a7"            # secondary / supporting text
  label: "#aab3c2"            # form labels
  section-label: "#9aa4b4"    # uppercase section headers
  meta: "#6b7686"             # table keys, metadata, inert tabs

  # Status — surface (translucent) / foreground pairs
  success: "rgba(16,185,129,0.14)"   ;  success-fg: "#34d399"
  error: "rgba(239,68,68,0.14)"      ;  error-fg:   "#f87171"
  pending: "rgba(245,158,11,0.14)"   ;  pending-fg: "#fbbf24"
  neutral-badge: "rgba(255,255,255,0.06)" ; neutral-badge-fg: "#aab3c2"

  # Role identity
  role-issuer: "#22d3ee"      # cyan
  role-holder: "#a78bfa"      # violet
  role-verifier: "#34d399"    # green

typography:
  font-sans: '"IBM Plex Sans", Aptos, "Segoe UI", system-ui, -apple-system, sans-serif'
  font-mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'

  app-title:        { family: sans, size: 0.94rem, weight: 700, use: "header wordmark (DACS)" }
  page-title:       { family: sans, size: 1.00rem, weight: 700, use: "hero / view titles" }
  panel-title:      { family: sans, size: 1.00rem, weight: 700, use: "panel-header h2" }
  modal-title:      { family: sans, size: 1.12rem, weight: 700, use: "modal heading" }
  card-title:       { family: sans, size: 0.98rem, weight: 720, use: "credential card title" }
  stat-num:         { family: sans, size: 1.70rem, weight: 750, color: primary, use: "stat-card number" }
  section-label:    { family: sans, size: 0.69rem, weight: 760, transform: uppercase, tracking: 0.08em }
  table-key:        { family: sans, size: 0.68rem, weight: 750, transform: uppercase, tracking: 0.06em }
  label:            { family: sans, size: 0.74rem, weight: 650, use: "form field labels" }
  body:             { family: sans, size: 0.80rem, lineHeight: 1.45 }
  body-sm:          { family: sans, size: 0.78rem }
  button:           { family: sans, size: 0.78rem, weight: 650 }
  badge:            { family: sans, size: 0.66rem, weight: 760, transform: uppercase }
  mono-addr:        { family: mono, size: 0.72rem, color: mono-accent, use: "wallet addresses, tx links" }
  mono-hash:        { family: mono, size: 0.70rem, color: mono-accent, use: "credential hashes" }

rounded:
  card: 12px         # cards, panels, inputs, buttons, modals, hash-preview
  icon: 8px          # panel role-icon, nav logo (9px)
  badge: 6px         # status badges
  pill: 999px        # wallet/role chip, nav role tabs, verify-status dot

elevation:
  shadow: "0 2px 6px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.4)"   # panels, cards, verify dashboard
  shadow-modal: "0 24px 64px rgba(0,0,0,0.6)"
  note: "Dark UI DOES use real shadows for depth (unlike the prior flat light pass)."

spacing:
  base: 4px
  view-max: 1040px
  view-pad: "18px clamp(14px, 3vw, 32px)"

components:
  nav:
    note: "Top bar: cyan gradient rounded-square logo + DACS wordmark left; centered role-indicator tab strip (Student/Institution/Admin/Search); wallet chip + Switch/Logout right."
    tabs: "Inert role indicators — the connected wallet's role tab is .active (cyan pill); others dimmed. NOT navigation (roles are wallet-locked)."
  button-primary:   { backgroundColor: primary, textColor: on-accent, weight: 700, rounded: card, minHeight: 32px, note: "Connect, Issue, Search, Issuer actions" }
  button-holder:    { backgroundColor: secondary, textColor: "#ffffff", rounded: card }
  button-verify:    { backgroundColor: verify-fill, textColor: "#ffffff", rounded: card, note: "Verifier terminal action" }
  button-secondary: { backgroundColor: surface-2, border: "1px solid {border-2}", textColor: "#cbd5e1", rounded: card, note: "Switch, Download, Back, Cancel" }
  button-danger:    { backgroundColor: transparent, border: "1px solid rgba(248,113,113,0.4)", textColor: error-fg, note: "Logout / destructive — outlined, never filled" }
  text-input:       { backgroundColor: field, border: "1px solid {border-2}", rounded: card, minHeight: 34px, focus: "border-color {primary}", colorScheme: dark }
  panel:            { backgroundColor: surface, border: "1px solid {border}", rounded: card, shadow: shadow, header: "{surface-2} with 1px bottom border" }
  stat-card:        { backgroundColor: surface-2, border: "1px solid {border}", rounded: card, shadow: shadow, note: "label + cyan number + sub. Chain-derived only: Total Credentials, Active. No mock metrics." }
  card-credential:  { backgroundColor: surface-2, border: "1px solid {border}", rounded: card, shadow: shadow, padding: "14px 16px", revoked: "opacity 0.72; red-tinted border" }
  badge-status:     { rounded: badge, minHeight: 20px, padding: "2px 7px", variants: "active(green) / revoked(red) / pending(amber) / neutral(gray)" }
  verify-status-icon: { shape: "pill dot inside a 34px ring, color = currentColor", note: "the verify pass/fail signal" }
  role-badge:       { backgroundColor: neutral-badge, border: "1px solid {border}", rounded: pill, note: "header chip — connected wallet role" }
  empty-state:      { backgroundColor: "rgba(255,255,255,0.02)", border: "1px dashed {border-2}", rounded: card, textColor: muted }
  modal:            { backdrop: "rgba(0,0,0,0.62)", backgroundColor: surface, border: "1px solid {border}", rounded: card, shadow: shadow-modal, width: "min(560px, 92vw)" }
---

## Overview

DACS reads as a **modern dark Web3 console**. A near-black navy canvas
(`{colors.canvas}`) carries elevated cards with real shadows, 12px rounded
corners, and a tight IBM Plex Sans type scale. Cyan (`{colors.primary}`) is the
brand and primary-action color; it lights up the logo, primary buttons, the
active role tab, stat numbers, and all on-chain mono values.

Color does three jobs:

1. **Brand / action** — cyan `{colors.primary}` for the logo, primary CTAs, the
   active tab, and stat figures. Blue `{colors.secondary}` for links, focus, and
   Holder actions. Deep cyan `{colors.verify-fill}` for the Verifier's terminal
   "Verify".
2. **Role identity** — Issuer (cyan), Holder (violet), Verifier (green), shown on
   panel icons and the header role chip / tab.
3. **Status** — active (green), revoked (red), pending (amber): a translucent
   tinted surface + saturated foreground, shown as a small squared badge.

**Key characteristics**
- Dark, elevated UI: `{colors.canvas}` background, `{colors.surface}` panels,
  `{colors.surface-2}` cards, real `{elevation.shadow}` depth.
- Layered surfaces convey hierarchy: canvas → panel (`surface`) → card (`surface-2`).
- 12px rounded cards/controls; pill chips & tabs; 6px badges.
- IBM Plex Sans for all UI; **cyan monospace for every wallet address and hash**.
- Three role-scoped surfaces (Issuer / Holder / Verifier) + a no-login public lookup.

## Colors

### Action & Brand
- **Primary — Cyan** (`#22d3ee`): logo, primary CTAs (Connect/Issue/Search), Issuer
  actions, active tab, stat numbers, the "active" status accent.
- **Primary Deep** (`#0891b2`): logo gradient end, active borders.
- **Secondary — Blue** (`#60a5fa`): links, focus ring, Holder action button.
- **Verify Fill** (`#0e7490`): the Verifier's deep-cyan terminal "Verify" button.
- **Mono accent** (`#67e8f9`): all on-chain hex/base58 (addresses, hashes, CIDs).

### Surfaces (dark, layered)
`{colors.canvas}` `#0b0f17` → `{colors.surface}` `#141a24` (panels) →
`{colors.surface-2}` `#1a212e` (cred/stat cards). Inputs `{colors.field}` `#11161f`;
inset blocks `{colors.soft}` `#161d28`.

### Lines
`{colors.border}` `#232b3a` (default), `{colors.border-2}` `#313c52` (inputs/hover/dashed),
`{colors.divider-faint}` `#1e2531` (table rows).

### Text
`{colors.text}` `#e5e9f0` body · `{colors.heading}` `#f4f7fb` titles ·
`{colors.muted}` `#8b95a7` · `{colors.label}` `#aab3c2` · `{colors.meta}` `#6b7686`.

### Status (translucent surface / foreground)
Active `rgba(16,185,129,.14)` / `#34d399` · Revoked `rgba(239,68,68,.14)` / `#f87171`
· Pending `rgba(245,158,11,.14)` / `#fbbf24` · Neutral `rgba(255,255,255,.06)` / `#aab3c2`.

### Role identity
Issuer `#22d3ee` (cyan) · Holder `#a78bfa` (violet) · Verifier `#34d399` (green).

## Typography
- **IBM Plex Sans** for the entire UI; **monospace (cyan)** mandatory for wallet
  addresses, hashes, CIDs, and tx links. Scale per the `typography` block above;
  body ≈ `0.80rem`, largest is `modal-title` 1.12rem and `stat-num` 1.70rem.
- Micro-labels (section headers, table keys, badges) are UPPERCASE with positive
  tracking. Never set a hex string in the sans face.

## Layout
- A `.view` caps at 1040px, padded `{spacing.view-pad}`.
- **Header**: dark top bar (`{colors.surface}`) with a 1px `{colors.border}` bottom
  rule. Left: cyan gradient logo glyph + DACS wordmark + contract links. Center:
  role-indicator tab strip. Right: wallet status chip + Switch/Logout.
- **Panel**: elevated dark card with a `{colors.surface-2}` header (role icon +
  title + one-line description) over a hairline, then a padded body of sections.
- **Student dashboard**: a `stat-row` of chain-derived stat cards (Total
  Credentials, Active) above the grouped credential list.

## Elevation & Depth
Depth comes from **layered dark surfaces + real shadows** (a deliberate change
from the prior flat light pass). Panels/cards/verify-dashboard use
`{elevation.shadow}`; the modal uses `{elevation.shadow-modal}`. Hover darkens/
lifts borders (`{colors.border}` → `{colors.border-2}`).

## Shapes
- **12px** cards/panels/inputs/buttons/modals; **8px** role icons / **9px** logo;
  **6px** status badges; **pill** wallet/role chips, nav tabs, and the verify dot.

## Components
- **nav** — top bar; the connected wallet's role tab is `.active` (cyan pill),
  others dimmed. Tabs indicate role, they are **not** navigation (roles are
  wallet-locked / mutually exclusive).
- **stat-card** — label + big cyan number + sub-line. **Only chain-derived**
  metrics: Total Credentials and Active (= non-revoked). No Skill Score / Profile
  Views / Profile Strength (no on-chain data source).
- **card-credential** — elevated `surface-2` card: title (degree), muted subtitle,
  status badge (Active/Revoked + reissue state), a key/value meta grid (Issued,
  Issuer, Hash in cyan mono), then an actions row. Revoked → `opacity 0.72` +
  red-tinted border.
- **badge-status** — squared 6px chip, uppercase. active/revoked/pending/neutral.
- **verify dashboard** — colored status header (green/red/amber tint) with a cyan
  pill dot, then key/value detail rows.
- **buttons / inputs / modal / empty-state** — per the `components` block.

## Do's and Don'ts
### Do
- Layer dark surfaces (canvas → surface → surface-2) and use real shadows for depth.
- Use cyan `{colors.primary}` for brand/primary actions and the active tab.
- Render every wallet address, hash, CID, and tx link in cyan monospace.
- Encode role with cyan / violet / green on panel icons and the header chip.
- Show status as a translucent-surface + saturated-foreground squared badge.
- Keep new dashboard numbers **chain-derived** — no mock metrics.

### Don't
- Don't revert to a light canvas or remove shadows — this is the dark elevated system.
- Don't use a solid red button fill — destructive actions are outlined (`button-danger`).
- Don't set addresses or hashes in IBM Plex Sans; cyan mono is mandatory.
- Don't make the role tabs clickable navigation — roles are wallet-locked.
- Don't add unbacked vanity metrics (Skill Score, Profile Views, Profile Strength).

## Notes for Claude Code
- Single `frontend/index.html` with all CSS in one `<style>` block (plain CSS
  custom properties on `:root`), markup in the body; logic/rendering in
  `frontend/src/main.ts`. No CSS framework.
- Live CSS vars mirror these tokens: `--accent`=`{colors.primary}`,
  `--accent2`=`{colors.secondary}`, `--near-black`=`{colors.verify-fill}`,
  `--mono-accent`, `--surface`/`--surface-2`/`--field`/`--soft`, `--border`/`--border-2`,
  `--radius`(12px), `--pill`, `--shadow`, `--sans`/`--mono`.
- This dark system was extrapolated to all 8 views from a single Student-dashboard
  Figma; the brand stays **DACS** (the Figma "CREDCHAIN" label was a mockup name).
- Screenshots are expected on frontend PRs. Keep visual diffs consistent with this system.

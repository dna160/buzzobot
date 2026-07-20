# Tempo Insight Engine — Design System

**Version 1.0 · Dark-first analytics design system**
Stack target: React / Next.js (App Router) · Tailwind CSS · Recharts.
Source of truth for tokens: [`tokens.css`](./tokens.css). Component specs: [`COMPONENTS.md`](./COMPONENTS.md). Screen IA: [`DASHBOARD_IA.md`](./DASHBOARD_IA.md).

Tempo is a white-labelable agency tool that shows marketing clients their TikTok performance — **paid** (campaigns, spend, ROAS, conversions) and **organic** (views, engagement, followers, watch-time) — side by side. The bar is Linear / Vercel / Stripe: dark-first, dense but breathable, data-forward. It is *not* a clone of the TikTok consumer app; we borrow only the energy of the teal (`#25F4EE`) and red (`#FE2C55`) as restrained accents.

---

## 1. Design principles

1. **Data is the interface.** Chrome recedes; numbers and trends advance. Every pixel of border, shadow, and fill is spent to make a metric more legible, never for decoration. Charts get the strongest contrast on the screen; navigation gets the least.

2. **A client should grok their week in 5 seconds.** The top of every screen answers "are we up or down, and by how much" before the eye ever reaches a chart. KPI value → direction → magnitude → context, in that reading order.

3. **Dark-first, but honestly dual.** Dark is the primary canvas and is designed first; light is a first-class, separately-tuned theme (not an inverted flip). Both are validated against their own surfaces.

4. **Direction has meaning, color has rules.** Green/red encode *good/bad*, never raw *up/down* — a rising CPA is red, a rising ROAS is green. Categorical hues are assigned by entity in a fixed order and never recycled by rank. Status colors are reserved and never double as a chart series.

5. **Dense, but breathable.** Information density is a feature for analysts, so we pack tightly on a strict 4px grid — but every dense block is bounded by generous whitespace and a clear hairline so the eye can rest and group.

6. **Trust through precision.** Tabular numerals, aligned decimals, consistent rounding, explicit units and time ranges, and visible "last updated" state. Numbers that don't line up read as numbers you can't trust.

7. **Calm motion, instant feedback.** Interactions confirm in ≤160ms with quiet, purposeful motion. Nothing bounces for attention; nothing blocks the analyst. Motion clarifies causality (what opened, what changed), then gets out of the way.

---

## 2. Color system

All values live as CSS custom properties in [`tokens.css`](./tokens.css). Dark is `:root`; light is `[data-theme="light"]`. Reference tokens (`var(--color-…)`) — never raw hex in components.

### 2.1 Semantic tokens

| Role | Token | Dark | Light |
|---|---|---|---|
| Page canvas | `--color-bg-base` | `#0A0B0D` | `#FFFFFF` |
| Sunken well | `--color-bg-subtle` | `#0E1013` | `#F7F8FA` |
| Card / surface | `--color-surface` | `#131518` | `#FFFFFF` |
| Surface hover | `--color-surface-hover` | `#1A1D22` | `#F3F5F8` |
| Surface active | `--color-surface-active` | `#1F232A` | `#EBEEF3` |
| Elevated (popover/modal) | `--color-elevated` | `#191C21` | `#FFFFFF` |
| Overlay scrim | `--color-overlay` | `rgba(3,4,6,.66)` | `rgba(16,20,26,.44)` |
| Border subtle | `--color-border-subtle` | `#1E2127` | `#EDEFF3` |
| Border default | `--color-border` | `#262A31` | `#E1E5EB` |
| Border strong | `--color-border-strong` | `#363B43` | `#CBD1DA` |
| Text primary | `--color-text-primary` | `#F4F5F7` | `#0D0F12` |
| Text secondary | `--color-text-secondary` | `#A7ADB6` | `#4A515B` |
| Text muted | `--color-text-muted` | `#6B7280` | `#838B96` |
| Text disabled | `--color-text-disabled` | `#474C55` | `#B4BAC3` |
| Accent (teal) | `--color-accent` | `#1FD8C7` | `#0FA79A` |
| Accent hover | `--color-accent-hover` | `#38E2D3` | `#0C8F84` |
| Accent active | `--color-accent-active` | `#14BEAF` | `#0A7A71` |
| Ink on accent | `--color-text-on-accent` | `#04211E` | `#FFFFFF` |
| Accent-2 (coral) | `--color-accent2` | `#FF3B5C` | `#E11D48` |
| Success | `--color-success` | `#35CE8A` | `#128A4E` |
| Warning | `--color-warning` | `#F5B429` | `#B4700A` |
| Danger | `--color-danger` | `#FF5A65` | `#DC2626` |
| Info | `--color-info` | `#4DA0FF` | `#2563EB` |

Each status/accent also ships a `-subtle` variant (an ~11–13% alpha wash) for tinted chip/pill/banner backgrounds, and accent ships `-border` and `-ring` for outlines and focus.

**TikTok energy, tastefully:** the teal accent lives in the same family as TikTok's `#25F4EE` but is desaturated and darkened so it reads as a considered brand color, not the app's neon. The coral accent-2 echoes `#FE2C55` and is rationed — live indicators, a single primary CTA per view, the "paid" emphasis pip — never as a fill for large areas.

**Delta cue tokens** (`--color-delta-positive` / `-negative` / `-neutral`) exist so KPI/table code binds to *good/bad* rather than up/down. The component decides direction per metric (see COMPONENTS §StatTile).

### 2.2 Data-visualization palette

**Categorical (8, colorblind-safe, validated).** Assigned by entity in fixed slot order; a 9th series folds into "Other," small multiples, or a facet — never a generated hue. Validated with the dataviz validator against our own surfaces: dark worst-adjacent CVD ΔE **8.4** (surface `#131518`), light **9.1** (surface `#FFFFFF`); normal-vision floor ≥ 19.3 both modes.

| Slot | Hue | Dark `var(--viz-cat-n)` | Light | Typical assignment |
|---|---|---|---|---|
| 1 | blue | `#3987E5` | `#2A78D6` | **Paid** series |
| 2 | green | `#008300` | `#008300` | Conversions |
| 3 | magenta | `#D55181` | `#E87BA4` | — |
| 4 | yellow | `#C98500` | `#EDA100` | — |
| 5 | aqua | `#199E70` | `#1BAF7A` | **Organic** series |
| 6 | orange | `#D95926` | `#EB6834` | — |
| 7 | violet | `#9085E9` | `#4A3AA7` | — |
| 8 | red | `#E66767` | `#E34948` | — |

Semantic aliases `--viz-series-paid` (slot 1) and `--viz-series-organic` (slot 5) keep the two data domains visually stable everywhere they co-occur.

> **CVD note:** the 6–8 CVD band is legal only *with* secondary encoding. In practice: legends are always present for ≥2 series, ≤4 series are also direct-labeled, and a table view of every chart exists. In **light** mode, magenta/yellow/aqua fall below 3:1 vs white — the "relief rule" applies (visible direct labels or the table view already satisfy it). For scatter/bubble/choropleth (all-pairs), cap at the first **4** slots and add labels/texture; past four, facet.

**Sequential (magnitude — heatmaps).** One hue, light→dark blue: `--viz-seq-100 … 700`
`#CDE2FB · #9EC5F4 · #6DA7EC · #3987E5 · #256ABF · #184F95 · #0D366B`.
Lightest step = "near zero." For an *ordinal* ramp (funnel stages/tiers) start no lighter than `#9EC5F4` (light) / no darker than `#184F95` (dark) so every step clears 2:1.

**Diverging (polarity — e.g. WoW change heat).** blue ↔ red with a **neutral gray** midpoint (never a hue at the middle): `#184F95 · #6DA7EC · [mid] · #E88A8A · #C0392F`. Midpoint `--viz-div-mid` = `#383835` dark / `#F0EFEC` light.

**Chart chrome:** gridlines `--viz-grid`, axis/baseline `--viz-axis`, ticks `--viz-tick` (= text-muted), tooltip surface `--viz-tooltip-bg` (= elevated). Gridlines are hairline and recessive; the axis baseline is one step stronger.

---

## 3. Typography

**Family.** UI: **Inter** (with **Geist** as an acceptable alternate), `--font-sans`, falling back to `system-ui`. Data/mono: **Geist Mono** / JetBrains Mono, `--font-mono`. Load via `next/font` (self-hosted, `display: swap`). Enable tabular figures (`font-variant-numeric: tabular-nums`) on all aligned numeric contexts — table columns, axis ticks, KPI values — via `--font-feature-numeric`; keep proportional figures for prose.

**Type scale** (token · size / line-height / weight / tracking):

| Token | Role | Size | Line-height | Weight | Tracking |
|---|---|---|---|---|---|
| `--fs-display` | Big marketing/number hero | 40px | 48px | 700 | −0.021em |
| `--fs-h1` | Page title | 30px | 38px | 700 | −0.02em |
| `--fs-h2` | Section header | 24px | 32px | 600 | −0.017em |
| `--fs-h3` | Card title | 20px | 28px | 600 | −0.012em |
| `--fs-kpi` | KPI value | 32px | 36px | 600 | −0.02em (tabular) |
| `--fs-body-lg` | Lead / emphasis body | 16px | 24px | 400 | −0.006em |
| `--fs-body` | **Base** | 14px | 22px | 400 | −0.003em |
| `--fs-small` | Secondary / dense | 13px | 20px | 400 | 0 |
| `--fs-caption` | Labels, legends | 12px | 16px | 500 | 0.005em |
| `--fs-micro` | Overline / eyebrow (UPPERCASE) | 11px | 14px | 600 | 0.04em |
| `--fs-mono` | Tabular data, IDs | 13px | 20px | 500 | 0 |

Weights available: 400 / 500 / 600 / 700 (`--fw-*`). KPI eyebrows use `--fs-micro` uppercased in `--color-text-muted`. Body copy sits on `--color-text-secondary`; only headings and values take `--color-text-primary`.

---

## 4. Spacing & layout

**Base grid: 4px.** Everything snaps to `--space-*` (0, 1px, 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64, 80, 96). Component internal padding uses the low end; between-card gutters use `--space-6` (24). Never introduce off-grid values.

**Border-radius:** `--radius-xs` 4 (chips) · `sm` 6 (inputs) · `md` 8 (buttons, selects) · `lg` 12 (cards) · `xl` 16 (modals) · `2xl` 20 · `full` (pills, avatars). Cards = 12; nested elements inside a 12-radius card use 8 to nest cleanly.

**Containers:** content max `--layout-content-max` 1440px, centered. Horizontal padding steps `32 → 24 → 16` at `1280 / 768 / <768`. Sidebar 248px (collapsed 64), topbar 56px.

**Elevation / shadow.** Dark leans on **borders + a faint lift**, not heavy drop shadows; light uses softer, cooler shadows. Tokens: `--shadow-xs` (raised chips), `--shadow-sm` (cards), `--shadow-md` (dropdowns), `--shadow-lg` (modals), `--shadow-popover` (menus/tooltips, includes a 1px inset ring), `--shadow-focus-ring` (2px canvas gap + 2px accent ring). A resting card on dark is defined by its 1px `--color-border` and surface step, not a shadow; shadow appears on *lift* (hover, drag, floating layers).

---

## 5. Motion

**Durations:** `--dur-instant` 80 · `fast` 120 · `base` 160 · `moderate` 240 · `slow` 320 · `slower` 480 (ms). Default UI feedback (hover, press, toggle) = `fast`; enter/expand = `base`–`moderate`; overlays = `moderate`.

**Easings:** `--ease-standard` `(0.2,0,0,1)` for most; `--ease-decelerate` for enter, `--ease-accelerate` for exit, `--ease-emphasized` for a subtle overshoot, `--ease-spring` reserved for rare playful moments (e.g. a KPI count-up settle).

**Principles.**
- **Feedback, not spectacle.** Hover/press are opacity + 1px translate or background steps, ≤120ms.
- **Causal transforms.** Menus/popovers scale from 0.97→1 and fade over 160ms from their trigger origin (`transform-origin`), so the eye knows what opened.
- **Numbers animate meaningfully.** KPI values may count-up on first load (≤480ms, ease-out); deltas and sparklines cross-fade on data change — never re-animate the whole chart on a filter tweak.
- **Charts draw once.** Line/area paths animate in on mount (`moderate`, left→right), not on every re-render.
- **Skeletons shimmer** at a slow, low-contrast pulse (1.4s loop) — see COMPONENTS §Skeleton.

---

## 6. Accessibility

- **Contrast.** Target **WCAG AA**: ≥4.5:1 for body text, ≥3:1 for large text (≥24px or ≥19px bold) and for UI/graphic boundaries. Primary and secondary text clear 4.5:1 on their surfaces in both themes; muted text is reserved for ≥12px non-essential labels. Chart series that dip below 3:1 (light magenta/yellow/aqua) always carry a label or table fallback (relief rule).
- **Never color alone.** Deltas pair color with a ▲/▼ arrow + sign; status pills pair color with an icon + text; chart identity pairs color with a legend and, for ≤4 series, direct labels. A texture fill is available for `forced-colors`/print/CVD.
- **Focus.** Every interactive element shows a visible focus ring via `--shadow-focus-ring` (2px canvas gap + 2px accent ring) on `:focus-visible`. Never remove outlines without a replacement. Focus order follows DOM/reading order; modals trap focus and restore it on close.
- **Targets & keyboard.** Minimum hit target 32×32 (dense tables) / 40×40 (primary controls). All interactions reachable by keyboard; menus, tabs, tables, and date-pickers follow WAI-ARIA patterns (roving tabindex, arrow-key nav).
- **Reduced motion.** `@media (prefers-reduced-motion: reduce)` collapses all durations to ~0 and disables count-ups, path draws, and shimmer (handled globally in `tokens.css`).
- **Forced colors / print.** Respect `forced-colors: active`; charts fall back to the texture channel + labels; borders use `CanvasText`.

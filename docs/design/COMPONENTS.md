# Tempo Insight Engine — Component Specifications

Implementation-ready specs for the core kit. Tokens referenced here are defined in [`tokens.css`](./tokens.css); see [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) for the underlying scales. All components are dark-first and theme-agnostic (they read `var(--…)`, so light/dark swap automatically).

Conventions used below:
- **Anatomy** — the parts, outside-in.
- **Props** — the public API (TypeScript-ish).
- **Variants / Sizes** — enumerated with exact tokens.
- **States** — rest / hover / active / focus-visible / disabled / loading, plus any component-specific states.
- Every interactive element gets `:focus-visible` → `box-shadow: var(--shadow-focus-ring)` and a `transition: var(--dur-fast) var(--ease-standard)` on color/background/transform.

---

## 1. Button

**Anatomy:** `[ leadingIcon? · label · trailingIcon? ]` in an inline-flex row; optional loading spinner replaces leading icon; content gap `--space-2`.

**Props:**
```ts
variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link'  // default 'secondary'
size?: 'sm' | 'md' | 'lg'                                                     // default 'md'
leadingIcon?, trailingIcon?: ReactNode
loading?: boolean          // shows spinner, disables, preserves width
disabled?: boolean
fullWidth?: boolean
iconOnly?: boolean         // square, requires aria-label
as?: 'button' | 'a'
```

**Sizes** (height / pad-x / font / radius / icon):
| Size | Height | Pad-X | Font | Radius | Icon |
|---|---|---|---|---|---|
| sm | 32px | `--space-3` (12) | `--fs-small` | `--radius-sm` | 16 |
| md | 36px | `--space-4` (16) | `--fs-body` | `--radius-md` | 16 |
| lg | 44px | `--space-5` (20) | `--fs-body-lg` | `--radius-md` | 20 |

Weight 500. Icon-only buttons are square (32/36/44).

**Variants** (bg / text / border):
| Variant | Rest | Hover | Active |
|---|---|---|---|
| primary | `--color-accent` / `--color-text-on-accent` | `--color-accent-hover` | `--color-accent-active` |
| secondary | `--color-surface` / `--color-text-primary` / 1px `--color-border` | bg `--color-surface-hover`, border `--color-border-strong` | bg `--color-surface-active` |
| outline | transparent / `--color-text-primary` / 1px `--color-border` | bg `--color-surface-hover` | bg `--color-surface-active` |
| ghost | transparent / `--color-text-secondary` | bg `--color-surface-hover`, text primary | bg `--color-surface-active` |
| danger | `--color-danger` / `--color-text-on-solid` | brightness 1.06 | brightness 0.94 |
| link | transparent / `--color-accent` · underline on hover | — | — |

**States:** hover per above (120ms); active adds `transform: translateY(0.5px)`; focus-visible = focus ring; disabled = `opacity: .45; cursor: not-allowed` (no hover); loading = spinner (16px, `currentColor`, 700ms linear spin), label dims to 0 opacity but keeps layout width. Rule: **one primary button per view region**; the coral accent-2 is not a button fill (reserved for live/alert affordances).

---

## 2. Card

**Anatomy:** `Card` → optional `Card.Header` (title + description + actions slot) → `Card.Body` → optional `Card.Footer`. Header/footer divided by 1px `--color-border-subtle`.

**Props:**
```ts
padding?: 'none' | 'sm' | 'md' | 'lg'   // md = --space-6 (24); sm = --space-4; lg = --space-8
interactive?: boolean                    // hover lift + cursor pointer (clickable card)
elevated?: boolean                       // uses elevated surface + shadow-sm at rest
inset?: boolean                          // bg-subtle well (for nested content)
```

**Base:** bg `--color-surface`, 1px `--color-border`, `--radius-lg` (12), no shadow at rest. Header title `--fs-h3` primary; description `--fs-small` secondary. Section padding 24 (md).

**States:** `interactive` → hover: border `--color-border-strong`, bg `--color-surface-hover`, `--shadow-sm`, `translateY(-1px)` over `--dur-fast`; focus-visible ring; active resets translate. Non-interactive cards never lift.

---

## 3. StatTile / KPI card

The hero of the dashboard. Communicates value → direction → magnitude → trend at a glance.

**Anatomy (top→bottom):**
```
[ eyebrow label + info(?) ]              ← --fs-micro uppercase, text-muted
[ VALUE           · unit ]  [ sparkline ] ← value --fs-kpi tabular; sparkline top-right, 96×32
[ ▲ +12.4%  vs prev 30d  ]               ← delta pill + comparison caption
```

**Props:**
```ts
label: string
value: string | number          // pre-formatted or formatted via `format`
format?: 'number'|'currency'|'percent'|'duration'|'compact'  // e.g. 1.2M, $3.4k, 4:12
unit?: string
delta?: { value: number; direction?: 'up'|'down' }   // magnitude + raw direction
deltaPolarity?: 'higher-is-better' | 'lower-is-better' // maps direction→good/bad. default higher-is-better
comparisonLabel?: string        // "vs prev 30 days"
sparkline?: number[]            // renders mini area/line
domain?: 'paid' | 'organic'     // tints eyebrow pip (blue vs aqua)
loading?: boolean
size?: 'md' | 'lg'
onClick?: () => void            // drills into the metric
```

**Delta logic (critical):** compute `isGood = (direction === 'up') === (deltaPolarity === 'higher-is-better')`. Color = `--color-delta-positive` when good, `--color-delta-negative` when bad, `--color-delta-neutral` when `|delta| < 0.05%`. Arrow ▲ for up / ▼ for down (always reflects raw direction), sign always shown. So **CPA rising** (`up`, `lower-is-better`) renders a red ▲ — direction honest, color semantic. Delta is a `--radius-full` pill on the matching `-subtle` wash, `--fs-caption` 600.

**Sparkline:** 96×32, single series, no axes/grid, 2px line + 12%-alpha area fill in the delta color (or domain color if polarity-neutral), last point dot 4px. Uses the tile's own trend data, not the main chart.

**Domain pip:** a 6px dot before the eyebrow — `--viz-series-paid` for paid, `--viz-series-organic` for organic — so paid/organic tiles are scannable as two groups.

**States:** rest (bg surface, border, radius-lg, pad `--space-5`); hover (if `onClick`) → interactive-card lift; loading → Skeleton for value/delta/sparkline; empty (no data) → value shows "—" muted, delta hidden. First-load value count-up ≤480ms (respects reduced-motion). `size=lg` bumps value to `--fs-display`.

---

## 4. Badge / Pill

**Anatomy:** optional 6px dot or 14px icon + label; inline-flex, `--radius-full`.

**Props:**
```ts
variant?: 'neutral'|'accent'|'success'|'warning'|'danger'|'info'  // default neutral
tone?: 'subtle' | 'solid' | 'outline'   // default subtle
size?: 'sm' | 'md'
dot?: boolean; icon?: ReactNode; removable?: boolean
```

**Sizes:** sm = height 20, pad-x `--space-2`, `--fs-micro`; md = height 24, pad-x `--space-3`, `--fs-caption`. Weight 500.

**Tone × variant:** `subtle` = `{variant}-subtle` bg + `{variant}` text; `solid` = `{variant}` bg + on-solid text; `outline` = transparent + 1px `{variant}` border + `{variant}` text. Neutral maps to border/surface/secondary text. `removable` adds a 12px × affordance with hover bg. Status badges always include icon **or** dot (never color-only).

---

## 5. Tabs

**Anatomy:** `Tabs` → `Tabs.List` (row of triggers, `role=tablist`) → `Tabs.Trigger[]` → `Tabs.Panel[]`. Optional trailing count badge per trigger.

**Props:**
```ts
variant?: 'underline' | 'segmented' | 'pill'   // default 'underline'
size?: 'sm' | 'md'
value / defaultValue / onValueChange
fitted?: boolean   // equal-width triggers
```

**Variants:**
- **underline** — triggers are text buttons; active has a 2px `--color-accent` bottom border (animated slide, `--dur-base`), text primary; inactive text secondary. List has a 1px `--color-border-subtle` baseline.
- **segmented** — a track (`--color-bg-subtle`, `--radius-md`, 4px pad); active trigger is a raised `--color-surface` chip with `--shadow-xs`; the chip slides between segments.
- **pill** — each active trigger is an `accent-subtle` pill.

**States:** hover inactive → text primary + bg `--color-surface-hover`; focus-visible ring on trigger; disabled trigger `opacity .45`. Keyboard: arrow keys move selection (roving tabindex), Home/End jump. Panels fade-swap 120ms.

---

## 6. Table (sortable, dense)

The workhorse for campaign & content lists.

**Anatomy:** optional toolbar (search, column toggle, density) → `<table>` with sticky `<thead>` → sortable header cells (label + sort caret) → body rows → optional footer (totals row) → pagination bar. Numeric columns right-aligned with `tabular-nums`.

**Props:**
```ts
columns: Array<{
  key: string; header: string;
  align?: 'left'|'right'|'center';        // numbers → right
  sortable?: boolean; width?: number|string;
  sticky?: 'left'|'right';                // e.g. pin name / actions
  render?: (row) => ReactNode;            // cells can host Badge, sparkline, delta, bar
  format?: 'number'|'currency'|'percent'|'duration'|'compact';
}>
data; density?: 'comfortable' | 'compact';   // default compact
sortState?: { key; dir: 'asc'|'desc' }; onSortChange
selectable?: boolean; rowActions?; onRowClick?
stickyHeader?: boolean;  // default true
zebra?: boolean
loading?, empty?: EmptyState props
pagination?: { page; pageSize; total } | 'infinite'
```

**Dimensions:** header height 40; row height 44 (comfortable) / 36 (compact); cell pad-x `--space-4`, first/last cell pad = container pad. Header: `--fs-caption` 600 uppercase-ish, `--color-text-muted`, sticky with `--color-surface` bg + 1px bottom `--color-border`. Body text `--fs-small`. Row divider 1px `--color-border-subtle`; zebra uses `--color-bg-subtle` on odd rows.

**States:** row hover `--color-surface-hover`; selected row `--color-accent-subtle` + 2px left `--color-accent` inset bar; sortable header hover shows caret, active sort caret is `--color-text-primary` (▲/▼) others muted; focus-visible ring on header buttons and rows; loading → 6–10 skeleton rows; empty → EmptyState spanning the body. Sticky columns cast a 1px right/left border + subtle shadow when scrolled. In-cell mini-bars use `--viz-seq-400`; in-cell deltas follow StatTile delta logic.

---

## 7. Select / Dropdown

**Anatomy:** trigger (label value + chevron) → floating `--color-elevated` panel (`--shadow-popover`, `--radius-md`, 4px pad) → optional search input → `role=option` rows (label + check when selected) → optional grouped headers.

**Props:**
```ts
options: Array<{ label; value; icon?; description?; disabled? }>
value; onChange; multiple?: boolean
searchable?: boolean; clearable?: boolean
size?: 'sm'|'md'; placeholder?; disabled?; invalid?; loading?
renderTrigger?; align?: 'start'|'end'
```

**Trigger** matches Button `secondary/outline` metrics (32/36 height, `--radius-md`, 1px `--color-border`, bg `--color-surface`). **Option row:** height 32, pad-x `--space-3`, `--fs-small`; selected → check (16px accent) + text primary; multi → left checkbox. Hover/active-descendant row → `--color-surface-hover`.

**States:** open → chevron rotates 180° (120ms), panel scales 0.97→1 + fades from trigger origin (`--dur-base`); focus-visible ring on trigger; typeahead + arrow-key roving; invalid → border `--color-danger`; disabled `opacity .45`. Panel `max-height: 320px` with internal scroll; multi shows selection count in trigger.

---

## 8. DateRangePicker

**Anatomy:** trigger button (calendar icon + formatted range, e.g. "Jun 20 – Jul 20") → popover with two-column layout: **preset rail** (left) + **dual-month calendar** (right) + footer (custom range summary, Apply/Cancel).

**Props:**
```ts
value: { start: Date; end: Date }; onChange
presets?: Preset[]   // default: Today, Yesterday, Last 7d, Last 30d, Last 90d, Month to date, Last month, Custom
maxDate?; minDate?; comparison?: boolean   // enables "vs previous period" toggle
align?: 'start'|'end'; size?: 'sm'|'md'
```

**Preset rail:** list rows, selected marked with a 16px accent check + `--color-accent-subtle` bg, hover ghost wash, `--fs-small`. **Calendar:** two months side-by-side; range fill `--color-accent-subtle`, endpoints solid `--color-accent` circles with on-accent text, today ringed 1px; weekday header muted; disabled days `--color-text-disabled`. **Comparison** toggle shows a secondary faint range for the prior period.

**States:** hover day → `--color-surface-hover`; in-range → subtle wash; endpoint hover during selection previews the range; focus-visible ring on trigger and grid (arrow-key day nav, PageUp/Down = month); Apply commits (analytics refetch), Cancel reverts. Trigger shows a small "vs prev" caption when comparison active.

---

## 9. Chart wrapper (line / area / bar)

A single wrapper standardizes framing, legend, tooltip, loading, and empty across all Recharts.

**Anatomy:** `Card`-style container → header (title + optional description + right-slot controls e.g. metric select) → legend row (chips, ≥2 series) → **plot** (Recharts) → optional footnote (source / "updated 2m ago").

**Props:**
```ts
type: 'line' | 'area' | 'bar' | 'stacked-bar'
series: Array<{ key; label; color?; }>    // color auto-assigned from --viz-cat-* by order
data; xKey; yFormat?; height?: number      // default 280
showGrid?: boolean (default true); showLegend?; stacked?
loading?, empty?, error?
annotations?: Array<{ x?; y?; label }>     // e.g. campaign launch marker
onPointHover?, syncId?                      // sync crosshair across stacked charts
```

**Rendering rules (enforce in the wrapper, per dataviz method):**
- **One y-axis only.** Two measures of different scale → two charts or index to a common base. Never dual-axis.
- Series colors bound to entity via `--viz-cat-*` in fixed order (paid=slot1, organic=slot5); never recolored when a filter changes series count.
- Gridlines `--viz-grid` hairline, horizontal only by default; axis baseline `--viz-axis`; ticks `--viz-tick` `--fs-caption` tabular. Y-axis starts at 0 for bars.
- Lines 2px; area fill = series color at 14% alpha (single) / 2px surface gap between stacked fills; bar radius 4px top, 2px surface gap between adjacent bars; markers ≥8px, shown on hover only for dense series.
- **Hover layer by default:** crosshair + tooltip (line/area), per-bar tooltip (bar). Tooltip = `--color-elevated`, `--shadow-popover`, `--radius-md`, lists each series (color swatch + label + tabular value), highlights hovered x. Legend always present for ≥2 series; ≤4 series also direct-labeled at line ends.
- Mount animation: paths draw L→R once (`--dur-moderate`); data changes cross-fade, no full redraw.

**States:** loading → Skeleton chart (shimmer bars/line placeholder, legend skeleton); empty → EmptyState inside plot; error → inline message + retry; reduced-motion disables draw-in.

---

## 10. Skeleton / loading

**Anatomy:** a shape (rect/line/circle) with a shimmer sweep.

**Props:** `variant?: 'text'|'rect'|'circle'|'kpi'|'chart'|'table-row'`; `width?; height?; lines?; radius?`.

**Style:** base `--color-surface-hover`; shimmer = a 1.4s linear-loop gradient sweep (`--color-surface-hover` → `--color-surface-active` → back) left→right; text variant uses `--fs-body` line-height blocks at 60–90% width, last line short. Composite skeletons: `kpi` (label bar + value bar + delta pill + sparkline rect), `chart` (legend chips + plot area with faint baseline), `table-row` (cells per column). Respects reduced-motion (static, no shimmer). Show skeletons only for >200ms loads; otherwise keep prior data with a subtle top progress bar.

---

## 11. EmptyState

**Anatomy:** centered stack — icon/illustration (48px, muted) → title (`--fs-h3` primary) → description (`--fs-small` secondary, ≤2 lines) → optional primary action + secondary link.

**Props:** `icon?; title; description?; action?; secondaryAction?; variant?: 'default'|'no-data'|'no-results'|'error'|'first-run'; size?: 'sm'|'md'`.

**Variants:** `no-data` ("No campaigns in this range" + adjust-dates CTA); `no-results` (clears filters); `first-run` (connect TikTok account CTA — primary accent button); `error` (danger icon + retry). Padding `--space-10` vertical; max text width 360px. Sits inside cards/tables/charts, never full-page unless the whole screen is empty.

---

## 12. Toast

**Anatomy:** container pinned bottom-right (`--z-toast`), stacked; each toast = leading status icon + (title + message) + optional action + close ×.

**Props:** `variant?: 'info'|'success'|'warning'|'danger'`; `title; message?; action?; duration?` (default 5000ms, `Infinity` for sticky); `onDismiss`.

**Style:** `--color-elevated`, `--radius-md`, `--shadow-lg`, 1px border, left 3px accent bar in the variant color, pad `--space-4`, max-width 380px, `--fs-small`. Icon in variant color. Enter: slide-up + fade (`--dur-moderate`, ease-decelerate); exit: fade + slide-right (`--dur-base`, ease-accelerate); a thin progress bar counts down duration (pauses on hover). Max 3 visible; older collapse. `role=status` (polite) / `alert` for danger.

---

## 13. Sidebar nav

**Anatomy:** fixed left column → brand/logo block (top, 56px, aligns to topbar) → primary nav groups (label overline + items) → spacer → footer (ClientSwitcher or user/account). Item = icon (18px) + label + optional trailing count badge.

**Props (item):** `icon; label; href; active?; badge?; children?` (collapsible sub-nav). **Component:** `collapsed?: boolean; onToggle`.

**Dimensions:** width `--layout-sidebar-w` 248 (collapsed 64), bg `--color-bg-subtle`, 1px right `--color-border`. Item height 36, radius `--radius-md`, pad-x `--space-3`, `--fs-small`. Group label `--fs-micro` uppercase muted, `--space-2` top margin.

**States:** rest text secondary + muted icon; hover bg `--color-surface-hover`, text primary; **active** = `--color-accent-subtle` bg + text primary + icon accent + 2px left accent inset bar; focus-visible ring. Collapsed → labels hidden, icons centered, hover shows a tooltip label; active bar persists. Collapse animates width `--dur-moderate ease-standard`. On <1024px sidebar becomes an off-canvas drawer over a scrim.

---

## 14. Topbar

**Anatomy:** sticky top row (`--layout-topbar-h` 56, `--z-topbar`) → left: sidebar toggle + breadcrumb/page title → center/left-of-right: **global filter bar mount point** (date range, paid/organic toggle) on dashboard screens → right cluster: search, "last updated" timestamp, notifications, ThemeToggle, ClientSwitcher/avatar.

**Style:** bg `--color-surface` with a 1px bottom `--color-border`; on scroll it stays flush (no shadow) to keep the data-forward feel — content scrolls under it. Items `--fs-small`; icon buttons ghost 32px. "Last updated" = muted caption + optional refresh ghost button. Breadcrumb: muted segments + primary current, `/` separators.

**Responsive:** <768px collapses secondary items (search, timestamp) into an overflow menu; page title truncates; date range becomes an icon-only trigger.

---

## 15. ClientSwitcher

**Anatomy:** trigger = client avatar/logo (24px, rounded `--radius-sm`) + client name + chevron → popover: searchable list of clients (avatar + name + tiny status pill e.g. "Paid+Organic"), grouped by agency team, with a "＋ Add client" footer action and current client checked.

**Props:** `clients; activeClientId; onSelect; searchable?` (default true when >7).

**Style:** trigger ghost button in topbar/sidebar-footer; panel `--color-elevated`, `--shadow-popover`, width 280, option height 40 (avatar + two-line name/meta). Selected row → check + `--color-accent-subtle`. Switching clients triggers a full dashboard refetch with a top progress bar; the active client's brand color (if white-labeled) can tint the domain pips but never overrides semantic tokens.

**States:** open animation like Select; keyboard searchable/roving; loading → skeleton rows; empty search → no-results EmptyState (sm).

---

## 16. ThemeToggle

**Anatomy:** a 3-state control — `System · Light · Dark` — as a segmented control (icon-only sun/monitor/moon) or a single cycling icon button.

**Props:** `value?: 'system'|'light'|'dark'; onChange; variant?: 'segmented'|'icon'`.

**Behavior:** writes `data-theme` on `<html>` (`light`/`dark`) or removes it for `system` (falls back to `:root` dark-first default; may honor `prefers-color-scheme` if product opts in). Icon crossfades + 180°-rotates on change (`--dur-base`, reduced-motion → instant). Persist to localStorage; set the attribute pre-hydration (inline script) to avoid a flash. Segmented variant reuses Tabs `segmented` styling at `sm`; active segment = raised chip. Focus-visible ring; `aria-pressed`/`aria-label` per option.

---

### Cross-component state cheat-sheet
| State | Treatment |
|---|---|
| Hover | bg step up (`surface → surface-hover`) or brightness ±6%, ≤120ms |
| Active/pressed | `surface-active` or brightness −6%, +0.5px translate |
| Focus-visible | `box-shadow: var(--shadow-focus-ring)` |
| Selected | `--color-accent-subtle` bg + accent marker (check/bar) |
| Disabled | `opacity: .45; pointer-events: none` |
| Loading | Skeleton (>200ms) or inline spinner; preserve layout |
| Invalid | `--color-danger` border + `--fs-caption` danger help text |

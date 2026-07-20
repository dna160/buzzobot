# Tempo Insight Engine — Dashboard Information Architecture

The primary client dashboard: a single screen where a marketing client sees their TikTok **paid** and **organic** performance and grasps the state of things in ~5 seconds. Built on the app shell and the component kit in [`COMPONENTS.md`](./COMPONENTS.md), tokens from [`tokens.css`](./tokens.css).

---

## 1. App shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ TOPBAR  56px   [☰] Overview        [ 📅 Jun 20–Jul 20 ▾ ][Paid|Both|Org]   ⟳ updated 2m · 🔔 · ◐ · [◐ Acme ▾] │
├────────────┬─────────────────────────────────────────────────────────┤
│ SIDEBAR    │ CONTENT  (max 1440, centered, pad-x 32)                  │
│ 248px      │  ┌─ Filter bar (sticky) ──────────────────────────────┐ │
│ • Overview │  │ Date range · Paid/Organic · Campaign · Compare      │ │
│ • Paid     │  ├──────────────────────────────────────────────────── │
│ • Organic  │  │ KPI ROW  (4 paid + 4 organic StatTiles)             │ │
│ • Content  │  │ CHART ROW 1 (spend-over-time · engagement trend)    │ │
│ • Audience │  │ CHART ROW 2 (conversion funnel · campaign table)    │ │
│ • Reports  │  │ TABLE ROW (top content)                             │ │
│ ─────────  │  └──────────────────────────────────────────────────── │
│ [◐ Acme ▾] │                                                         │
└────────────┴─────────────────────────────────────────────────────────┘
```

- **Sidebar** (`--layout-sidebar-w` 248, `--color-bg-subtle`, 1px right border): brand block, primary nav (Overview, Paid Ads, Organic, Content, Audience, Reports), footer ClientSwitcher. Active item = accent-subtle + 2px left accent bar.
- **Topbar** (56, sticky, `--z-topbar`): sidebar toggle + page title (left); global **date range** + **paid/organic segmented toggle** (center); "updated Nm ago" + refresh, notifications, ThemeToggle, ClientSwitcher (right).
- **Content**: centered `--layout-content-max` 1440, pad-x `32 → 24 → 16`, vertical rhythm `--space-8` between major rows, `--layout-gutter` 24 between cards.

### Responsive behavior
| Breakpoint | Sidebar | Topbar filters | KPI grid | Charts |
|---|---|---|---|---|
| ≥1440 | expanded 248 | inline | 8-up (2 rows of 4) | 2-up |
| 1024–1439 | expanded/collapsible | inline | 4-up | 2-up (funnel may wrap) |
| 768–1023 | collapsed 64 (drawer on demand) | date range inline, toggle in filter bar | 2-up | 1-up stacked |
| <768 | off-canvas drawer + scrim | date range → icon trigger; filters in a bottom sheet | 1-up | 1-up; tables horizontally scroll in an `overflow-x` container |

---

## 2. The filter bar

Sticky (`--z-sticky`) directly under the topbar, on `--color-bg-base`, 1px bottom `--color-border`, height ~52, one row:

`[ DateRangePicker ▾ ]   [ Paid | Both | Organic ]   [ Campaign ▾ (multi) ]   [ ⇄ Compare: vs prev period ]   ······   [ Export ▾ ]`

- **Date range** — presets Today / 7d / 30d (default) / 90d / MTD / Last month / Custom; drives every widget; comparison period feeds all delta pills.
- **Paid / Organic / Both** — segmented Tabs; **Both** is default. Filters which KPI tiles and charts render (organic-only hides Spend/ROAS/CPA; paid-only hides Views/Watch-time). This is the primary lens switch.
- **Campaign filter** — multi-select combobox (paid campaigns); when set, paid widgets scope to selection. Disabled in Organic mode.
- **Compare** — toggles "vs previous period" everywhere (StatTile deltas + faint comparison series in charts).
- **Export** — PDF/CSV of the current view (right-aligned, ghost).

All filters are URL-synced (shareable client links). Changing any filter triggers a coordinated refetch with a top progress bar; widgets show skeletons only if the load exceeds 200ms.

---

## 3. KPI row — the 5-second story

Eight `StatTile`s. In **Both** mode: two labeled groups on one grid — **Paid** (blue domain pip) then **Organic** (aqua pip). Each tile: eyebrow, big tabular value, semantic delta pill (vs previous period), and a sparkline of the range.

**Paid (blue pip):**
| Tile | Value | Format | Delta polarity | Sparkline |
|---|---|---|---|---|
| **Spend** | total ad spend | currency compact ($12.4k) | lower-is-better* | daily spend |
| **ROAS** | revenue ÷ spend | ratio (3.8×) | higher-is-better | daily ROAS |
| **Conversions** | attributed conversions | number compact | higher-is-better | daily conv. |
| **CPA** | spend ÷ conversions | currency ($6.10) | **lower-is-better** | daily CPA |

\*Spend polarity is neutral by product choice (more spend isn't inherently good/bad); render its delta in `--color-delta-neutral` unless the agency configures a budget-pacing target. ROAS/Conversions up = green; **CPA up = red ▲** (honest arrow, semantic color).

**Organic (aqua pip):**
| Tile | Value | Format | Delta polarity | Sparkline |
|---|---|---|---|---|
| **Views** | total video views | compact (2.1M) | higher-is-better | daily views |
| **Engagement Rate** | (likes+comments+shares+saves)/views | percent (6.4%) | higher-is-better | daily ER |
| **Followers** | net follower Δ (and total) | number (+3.2k) | higher-is-better | cumulative followers |
| **Avg Watch Time** | mean seconds watched | duration (0:11 / 11s) | higher-is-better | daily avg |

Reading order enforced by hierarchy: **value** (largest, primary ink) → **delta arrow+color** (is it good?) → **magnitude %** → **sparkline shape** (trend) → **eyebrow** (what it is). A client scanning left→right, paid-then-organic, learns "spend flat, ROAS up, views up, engagement up" in one pass.

Grid: `repeat(4, 1fr)` at ≥1440 (2 rows), `repeat(2,1fr)` at md, 1-up on mobile; gap `--layout-gutter`. Group labels ("PAID · TIKTOK ADS", "ORGANIC · TIKTOK") are `--fs-micro` overlines above each block.

---

## 4. Chart & table rows

**Chart Row 1 — two `ChartWrapper`s, 50/50:**
- **Spend & ROAS over time** (paid): single-axis line/area of daily **spend**; ROAS shown as a second small-multiple strip beneath OR indexed — never dual-axis. Campaign-launch annotations as vertical markers. Series color = `--viz-series-paid`. Comparison period as a faint prior-period line when Compare is on.
- **Engagement trend** (organic): line chart of daily **views** with **engagement rate** as a companion small multiple; organic aqua series. Direct end-labels; legend present.

**Chart Row 2 — funnel (40%) + campaign table (60%):**
- **Conversion funnel** (paid): horizontal ordinal bars — **Impressions → Clicks → Add-to-cart → Conversions** — using the ordinal blue ramp (start no lighter than `--viz-seq-200`), each stage labeled with count + step conversion %. Reads top-to-bottom as attrition.
- **Campaign performance table** (paid): dense sortable `Table` — columns: Campaign (sticky left) · Status badge · Spend · ROAS · Conversions · CPA · CTR · trend sparkline. Sorted by Spend desc default; in-cell mini-bars (`--viz-seq-400`) for ROAS, semantic delta chips for CPA. Row click drills into the campaign.

**Table Row — Top content (organic):** dense `Table` of top-performing videos — Thumbnail · Caption (sticky/truncated) · Views · Engagement Rate · Avg Watch Time · Shares · Saves · Posted date · trend sparkline. Sorted by Views desc; row click opens the video detail. Top 10 with "View all →" to the Content screen.

In **Paid** mode: show spend/ROAS chart + funnel + campaign table (hide organic widgets). In **Organic** mode: engagement trend + top content table (hide paid). In **Both**: everything, paid row then organic row.

---

## 5. Visual hierarchy — what wins the eye

1. **KPI values** — largest type, highest contrast (`--color-text-primary` on `--color-surface`), top of page. The single loudest layer.
2. **Delta color + direction** — the only saturated color in the KPI zone; greens/reds pull the eye to what changed.
3. **Primary trend chart** (spend/views over time) — the biggest data ink below the fold-line; a client's "how are we trending" answer.
4. **Supporting charts/tables** — recessive chrome, hairline grids, muted axes; detail on demand via hover tooltips and drill-in.
5. **Navigation & chrome** — quietest layer (bg-subtle sidebar, borderless topbar), never competing with data.

Whitespace and hairlines do the grouping: paid vs organic are separated by an overline label and a full-gutter gap, not by boxes-within-boxes. The result is dense but breathable — a client sees the headline numbers and their direction instantly, then drills into charts and tables for the "why."

### The 5-second test
On load a client should, without scrolling or clicking, be able to say: **"Spend is [flat/up], efficiency (ROAS/CPA) is [better/worse], and my organic reach/engagement is [up/down] — over the last 30 days."** If the KPI row + delta colors don't deliver exactly that sentence, the hierarchy is wrong.

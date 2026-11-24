"""Paid-metric derivation and formatting for the ads tools (PRD §7.2, §7.3).

Every value is derived from already-summed fields in Python and formatted here,
never recomputed by the model: `ads_performance` and `campaign_breakdown` only
arrange these lines. The rules the tools must keep (PRD §7.3) live here:

- **Grain & additivity.** Only campaign-level rows (`adgroup_id IS NULL`) are
  summed, at day/window grain — the caller filters before handing rows in.
- **Ratios from sums.** CTR, CPM, CPC, ROAS, CVR, AOV, CPI, VTR are derived
  from summed numerators/denominators (reusing `tempo_read._derive_*`), and
  omitted when the denominator is 0.
- **Polarity.** Each metric knows whether up is "membaik" or "memburuk", so a
  rising CPA is never read as good.
- **Currency.** Non-IDR is "8.562,83 USD"; values under 1 keep 4 decimals so a
  small unit cost never collapses to "0,03".
- **Changes** print with one decimal ("+0,3%"), the form the number check
  accepts, and name the direction of merit.
- **Window** ends at the last complete day: `min(last ingested, today−1)` in the
  client's timezone, so today's still-filling partial day is excluded.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from engine.copy.strategy import dec, num, pct
from engine.ports.tempo_read import (
    AwarenessRollupRow,
    RollupRow,
    _derive_awareness_metrics,
    _derive_gmv_metrics,
    _derive_install_metrics,
    _sum_awareness_rows,
    _sum_rows,
    resolve_window,
)

Fmt = Literal["money", "num", "pct", "ratio"]


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    fmt: Fmt
    #: +1 = higher is better, −1 = lower is better, 0 = neither (spend, volume).
    polarity: int


_COMMON_PAID: tuple[Metric, ...] = (
    Metric("spend", "Belanja", "money", 0),
    Metric("impressions", "Impresi", "num", 0),
    Metric("clicks", "Klik", "num", 0),
    Metric("ctr", "CTR", "pct", 1),
    Metric("cpm", "CPM", "money", -1),
    Metric("cpc", "CPC", "money", -1),
)

METRIC_SETS: dict[str, tuple[Metric, ...]] = {
    "shop": _COMMON_PAID
    + (
        Metric("orders", "Pesanan", "num", 1),
        Metric("gmv", "GMV", "money", 1),
        Metric("roas", "ROAS", "ratio", 1),
        Metric("cost_per_order", "Biaya per pesanan", "money", -1),
        Metric("cvr", "CVR", "pct", 1),
        Metric("aov", "AOV", "money", 1),
    ),
    "app_install": _COMMON_PAID
    + (
        Metric("installs", "Instalasi", "num", 1),
        Metric("cpi", "CPI", "money", -1),
        Metric("ir", "CVR (klik→instalasi)", "pct", 1),
    ),
    "vtr": (
        Metric("spend", "Belanja", "money", 0),
        Metric("impressions", "Impresi", "num", 0),
        Metric("cpm", "CPM", "money", -1),
        Metric("reach", "Jangkauan (dijumlah per hari, bukan unik)", "num", 1),
        Metric("vtr6s", "VTR 6 detik", "pct", 1),
        Metric("vtr15s", "VTR 15 detik", "pct", 1),
        Metric("cost_per_6s", "Biaya per tontonan 6 detik", "money", -1),
        Metric("views_6s", "Tontonan 6 detik", "num", 1),
    ),
}

#: Which rollup a north star reads. vtr uses the awareness surface (reach, 6s/15s
#: views); shop and app_install use the GMV/conversion surface.
USES_AWARENESS = ("vtr",)


def money(v: float | None, currency: str) -> str:
    """Indonesian-grouped money. IDR rounds to the whole unit ("Rp8.563");
    other currencies keep two decimals and a suffix ("8.562,83 USD"); any value
    under 1 keeps four decimals so a small unit cost does not collapse to 0."""
    if v is None:
        return "—"
    decimals = 4 if 0 < abs(v) < 1 else (0 if currency == "IDR" else 2)
    body = dec(v, decimals)
    return f"Rp{body}" if currency == "IDR" else f"{body} {currency}"


def _fmt(m: Metric, v: float | None, currency: str) -> str:
    if v is None:
        return "—"
    if m.fmt == "money":
        return money(v, currency)
    if m.fmt == "num":
        return num(v)
    if m.fmt == "pct":
        return pct(v)
    return f"{dec(v, 2)}×"  # ratio (ROAS)


def metric_values(north_star: str, sums: dict[str, float]) -> dict[str, float]:
    """Every metric for one summed window, keyed as in `METRIC_SETS`. A ratio is
    present only when its denominator was non-zero (the derive helpers enforce
    that); the caller omits absent keys from the output."""
    spend = sums["spend"]
    impressions = sums["impressions"]
    if north_star == "shop":
        m = dict(_derive_gmv_metrics(**sums))
        if "roi" in m:
            m["roas"] = m["roi"]
        if m.get("orders"):
            m["cost_per_order"] = spend / m["orders"]
    elif north_star == "app_install":
        m = dict(_derive_install_metrics(**sums))
    else:  # vtr / awareness surface
        m = dict(_derive_awareness_metrics(**sums))
        m["views_6s"] = sums["video_watched_6s"]
        if sums["video_watched_6s"]:
            m["cost_per_6s"] = spend / sums["video_watched_6s"]
    if north_star in ("shop", "app_install"):
        if impressions:
            m["cpm"] = spend / impressions * 1000
        if sums["clicks"]:
            m["cpc"] = spend / sums["clicks"]
    m["spend"] = spend
    return m


def sum_rows(north_star: str, rows: list[RollupRow] | list[AwarenessRollupRow]) -> dict[str, float]:
    if north_star in USES_AWARENESS:
        return _sum_awareness_rows([r for r in rows if isinstance(r, AwarenessRollupRow)])
    return _sum_rows([r for r in rows if isinstance(r, RollupRow)])


def _change(cur: float | None, prior: float | None, polarity: int) -> str:
    if prior is None:
        return "tidak ada pembanding"
    if prior == 0:
        return "baru periode ini" if cur else "0"
    if cur is None:
        return "—"
    d = (cur - prior) / prior
    sign = "+" if d >= 0 else "−"
    s = f"{sign}{pct(abs(d), 1)} vs periode sebelumnya"
    if polarity != 0 and d != 0:
        improving = (d > 0) == (polarity > 0)
        s += ", membaik" if improving else ", memburuk"
    return s


def summarize(north_star: str, cur: dict[str, float], prior: dict[str, float], currency: str) -> list[str]:
    """One bullet per metric present in the window, with its change vs the equal
    prior window and the direction of merit."""
    lines: list[str] = []
    for m in METRIC_SETS.get(north_star, METRIC_SETS["shop"]):
        if m.key not in cur:
            continue
        val = _fmt(m, cur.get(m.key), currency)
        change = _change(cur.get(m.key), prior.get(m.key), m.polarity)
        lines.append(f"- {m.label}: {val} ({change})")
    return lines


def window_bounds(
    available: list[date], today: date, end_date: date | None, window_days: int
) -> tuple[date, date, date, date] | None:
    """(current_first, current_last, prior_first, prior_last), clamped so the
    window ends at the last complete day — `min(last ingested, today−1)` or the
    caller's `end_date` — never today's partial day (PRD §7.3). `None` when no
    data falls on or before that day."""
    if not available:
        return None
    ceiling = (end_date or today) if end_date else today - timedelta(days=1)
    if end_date is None:
        ceiling = min(ceiling, today - timedelta(days=1))
    if not any(d <= ceiling for d in available):
        return None
    return resolve_window(available, ceiling, window_days)

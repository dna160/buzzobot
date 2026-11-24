"""Deterministic gates for the Strategy Report's full tier (PRD §8.6).

- **Numeral gate (strategy form).** The deck's gate checks numerals against
  routed evidence. Here the permitted set is every number the model was
  actually shown: the routed findings' evidence plus the numerals in the
  payload text itself, which is code output (formatted facts, solver values).
  A number the model could not have read is an orphan. On top of the deck's
  derivations (rounding, ×100, ID separators, integers ≤ 24) it accepts:
  - `%` and `poin` as one family — "4,5%" and "4,5 poin" both match 0.045
    (the ×100 derivation already covers both suffixes; tested here);
  - scale words: "48,6 juta", "Rp1,6 jt", "236 ribu", "1,2 miliar";
  - labels that are not claims: "per 1.000", "Top 50", "R²", calendar dates.
- **Action gate.** `langkah` carries the solver's current and target values
  and the horizon, no other numeral, and an approved lever phrasing;
  `gagal_jika` carries the kill-signal day count.
- **Chip gate.** T1 chips cite the same findings, statuses and numbers as
  the deterministic chips computed from the generators.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from engine.contracts import Finding
from engine.contracts.strategy import ActionCopy, ActionItem, VerdictChip
from engine.gates.numeral_gate import _NUMERAL_PATTERN, _is_benign, _is_permitted, normalize_id_numeral

_MONTHS = (
    "januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|"
    "jan|feb|mar|apr|jun|jul|agu|agt|aug|sep|sept|okt|oct|nov|des|dec"
)
_LABEL_PATTERNS = [
    re.compile(r"per\s+1\.000\b", re.IGNORECASE),
    re.compile(r"\btop[\s-]?\d{1,2}\b", re.IGNORECASE),
    re.compile(r"R²|R\^?2\b"),
    re.compile(rf"\b\d{{1,2}}\s+(?:{_MONTHS})\b(?:\s+\d{{4}})?", re.IGNORECASE),
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
]
_SCALE = {"juta": 1e6, "jt": 1e6, "ribu": 1e3, "rb": 1e3, "rbu": 1e3, "miliar": 1e9, "milyar": 1e9, "m": 1e9, "k": 1e3}
_SCALE_AFTER = re.compile(r"\s?(juta|jt|ribu|rb|miliar|milyar|M|K)\b")


@dataclass(frozen=True)
class Numeral:
    token: str
    value: float
    start: int
    end: int
    scale: float = 1.0


def strip_labels(text: str) -> str:
    """Blank out label numerals (keeping offsets) so they are never checked.
    "Rp48.600.000" is unglued from its currency code first: the deck gate's
    pattern refuses a numeral preceded by a letter, which would otherwise let
    every Rupiah amount written without a space skip the check entirely."""
    text = re.sub(r"Rp(?=\d)", "  ", text)
    for pat in _LABEL_PATTERNS:
        text = pat.sub(lambda m: " " * len(m.group(0)), text)
    return text


def numerals(text: str) -> list[Numeral]:
    clean = strip_labels(text)
    out: list[Numeral] = []
    for m in _NUMERAL_PATTERN.finditer(clean):
        token = m.group(0).strip()
        try:
            value = normalize_id_numeral(token)
        except ValueError:
            continue
        scale = 1.0
        s = _SCALE_AFTER.match(clean, m.end())
        if s:
            scale = _SCALE.get(s.group(1).lower(), 1.0)
        out.append(Numeral(token=token, value=value, start=m.start(), end=m.end(), scale=scale))
    return out


def allowed_from(findings: Iterable[Finding], *texts: str, extra: Iterable[float] = ()) -> set[float]:
    allowed: set[float] = set()
    for f in findings:
        for v in f.evidence.values():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                allowed.add(float(v))
    for t in texts:
        for n in numerals(t):
            allowed.add(n.value)
            if n.scale != 1.0:
                allowed.add(n.value * n.scale)
    allowed.update(float(v) for v in extra)
    return allowed


def _ok(n: Numeral, allowed: set[float]) -> bool:
    if _is_benign(n.token) and n.scale == 1.0:
        return True
    if _is_permitted(n.value, allowed):
        return True
    return n.scale != 1.0 and _is_permitted(n.value * n.scale, allowed)


def orphan_numerals(text: str, allowed: set[float]) -> list[str]:
    return [n.token for n in numerals(text) if not _ok(n, allowed)]


# ─── Action gate ─────────────────────────────────────────────────────────────

APPROVED_PHRASES: dict[str, tuple[str, ...]] = {
    "content_mix": ("naikkan porsi impresi",),
    "stage_targeting": ("naikkan ukuran tahap", "arahkan"),
    "budget_cap": ("batasi belanja harian",),
    "creator_boost": ("tambah boost video kreator",),
    "creative_refresh": ("luncurkan materi kreatif baru",),
    "investigate": ("selidiki",),
}


def _display(value: float, fmt: str) -> float:
    return value * 100 if fmt == "percent" else value


def _matches(n: Numeral, target: float) -> bool:
    """The written numeral is `target` rounded to the precision it was written
    at ("4,3%" for 4,35%), or within 1% (a scaled "Rp1,6 juta"). A whole
    number only passes on the 1% rule, so "4%" is not 4,35%."""
    v = n.value * n.scale
    if target == 0:
        return v == 0
    decimals = len(n.token.split(",")[1].rstrip("x% ")) if "," in n.token else 0
    if n.scale == 1.0 and decimals >= 1 and abs(v - target) <= 0.5 * 10**-decimals + 1e-9:
        return True
    return abs(v - target) / abs(target) <= 0.01


def run_action_gate(item: ActionCopy, action: ActionItem, finding: Finding | None) -> list[str]:
    """Violations for one action's copy; empty means it passes."""
    problems: list[str] = []
    langkah = item.langkah.strip()
    low = langkah.lower()
    phrases = APPROVED_PHRASES.get(action.lever, ())
    if phrases and not any(p in low for p in phrases):
        problems.append(f"langkah harus memakai frasa yang disetujui: {' / '.join(repr(p) for p in phrases)}")

    found = numerals(langkah)
    used: set[int] = set()

    def need(target: float, label: str) -> None:
        hit = next((i for i, n in enumerate(found) if i not in used and _matches(n, target)), None)
        if hit is None:
            problems.append(f"langkah tidak memuat {label}")
        else:
            used.add(hit)

    if action.lever == "investigate":
        e = finding.evidence if finding else {}
        for key, label in (("rank_14d", "peringkat awal"), ("rank_now", "peringkat sekarang")):
            if isinstance(e.get(key), (int, float)):
                need(float(e[key]), f"{label} #{int(e[key])}")
        if action.subject and action.subject.lower() not in low:
            problems.append(f"langkah tidak menyebut {action.subject}")
    else:
        if action.current is not None:
            need(_display(action.current.value, action.current.format), "nilai saat ini")
        if action.target is not None:
            need(_display(action.target.value, action.target.format), "nilai target")

    weeks = action.horizon_days / 7
    # An investigation has no target to reach by a date: its numbers are the
    # two ranks and the look-back window the move happened in.
    horizon_ok = action.lever == "investigate"
    for i, n in enumerate(found):
        if i in used:
            continue
        tail = langkah[n.end : n.end + 12].lower()
        if (abs(n.value - weeks) < 1e-6 and "minggu" in tail) or (abs(n.value - action.horizon_days) < 1e-6 and "hari" in tail):
            used.add(i)
            horizon_ok = True
            break
    if not horizon_ok and action.target and action.target.by and action.target.by.isoformat() in langkah:
        horizon_ok = True
    if action.lever == "investigate":
        for i, n in enumerate(found):
            if i not in used and "hari" in langkah[n.end : n.end + 8].lower():
                used.add(i)
    if not horizon_ok:
        problems.append(f"langkah tidak memuat jangka waktu ({weeks:g} minggu atau {action.horizon_days} hari)")

    extra = [found[i].token for i in range(len(found)) if i not in used]
    if extra:
        problems.append(f"langkah memuat angka lain: {extra}")

    if not item.gagal_jika.strip():
        problems.append("gagal_jika kosong")
    elif action.kill_signal is not None:
        days = action.kill_signal.days
        if not any(abs(n.value - days) < 1e-6 for n in numerals(item.gagal_jika)):
            problems.append(f"gagal_jika harus memuat {days} hari")
    return problems


# ─── Chip gate ───────────────────────────────────────────────────────────────


def run_chip_gate(chips: list[VerdictChip], reference: list[VerdictChip]) -> list[str]:
    """Each chip must cite the same finding, carry the same status and the same
    numbers as the deterministic chip in its position. Labels may be reworded."""
    problems: list[str] = []
    if len(chips) != len(reference):
        return [f"harus ada {len(reference)} chip"]
    for i, (c, r) in enumerate(zip(chips, reference, strict=True), start=1):
        if (c.finding_id or None) != (r.finding_id or None):
            problems.append(f"chip {i}: finding_id harus {r.finding_id!r}")
        if c.status != r.status:
            problems.append(f"chip {i}: status harus {r.status!r}")
        got = sorted(round(n.value, 2) for n in numerals(c.value))
        want = sorted(round(n.value, 2) for n in numerals(r.value))
        if got != want:
            problems.append(f"chip {i}: nilai harus memuat angka {r.value!r}")
        if not c.label.strip():
            problems.append(f"chip {i}: label kosong")
    return problems

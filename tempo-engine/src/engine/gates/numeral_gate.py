"""The numeral gate. PRD §8: "Every numeral in output must exist in the
routed findings' evidence, plus permitted derivations (rounding, percent,
ID thousand-separators). Orphan -> regenerate, max 2, then flag."

Deterministic, post-generation, no model involved. Build first, before any
narration — this is the single gate that most protects client trust (a
plausible-looking fabricated number is worse than no number at all, because
nothing downstream can tell the difference).

Indonesian locale: thousands separator is `.`, decimal separator is `,`
(the reverse of English) — "Rp 506.058.865" is 506058865, "9,41x" is 9.41,
"21,18%" is 21.18.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from engine.contracts import Finding

# Matches an Indonesian-formatted number: groups of 1-3 digits separated by
# `.`, optionally followed by a `,`-decimal part, optionally followed by a
# unit suffix (x or %). Also matches a plain integer/decimal with no
# separators at all (e.g. a bare finding count like "5").
_NUMERAL_PATTERN = re.compile(
    r"""
    (?<![\w.,])                      # not preceded by a word char or separator (avoid mid-token matches)
    \d{1,3}(?:\.\d{3})*              # integer part, optionally thousands-grouped
    (?:,\d+)?                        # optional Indonesian decimal part
    (?:\s?[x%])?                     # optional unit suffix
    (?![\w])                         # not followed by a word char
    """,
    re.VERBOSE,
)

# Percent/multiple conversions and rounding are explicitly permitted
# derivations (PRD §8) — a numeral within this relative tolerance of an
# evidence value (directly, x100, or /100) is not an orphan.
_ROUNDING_TOLERANCE = 0.01  # 1% relative, covers "27.34" narrated as "27.3"
# A value that rounds to the nearest whole number of an evidence value is
# also a permitted derivation, checked separately from the relative
# tolerance above: "27.34" written as the whole number "27" is a 1.24%
# relative gap (over the tolerance above) but an entirely ordinary rounding
# a human writer makes without thinking about it. Live-tested against
# google/gemma-4-12b (B4 exit-gate run) — the model rounds this way often
# enough that the relative-only check alone pushed fallback to 25%.
_WHOLE_NUMBER_ROUNDING_TOLERANCE = 0.5


@dataclass(frozen=True)
class NumeralViolation:
    token: str
    normalized_value: float
    context: str  # the ~60-char window the token was found in, for the flag/review queue


@dataclass(frozen=True)
class NumeralGateResult:
    ok: bool
    violations: tuple[NumeralViolation, ...]


def extract_numerals(text: str) -> list[str]:
    return [m.group(0).strip() for m in _NUMERAL_PATTERN.finditer(text)]


def normalize_id_numeral(token: str) -> float:
    """"Rp 506.058.865" -> 506058865.0, "9,41x" -> 9.41, "21,18%" -> 21.18.
    Strips any leading non-digit prefix (a currency symbol/code) — the
    numeral gate's own `extract_numerals` never captures one, but this
    function is documented to accept "Rp ..." directly, so it must actually
    handle it rather than only work by accident of what its one caller passes.
    """
    cleaned = token.strip().rstrip("x%").strip()
    match = re.search(r"\d", cleaned)
    if match:
        cleaned = cleaned[match.start() :]
    cleaned = cleaned.replace(".", "").replace(",", ".")
    return float(cleaned)


def allowed_values(findings: list[Finding]) -> set[float]:
    """Every numeric value in every routed finding's evidence — the base
    set a numeral gate checks against. Only the findings actually passed to
    the narrator (a `SectionPayload`'s `findings`), never the full frame —
    a numeral is only "permitted" if the narrator could actually have seen it.
    """
    values: set[float] = set()
    for f in findings:
        for v in f.evidence.values():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                values.add(float(v))
    return values


def _is_permitted(value: float, allowed: set[float]) -> bool:
    # A negative evidence value (e.g. a -21.18% decline) is normally
    # described in prose with the sign carried in words ("penurunan sebesar
    # 21,18%"), not as a literal "-21,18" — extract_numerals never captures
    # a leading minus, so permitted values are compared unsigned throughout.
    value = abs(value)
    for a in allowed:
        a = abs(a)
        for candidate in (a, a * 100, a / 100 if a != 0 else None):
            if candidate is None:
                continue
            if candidate == 0:
                if value == 0:
                    return True
                continue
            if abs(value - candidate) / abs(candidate) <= _ROUNDING_TOLERANCE:
                return True
            if abs(value - candidate) <= _WHOLE_NUMBER_ROUNDING_TOLERANCE:
                return True
    return False


# Small counting numbers used in ordinary connective prose ("kedua metrik
# ini", "3 dari 5 temuan") are not a fabrication risk the way a money or
# percentage figure is. The B4 live exit-gate run against google/gemma-4-12b
# confirmed this empirically: without an exception, small incidental
# integers (a "2" meaning "both", not tied to any single evidence value)
# were rejected as orphans and drove real, unnecessary fallbacks. Bounded to
# <=24 with no thousands/decimal separators — the same threshold the Tempo
# web app's own (previously shipped, production-tested) numeral gate uses
# for exactly this reason.
_BENIGN_MAX_INTEGER = 24


def _is_benign(token: str) -> bool:
    bare = token.strip()
    if not bare.isdigit():
        return False
    return len(bare) <= 2 and int(bare) <= _BENIGN_MAX_INTEGER


def run_numeral_gate(text: str, findings: list[Finding]) -> NumeralGateResult:
    allowed = allowed_values(findings)
    violations: list[NumeralViolation] = []
    for token in extract_numerals(text):
        if _is_benign(token):
            continue
        try:
            value = normalize_id_numeral(token)
        except ValueError:
            continue
        if not _is_permitted(value, allowed):
            idx = text.find(token)
            start = max(0, idx - 30)
            end = min(len(text), idx + len(token) + 30)
            violations.append(NumeralViolation(token=token, normalized_value=value, context=text[start:end]))

    return NumeralGateResult(ok=not violations, violations=tuple(violations))

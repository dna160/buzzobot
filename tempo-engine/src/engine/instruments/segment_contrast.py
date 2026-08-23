"""`segment_contrast(dimension_a, dimension_b, metric)` — PRD §5.2. This
implementation contrasts value-groups within ONE dimension (like G06) rather
than a true two-dimension interaction — PRD's exact two-dimension signature
is ambiguous (a cross-tab? a paired comparison of two separate axes on the
same metric?) and a single-dimension pairwise contrast, FDR-corrected across
however many value-pairs exist, is the well-defined, already-proven version
(G06 uses exactly this). `dimension_b` is accepted but unused when it names
a second dimension — the caller may probe two dimensions with two separate
calls, which is what "the analyst notices X and asks for it on Y too" (PRD
§5.2's own worked example) actually describes: sequential single-dimension
probes, not one combined call.
"""

from __future__ import annotations

from itertools import combinations

from engine.contracts import EntityRef, MetricFrame
from engine.generators._util import non_account_records
from engine.instruments.base import InstrumentResult
from engine.stats import benjamini_hochberg, welch_t_test

MIN_GROUP_SIZE = 2
ALPHA = 0.05
MIN_EFFECT_SIZE = 0.5


def segment_contrast(frame: MetricFrame, dimension_a: str, metric: str, dimension_b: str | None = None) -> InstrumentResult:
    records = [r for r in non_account_records(frame, "current") if metric in r.metrics and dimension_a in r.dimensions]
    groups: dict[str, list] = {}
    for r in records:
        groups.setdefault(r.dimensions[dimension_a], []).append(r)
    eligible = {v: g for v, g in groups.items() if len(g) >= MIN_GROUP_SIZE}

    if len(eligible) < 2:
        return InstrumentResult(instrument="segment_contrast", ok=False, reason=f"fewer than 2 value-groups of {dimension_a!r} with >={MIN_GROUP_SIZE} entities each")

    candidates = []
    for (val_a, group_a), (val_b, group_b) in combinations(eligible.items(), 2):
        sample_a = [r.metrics[metric] for r in group_a]
        sample_b = [r.metrics[metric] for r in group_b]
        candidates.append((val_a, val_b, sample_a, sample_b))

    results = [welch_t_test(c[2], c[3]) for c in candidates]
    p_values = [r.p_value if r is not None else 1.0 for r in results]
    adjusted = benjamini_hochberg(p_values)

    significant = [
        {
            "value_a": c[0], "value_b": c[1],
            "mean_a": round(sum(c[2]) / len(c[2]), 4), "mean_b": round(sum(c[3]) / len(c[3]), 4),
            "effect_size": round(r.effect_size, 3), "p_value_fdr_adjusted": round(p, 4),
        }
        for c, r, p in zip(candidates, results, adjusted, strict=True)
        if r is not None and p < ALPHA and abs(r.effect_size) >= MIN_EFFECT_SIZE
    ]
    if not significant:
        return InstrumentResult(instrument="segment_contrast", ok=False, reason=f"tested {len(candidates)} pair(s); none survived FDR correction")

    return InstrumentResult(
        instrument="segment_contrast", ok=True, entity=EntityRef(id=f"dimension_{dimension_a}", display_name=dimension_a),
        data={"dimension": dimension_a, "metric": metric, "significant_pairs": significant},
    )

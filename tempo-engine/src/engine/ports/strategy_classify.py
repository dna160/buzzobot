"""Report class inference (Strategy Report PRD §5.2) — code only, never a model.

`score_shop` follows the PRD's formula exactly. P0 found it degenerate on
today's data: every linked client has `north_star = shop`, which alone meets
the threshold, so every one infers `shop` and the brand class appears only
through an AM override (P0_DISCOVERY.md §6.1). That is recorded, not patched
here — the weighting is a product decision, and the inputs are exported in
`Classification.inputs` so the AM can see exactly why.
"""

from __future__ import annotations

from engine.contracts.strategy import Classification, ReportClass

SHOP_THRESHOLD = 2


def score_shop(north_star: str, gmv_share: float | None, conv_ratio: float | None) -> int:
    score = 0
    if north_star == "shop":
        score += 2
    elif north_star == "vtr":
        score -= 2
    elif north_star == "app_install":
        score -= 1
    if gmv_share is not None:
        if gmv_share >= 0.5:
            score += 2
        elif gmv_share >= 0.25:
            score += 1
        elif gmv_share < 0.10:
            score -= 1
    if conv_ratio is not None and conv_ratio >= 0.10:
        score += 1
    return score


def classify(
    *,
    north_star: str,
    gmv_share: float | None,
    conv_ratio: float | None,
    override: ReportClass | None = None,
) -> Classification:
    score = score_shop(north_star, gmv_share, conv_ratio)
    inferred: ReportClass = "shop" if score >= SHOP_THRESHOLD else "brand"
    return Classification(
        report_class=override or inferred,
        score=score,
        inferred_class=inferred,
        overridden=override is not None and override != inferred,
        inputs={
            "north_star": north_star,
            "gmv_share": None if gmv_share is None else round(gmv_share, 4),
            "conversion_to_consideration": None if conv_ratio is None else round(conv_ratio, 4),
        },
    )

# PRD — Tempo Intelligence Engine v1

**Owner:** Johnson Leonardi
**Relationship to Tempo:** Tempo Insight Engine (`dna160/buzzobot`) is the **surface** — ingestion, storage, dashboard, delivery. This document specifies the **engine** behind it: a separate Python service that owns analysis, agentic orchestration, and narrative synthesis.
**Status:** Supersedes both prior PRDs. The first assumed a greenfield Python service with no host system; the second assumed the engine had to live inside Tempo's TypeScript monorepo. Both were wrong in the same way — they treated the engine as an extension of something else rather than as the system it actually is.
**Date:** 19 Aug 2026

---

## 0. Repositioning

Tempo already does what it is good at: normalized TikTok ingestion (paid, organic, Shop, Market Scope), idempotent fact-grain storage, multi-tenant client model, dashboards, PDF/HTML delivery, and an API surface.

What it does not have is an analytical engine. It has a deterministic report writer handing a flat fact sheet to a model — which is why output reads generic regardless of model size.

**The engine is a separate service.** Rationale:

| | Why not inside Tempo |
|---|---|
| Statistical stack | XGBoost/SHAP, statsmodels (Granger, FDR), scipy, PCA composites have no TypeScript equivalent worth using |
| Agent framework | LangGraph is Python-first; durable checkpointing and human interrupts are the reason to use it at all |
| Lifecycle | The engine serves brief generation *and* the onboarding pipeline *and* the benchmark layer. It outlives any one surface. |
| Failure isolation | A stalled agent run must not touch dashboard availability |

Tempo becomes a client of the engine, not its host.

---

## 1. Boundary Contract

```
┌──────────────────────────── Tempo (TypeScript) ────────────────────────────┐
│  @tempo/tiktok → @tempo/db → Postgres          apps/web (dashboard, tRPC)   │
│  ingestion, fact grain, read-models            renders briefs, review UI    │
└───────────┬─────────────────────────────────────────────────▲──────────────┘
            │ reads (read-only role)                          │ reads
            ▼                                                 │
┌──────────────────────── Tempo Intelligence Engine (Python) ─┴──────────────┐
│  FastAPI + LangGraph + Postgres checkpointer + Redis                        │
│                                                                             │
│  reads   →  tempo.*     read-models, fact tables      (READ ONLY, enforced) │
│  writes  →  insight.*   findings, briefs, runs, benchmarks, brand context   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Rules of the boundary:**

1. The engine holds a Postgres role with `SELECT` only on `tempo.*`. Not convention — a grant. The engine can never corrupt the system of record.
2. The engine owns the `insight.*` schema entirely. Tempo reads it; never writes it.
3. The engine never re-derives a metric Tempo already defines. It calls a thin port over `@tempo/core`'s `METRICS` catalog semantics, mirrored as a versioned Python contract with a CI check that fails on drift. A brief that contradicts the dashboard is worse than no brief.
4. Ingestion stays in Tempo. The engine never talks to TikTok.

### 1.1 Interface

```
POST  /v1/briefs                {tenant, clientSlug, briefType, range}  → run_id
GET   /v1/briefs/{run_id}                                               → status | brief
POST  /v1/briefs/{run_id}/review {decision, edits}                      → resumes graph
POST  /v1/onboarding            {tenant, clientSlug, accountId}         → run_id
GET   /v1/runs/{run_id}/trace                                           → full audit
```

Long-running work is a durable LangGraph run, not an HTTP wait. `POST` returns immediately; state lives in the Postgres checkpointer; the review endpoint resumes an interrupted graph.

---

## 2. Agent Doctrine

**The single most important section. Every design decision below follows from it.**

Agents fail worse than single prompts when they disagree about a number. Multiplying agents in the analytical path multiplies the failure this project exists to fix. So the line is drawn once, explicitly:

| Owned by **deterministic code** | Owned by **agents** |
|---|---|
| Computation of any figure | Orchestration and routing |
| Aggregation across entities | Deciding *which analysis to request* (via bounded instruments) |
| Materiality scoring and selection | Open-ended retrieval from public sources |
| Privacy, k-anonymity, DP | Narration of pre-ranked findings |
| Numeral validation | Adversarial critique |
| Anonymization between tenant layers | Cross-section synthesis |

Restated as a rule an engineer can apply: **an agent may choose what question to ask of the data; only code may answer it.**

This is what makes the probe loop (§6) safe and what keeps the multi-agent structure from becoming a liability. Every agent below has a typed input contract, a typed output contract, and an explicit tool allowlist. An agent with an open tool surface is a bug.

---

## 3. Data Reality — Constraints That Bind Every Computation

Non-obvious, silent when violated, invisible at review because the output still looks authoritative. Read before writing a generator.

### 3.1 Campaign and adgroup rows are parallel decompositions, not a sum

Campaign `reach` dedupes across adgroups; levels sync at different cutoffs; they are stored separately (`adgroup_id IS NULL` is the campaign rollup) and **must never be added**.

- Every `Finding` carries an explicit `level`. A finding mixing levels is a bug.
- **Reach is non-additive.** Any generator summing reach is arithmetically wrong. Bites Awareness hardest.
- **Ratios are never averaged.** ROI, CPI, CTR, CVR, VTR are recomputed from summed numerators and denominators. This is the most common error in agency reporting.

### 3.2 The first synced bucket of a day is not an hour

It carries everything since midnight (`span_hours > 1`), counts in day totals, is excluded from hourly series. Day-over-day deltas compare only shared hours.

### 3.3 Surface coverage

| Surface | Status |
|---|---|
| Paid (Business/Marketing API) | Live, documented |
| Organic (Display/Content API) | Live, documented |
| Shop | Live, **DTO undocumented** — contract needed before generators depend on it |
| Market Scope | Live, **DTO undocumented** — category/competitor-shaped, does not slot into the account fact grain. Treat as a distinct source, not another metric table. |

Market Scope is the most valuable and least understood surface here: it is the only one that can supply an external baseline before the internal benchmark cohort exists. That makes it the answer to cold-start (§11) — but only once its shape is documented.

---

## 4. Graph Architecture

Two entry graphs, one shared library.

### 4.1 Brief graph

```
                          ┌─────────────┐
   POST /v1/briefs ──────▶│  supervisor │  (checkpointed, resumable)
                          └──────┬──────┘
                                 ▼
                        ┌────────────────┐
                        │ 1. data_steward│  deterministic
                        │  MetricFrame   │  validate, normalize period
                        └────────┬───────┘
                                 ▼
                        ┌────────────────┐
                        │ 2. generator   │  deterministic, parallel
                        │    fan-out     │  G01–G08 + brief-specific
                        └────────┬───────┘
                                 ▼
                        ┌────────────────┐
                        │ 3. probe loop  │  ◀── AGENT + deterministic tools
                        │  analyst agent │      bounded, max N probes
                        └────────┬───────┘
                                 ▼
                        ┌────────────────┐
                        │ 4. materiality │  deterministic
                        │    + router    │
                        └────────┬───────┘
                                 ▼
             ┌───────────────────┼───────────────────┐
             ▼         ▼         ▼         ▼         │
          narrate   narrate   narrate   narrate      │  ◀── 4 AGENTS, parallel
            S2        S3        S4        S5         │      no tools
             └───────────────────┼───────────────────┘
                                 ▼
                        ┌────────────────┐
                        │  5. critic     │  ◀── AGENT, per section
                        └────────┬───────┘
                                 ▼
                        ┌────────────────┐
                        │ 6. numeral gate│  deterministic, hard
                        └────────┬───────┘
                                 ▼
                        ┌────────────────┐
                        │ 7. synthesist  │  ◀── AGENT: S6 then S1
                        └────────┬───────┘
                                 ▼
                        ┌────────────────┐
                        │ 8. interrupt() │  human review gate
                        └────────┬───────┘
                                 ▼
                            insight.brief
```

Brand context from the web intelligence agent (§5.5) is fetched from cache at step 1. It is never on the critical path — a stale or missing brand context degrades S1 tone, not correctness.

### 4.2 Onboarding graph

Fires on client TikTok account binding. Shares the generator library and the agent roster.

```
bind event → web_intel (async) ─┐
                                 ├─▶ synthesist ─▶ interrupt() ─▶ insight.brand_context
           → data_steward ───────┤                                 insight.diagnostic_index
           → generators ─────────┤
           → benchmark_gate ─────┘   (deterministic, k-anon + DP)
```

Same doctrine: the benchmark gate is deterministic code, never an agent. The index uses archetype-weighted dimension composites from documented presets, never model-generated weights.

---

## 5. Agent Roster

Every agent: typed input, typed output, explicit tool allowlist, bounded step count.

### 5.1 Supervisor
**Tools:** none. **Role:** routing, retry policy, fallback, interrupt handling.
Not an LLM. A LangGraph control-flow node. Named here because people expect a "supervisor agent" and it should be clear this one holds no model.

### 5.2 Analyst (probe loop) — the agentic centre
**In:** `Finding[]` from the generator fan-out, `ObjectiveContract`
**Out:** `ProbeRequest[]` → executed → additional `Finding[]`
**Tools:** allowlisted deterministic instruments only, each with a typed signature:

```
concentration(level, metric, axis)
efficiency_outliers(level, metric, cohort, min_volume)
decompose(identity_chain, level, period_a, period_b)
segment_contrast(dimension_a, dimension_b, metric)
marginal_return(entity_level, window)
cohort_slice(dimension, value)
```

**Bounds:** max 6 probes per run, max 2 sequential rounds, hard timeout. Every probe result is *computed*, never asserted. The agent may not see raw rows — only finding objects and instrument outputs.

This is where depth comes from. A fixed generator battery asks the same twelve questions every week. The analyst notices that concentration is high on campaign and asks for it on creator too; notices a decomposition attributing a delta to AOV and asks for mix-shift within the top SKU. That is the difference between a report and an analysis.

**Failure mode to watch:** probe thrash — the agent requesting cuts that return nothing, burning budget. Log probe yield rate (findings produced per probe). If it drops below ~0.4, the instrument set is wrong or the prompt is under-specified.

### 5.3 Narrators (×4, parallel)
**In:** `SectionPayload` (3–5 ranked findings, contract, schema, few-shot)
**Out:** `SectionDraft` (structured)
**Tools:** none. Thinking mode off. One agent per section S2–S5.

### 5.4 Critic
**In:** `SectionDraft` + the findings behind it
**Out:** `SectionDraft` (revised) + rubric verdicts
**Tools:** none. Thinking mode on. Fixed rubric:
- Does every claim reference a `finding.id`?
- Is any sentence true of *any* brand in this vertical? → rewrite
- Does any number appear that is not in `evidence`? → delete
- Is the action executable tomorrow without asking a question?

Separate agent, not a second turn of the narrator. The role separation is the point — a model critiquing its own draft in the same context defends it.

### 5.5 Web Intelligence
**In:** client identity, category
**Out:** `BrandContext` artifact (versioned, cached, TTL)
**Tools:** whitelisted search + fetch domains only.
Runs async, off the critical path. Ships last — the highest-uncertainty component (§11).

### 5.6 Synthesist
**In:** accepted S2–S5 drafts, all findings, `BrandContext`, coverage audit
**Out:** S6 (risk, actions, bounded outlook) then S1 (executive summary)
**Tools:** none. Thinking mode on. Richest few-shot allocation.

**S1 is written last.** A summary written first has nothing to summarize and defaults to platitude — a likely contributor to current output quality.

---

## 6. Deterministic Layer

### 6.1 The Finding contract

```python
class Finding(BaseModel):
    id: str
    generator: str
    brief_type: Literal["awareness", "gmv", "install"]
    section_affinity: list[int]
    entity: EntityRef
    level: Literal["campaign","adgroup","creative","product","creator","session"]
    claim_frame: ClaimFrame            # closed enum
    evidence: dict[str, float | int | str]
    comparison: Comparison | None
    magnitude_pct: float               # share of primary outcome affected
    direction: Literal["positive","negative","neutral"]
    actionability: Literal["high","medium","low"]
    confidence: Literal["high","medium","low"]
    caveats: list[str]
    materiality: float
    provenance: list[str]
    origin: Literal["generator","probe"]
```

`claim_frame` is a closed enum. **New analytical claim = new generator + new frame. Never a prompt edit.**

### 6.2 Objective contracts

| | **Awareness** | **GMV** | **Install** |
|---|---|---|---|
| Primary outcome | Qualified Reach | GMV | Activated Installs |
| Efficiency metric | CPM / Cost per Qualified Reach | ROI | CPI / Cost per Activation |
| Identity chain | `Impr = Reach × Freq`<br>`QReach = Reach × VTR_c` | `GMV = Orders × AOV`<br>`Orders = Clicks × CVR` | `Installs = Clicks × IR`<br>`Activations = Installs × ActRate` |
| Entity axes | placement, audience, creative, format, daypart | campaign type, product, creator, live session, adgroup | channel, campaign, creative, device, OS, geo |
| Additivity trap | **reach non-additive** (§3.1) | ROI is a ratio, never averaged | CPI is a ratio, never averaged |
| Waste rule | frequency above cap; spend at VTR ≈ 0 | spend with 0 orders; live sessions at 0 conversion | installs with 0 activation; anomalous CTR/IR clusters |

Metrics are declared `required` / `preferred` / `optional`. Generators needing absent metrics **skip silently and register a coverage gap**, which feeds S6 confidence.

### 6.3 Generator catalogue

**Shared, parameterized by contract:**

| ID | Name | Method |
|---|---|---|
| G07 | Comparability Normalizer | **Runs first.** Unequal active days/hours; per-active-unit recompute; flag sign flips. Source of the "-21% but only 4 active days" insight. |
| G01 | Identity Decomposition | **LMDI** (Log-Mean Divisia Index). Exact, additive delta attribution. Single level only. Highest-value generator. |
| G02 | Efficiency Outlier | Robust z (median + MAD), both tails, volume floor |
| G03 | Concentration & Dependency | Top-N share, HHI, Gini per axis. Flag at HHI > 0.25 or top-1 > 40%. Never across levels. |
| G04 | Zero-Yield & Waste | Rule table per objective |
| G05 | Marginal Return / Saturation | Δoutcome/Δspend vs. account average; log fit at ≥ 4 periods. Scale-up >1.3×, scale-down <0.6×. |
| G06 | Segment Contrast | Standardized effect size, **FDR-corrected** |
| G08 | Coverage & Confidence Audit | Null rates, entity coverage, recency lag |

**Awareness:** A01 frequency distribution & effective reach · A02 retention curve (hook vs hold) · A03 incremental reach efficiency · A04 placement overlap proxy (*the one place reach non-additivity is the signal, not the trap*)

**GMV:** M01 live session efficiency · M02 AOV & mix shift · M03 creator/affiliate ladder · M04 SKU lifecycle contribution

**Install:** N01 funnel leak localization · N02 cohort quality · N03 CPI vs payback proxy · N04 install anomaly (*flagged, not asserted*)

### 6.4 Advanced statistical layer (v1.1, once ≥ 12 periods exist)

The stack you already specified, gated on data depth rather than built speculatively: mutual information matrices, XGBoost with SHAP interaction values for driver attribution, Granger causality for lead/lag between spend and outcome, PCA composites for the diagnostic index. Each emits `Finding` objects like any generator. **Do not build these before B7** — they are noise on seven days of data and will manufacture confident nonsense.

### 6.5 Materiality

```
materiality = sqrt(magnitude_pct) × actionability_weight × confidence_weight
```

Documented presets per archetype, never model-generated. Per section: rank by `section_affinity`, enforce generator diversity (max 2 per generator), pass **top 3–5**. Persist the full ranked list **including everything below the cut** — when Johnson promotes a rank-8 finding at review, that is the signal the presets are wrong, but only if the discards were recorded.

---

## 7. Model & Serving

| Setting | Value |
|---|---|
| Model | **Gemma 4 12B QAT** (dense) |
| Server | **LM Studio**, `http://localhost:1234/v1`, OpenAI-compatible |
| Context | 32K per slot; per-call payload under ~8K |
| Parallel slots | 4–5 — concurrent KV cache is the binding constraint, not single-call length |
| Structured output | `response_format` JSON schema per section per confidence tier |
| Thinking mode | On: analyst, critic, synthesist. Off: narrators. |
| Temperature | 0.3 narration / 0.1 critique / 0.2 analyst |
| Output language | **Bahasa Indonesia** (code and logs English) |

### 7.1 Why 12B dense over 26B-A4B

Active params drive synthesis quality; total params drive recall. 26B-A4B activates ~4B against the dense 12B's 12B, and this pipeline consumes almost no world knowledge — findings arrive pre-computed.

Throughput settles it. ~24 calls per brief with the probe loop and critic, ~20K generated tokens including reasoning:

| | tok/s | Est. per brief | Slots on 16GB |
|---|---|---|---|
| 12B dense Q4 (~7GB) | ~74–80 @ 32K | ~4.3 min | 4–6 |
| 26B-A4B Q4 (~14–15GB) | ~34–40 @ 16K | ~9 min | 1–2 |

The 26B breaches the target before a single retry, and **the retry budget is the quality mechanism** — the critic is what strips filler; at half throughput it gets trimmed to hit latency. Speed protects quality here.

**Open, resolve empirically:** A/B the 26B on synthesist calls only, in the eval harness. Prior is it will not win enough to justify the swap. That is a prior, not a finding.

---

## 8. Gates

| Gate | Type | Behaviour |
|---|---|---|
| Schema | deterministic | Section must parse under its response schema |
| **Numeral** | deterministic, hard | Every numeral in output must exist in the routed findings' `evidence`, plus permitted derivations (rounding, percent, ID thousand-separators). Orphan → regenerate, max 2, then flag. |
| Metric support | deterministic | No value presented for a metric the source cannot support |
| Level integrity | deterministic | No finding mixes levels; no reach summation |
| Ratio integrity | deterministic | No averaged ratio anywhere in the payload |
| Confidence tier | schema-enforced | `low` tier **removes the `implication` field entirely** and restricts vocabulary enums |
| Fallback | deterministic | Any hard failure → deterministic writer, stated in the footer. **The brief always renders.** |

Confidence ladder: **High** ≥ 4 comparable periods and coverage ≥ 95% → direct claims. **Medium** 2–3 periods, coverage ≥ 80% → explicit period caveat. **Low** 1 period or coverage < 80% → descriptive only, no trend or causal language.

Do not ask a prompt to enforce epistemic humility. Enforce it structurally.

---

## 9. Privacy & Multi-Tenancy

- Single-tenant per run. `tenant_id` bound at the API boundary, carried in every typed payload, asserted at every graph node.
- Engine holds `SELECT`-only on `tempo.*`.
- `BenchmarkProvider` returns `None` in v1. When wired: k-anonymity threshold and differential privacy noise are **deterministic code, never an agent**.
- Web intelligence agent has a domain whitelist. It never receives client performance data — only public identity and category.
- LLM gateway logs prompts with entity display names tokenized; re-hydration is local.

### 9.1 Governance items — decisions, not build tasks

| # | Item | Action |
|---|---|---|
| GOV-1 | Tempo repo is public, contains a real client slug and a dashboard screenshot | Make private, **audit git history** — removal from HEAD is not removal from history |
| GOV-2 | Narrative provider defaults to `anthropic` when `ANTHROPIC_API_KEY` is present | Invert. Fail closed to local; frontier routing becomes explicit per-tenant opt-in |
| GOV-3 | Tempo tenant isolation lands with auth in Phase 2 | Engine binds `tenant_id` at its own boundary regardless — do not inherit the gap |
| GOV-4 | Frontier escalation for synthesist calls | Pseudonymized findings only, names re-hydrated locally. Blocked until GOV-1 and GOV-2 close. |

---

## 10. Human Review Gate

LangGraph `interrupt()` at step 8. State persists in the Postgres checkpointer; `POST /v1/briefs/{id}/review` resumes.

Reviewer sees: the rendered brief, the findings behind each section, everything below the cut, and the probe trace (which questions the analyst asked and what came back).

Edits are logged as the tuning signal for materiality presets, claim-frame vocabulary, and the gold set. **Target edit distance under 15% by month 2. If it is not trending down, the pipeline is not learning** — most likely the presets, second most likely a claim-frame vocabulary too narrow for what the data contains.

---

## 11. Honest Failure Risks

Ranked by severity.

1. **Probe loop thrash or drift.** The analyst is the highest-variance component and the one that can silently degrade into requesting useless cuts. *Mitigation:* hard bounds (6 probes, 2 rounds), probe-yield logging, and a kill switch — the pipeline must produce an acceptable brief with the probe loop disabled. Build it that way; ship it on once yield is measured.
2. **A 12B is not a frontier reasoner.** S1 and S6 are the weakest output in every brief. *Mitigation:* thinking mode, richest few-shot, hardest human review, targeted 26B A/B.
3. **Additivity traps (§3.1) produce confident wrong numbers.** Highest-probability *correctness* failure, invisible at review because output looks authoritative. *Mitigation:* `level` required on every Finding; property tests; reach summation is a build failure.
4. **Cold start.** One week of one account has a hard ceiling; the benchmark cohort does not exist yet. *Mitigation:* confidence ladder makes the ceiling explicit; **Market Scope is the near-term answer** (§3.3) — an external baseline available before cohort depth.
5. **Web intelligence agent fragility.** A 12B synthesizing brand facts from open web will confabulate. *Mitigation:* domain whitelist, ships last, and its output affects tone not correctness. If it cannot be made reliable, cut it — the engine works without it.
6. **Materiality presets are guesses initially.** *Mitigation:* below-the-cut logging plus review diffs give an empirical loop in weeks.

**Standing framing:** floor-raising throughput, not a strategic ceiling. This will match frontier output on diagnostic reporting. It will not replace a senior strategist connecting creative theme to audience psychographic to margin structure. A good pipeline is not a licence to overclaim externally — and the probe loop, which will look impressive in demos, does not change this.

---

## 12. Build Order

| Milestone | Contents | Exit criteria |
|---|---|---|
| **B0** | GOV-1, GOV-2 closed. Engine repo, read-only Postgres role, `insight.*` schema, metric-catalog port + drift check. | Engine reads a real client's read-models; write attempt to `tempo.*` fails |
| **B1** | Contracts: `Finding`, `ObjectiveContract`, `MetricFrame`, `SectionSpec`. Sovella fixtures. | Types validate against real read-model output. **Show contracts before proceeding.** |
| **B2** | G07 → G01 → G02 → G03 → G04 → G06 → G08, GMV only | G01 reproduces the reference report's decomposition; property test: no cross-level sums, no averaged ratios |
| **B3** | Materiality + section router | Top-5 selection matches the Sovella report's insights in ≥ 4 of 6 sections |
| **B4** | Narrators + numeral gate + schemas + fallback path | 100% numeral fidelity over 20 runs; fallback < 5% |
| **B5** | Critic + synthesist + Indonesian gold set + LangGraph checkpointer and `interrupt()` | Blind-preferred over current Tempo output |
| **B6** | Review UI wiring in Tempo (reads `insight.*`) | Johnson approves a real client brief end to end |
| **B7** | **Probe loop.** Instruments, bounds, yield logging, kill switch. | Measurable depth gain vs. B5 on the gold set, probe yield ≥ 0.4 |
| **B8** | G05 marginal return | Scale-up/scale-down findings in S3/S6 |
| **B9** | Awareness contract + A01–A04, reach non-additivity explicit | Depth parity; A04 validated against deduped rollups |
| **B10** | Install contract + N01–N04 | Depth parity |
| **B11** | Shop + Market Scope DTO contracts; Market Scope as cold-start baseline | Generators may depend on them |
| **B12** | Onboarding graph | Brand context + diagnostic index produced at bind, human-approved |
| **B13** | Web intelligence agent | Ships last, by design |
| **B14** | Benchmark layer (k-anon + DP), advanced statistical layer | Gated on GOV-3 and ≥ 12 periods |

The order is deliberate: **the probe loop ships after a working non-agentic pipeline exists.** You need a baseline to prove the agentic layer earns its variance. Building it first makes that unprovable.

---

## 13. Eval Harness

CI on every PR.

1. **Numeral fidelity** — 100%, hard fail
2. **Level integrity** — no cross-level sums, no reach summation
3. **Ratio integrity** — no averaged ratios
4. **Finding coverage** — brief references ≥ 90% of top-10 materiality findings
5. **Determinism** — same input → identical findings and ranking (generators only; agents are sampled)
6. **Probe yield** — findings per probe ≥ 0.4; regression alarm
7. **Generic-sentence detector** — heuristic + LLM judge; fail above 5%
8. **Schema conformance** — every section parses
9. **Metric-catalog drift** — engine port matches `@tempo/core` `METRICS`
10. **Regression corpus** — Sovella week + 3 synthetic accounts per brief type, top findings pinned

Tests 2 and 3 exist because §3.1 failures pass human review. Write them first.

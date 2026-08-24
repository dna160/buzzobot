# Phased delivery

Tempo Insight Engine is built in deliberately scoped phases. Each phase ends
with a **handover document** that captures what exists, what contracts the next
phase can rely on, and what is intentionally deferred — so work can resume
without re-reading the entire codebase and without re-deriving decisions.

| Phase | Title                        | Status      | Handover                              |
| ----- | ---------------------------- | ----------- | ------------------------------------- |
| 0     | Foundation & domain kernel   | ✅ Complete | [PHASE_0_FOUNDATION.md](./PHASE_0_FOUNDATION.md) |
| 1     | Vertical slice — client dashboard | ✅ Complete | [PHASE_1_VERTICAL_SLICE.md](./PHASE_1_VERTICAL_SLICE.md) |
| 1.5   | Client PDF reports           | ✅ Complete | [PHASE_1_5_PDF_REPORTS.md](./PHASE_1_5_PDF_REPORTS.md) |
| 2     | Multi-tenant SaaS & live sync | ⏭ Planned  | (TBD)                                 |

Work that spans both this repo and `tempo-engine/` is tracked as its own program rather
than a numbered phase:

| Program | Scope | Plan |
| ------- | ----- | ---- |
| Brief Deck | One 16:9 client deck replacing the daily/hourly/A4 reports, every claim a `Finding` | [brief-deck/](./brief-deck/README.md) |

## How to read a handover

Each handover answers four questions:

1. **What shipped** — the concrete artifacts (packages, modules, endpoints).
2. **Contracts** — the stable interfaces the next phase builds on.
3. **How to run / verify** — commands to reproduce the working state.
4. **Deferred** — what was consciously left out and why, so it isn't mistaken
   for an oversight.

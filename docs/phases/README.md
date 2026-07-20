# Phased delivery

Tempo Insight Engine is built in deliberately scoped phases. Each phase ends
with a **handover document** that captures what exists, what contracts the next
phase can rely on, and what is intentionally deferred — so work can resume
without re-reading the entire codebase and without re-deriving decisions.

| Phase | Title                        | Status      | Handover                              |
| ----- | ---------------------------- | ----------- | ------------------------------------- |
| 0     | Foundation & domain kernel   | ✅ Complete | [PHASE_0_FOUNDATION.md](./PHASE_0_FOUNDATION.md) |
| 1     | Vertical slice — client dashboard | 🚧 In progress | [PHASE_1_VERTICAL_SLICE.md](./PHASE_1_VERTICAL_SLICE.md) |
| 2     | Multi-tenant SaaS & live sync | ⏭ Planned  | (TBD)                                 |

## How to read a handover

Each handover answers four questions:

1. **What shipped** — the concrete artifacts (packages, modules, endpoints).
2. **Contracts** — the stable interfaces the next phase builds on.
3. **How to run / verify** — commands to reproduce the working state.
4. **Deferred** — what was consciously left out and why, so it isn't mistaken
   for an oversight.

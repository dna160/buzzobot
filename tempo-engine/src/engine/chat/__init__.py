"""Tempo Chat (C1) — the per-client analyst chatbot that lives in the engine.

Founding rule (PRD §1, inherited from `docs/PRD_tempo_intelligence_engine.md`
§2): an agent may choose *what question to ask of the data; only code may
answer it*. So the model never writes SQL and never computes a number — it
calls the typed, read-only, scope-bound tools in `tools.py`, each returning
pre-computed, pre-formatted facts, and every numeral in its reply is checked by
`gate.py` against exactly those facts.

The client is bound by the server (`scope.py`), never by the model: no tool
takes a client argument, and an injected one is dropped (`extra="ignore"`). All
model calls happen here in tempo-engine; the web app only relays (PRD §6.2,
rules R1–R8). `allowed_tools(principal, scope)` is the single authorisation
point C2 will fill in (PRD §10); C1 records the principal and allows everything.
"""

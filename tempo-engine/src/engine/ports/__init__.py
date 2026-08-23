"""Ports: the engine's only sanctioned contact with Tempo — a versioned
metric-catalog mirror and read-only Postgres access. Nothing in `generators`,
`agents`, or `graphs` imports asyncpg or touches Tempo directly; everything
goes through here.
"""

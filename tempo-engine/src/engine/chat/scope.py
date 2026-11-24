"""Who is asking (`Principal`), what they are asking about (`ChatScope`), and
the one function that decides which tools a turn may use (`allowed_tools`).

This module is the C2 seam (PRD §10). C1 records identity on every turn but
acts on none of it; C2 changes exactly `allowed_tools` and the identity the
principal carries, never the tool loop. The scope is resolved by the server
from the URL's slug, so the model is never offered a client choice (PRD §6.2
R3, §10.3) — it only ever sees `ChatScope`, never a tenant or agency argument.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

PrincipalKind = Literal["same-origin", "api-key", "unknown"]
_KINDS: frozenset[str] = frozenset(("same-origin", "api-key", "unknown"))


@dataclass(frozen=True)
class Principal:
    """The authenticated caller, forwarded from the web route's `Caller`
    (`apps/web/src/lib/api-auth.ts`). `key_id` is the key's fingerprint, never
    the key. `user_id`/`role`/`organization_id` stay `None` in C1 (the app has
    no user accounts yet, `api-auth.ts:70`); C2 fills them in and
    `allowed_tools` begins to read them."""

    kind: PrincipalKind = "unknown"
    key_id: str | None = None
    user_id: str | None = None
    role: str | None = None
    organization_id: str | None = None

    @classmethod
    def from_payload(cls, raw: dict | None) -> Principal:
        raw = raw or {}
        kind = raw.get("kind")
        return cls(
            kind=kind if kind in _KINDS else "unknown",  # type: ignore[arg-type]
            key_id=_opt_str(raw.get("key_id")),
            user_id=_opt_str(raw.get("user_id")),
            role=_opt_str(raw.get("role")),
            organization_id=_opt_str(raw.get("organization_id")),
        )

    def to_json(self) -> dict:
        return {
            "kind": self.kind,
            "key_id": self.key_id,
            "user_id": self.user_id,
            "role": self.role,
            "organization_id": self.organization_id,
        }


def _opt_str(v: object) -> str | None:
    return v if isinstance(v, str) and v else None


@dataclass(frozen=True)
class ChatScope:
    """The one client a conversation is about (PRD §5.1, D3). Resolved
    server-side from the slug; `tenant_id` (the client's `clients.id`) and
    `agency_id` are kept so C2 can resolve by id, not slug alone — slugs are
    unique only per agency (PRD §15 #5, schema.ts `clients_agency_slug_uq`)."""

    client_slug: str
    tenant_id: str
    agency_id: str
    client_name: str
    north_star: str
    currency: str
    timezone: str


ALL_TOOLS: tuple[str, ...] = (
    "client_overview",
    "ads_performance",
    "campaign_breakdown",
    "market_scope_insights",
    "strategy_action_log",
)


def allowed_tools(principal: Principal, scope: ChatScope) -> tuple[str, ...]:
    """The single authorisation point (PRD §10.2, D8). C1 returns every tool
    for every caller, because the dashboard has no user accounts yet.

    C2 implements, *here and nowhere else*:
      - organisation check: `principal.organization_id` must own
        `scope.agency_id`, else the turn is refused before any model call;
      - a role → tools matrix (PRD §10.2): e.g. a brand viewer loses
        `campaign_breakdown`.
    The tools themselves never see the principal, so a role can never be
    argued out of the model — enforcement stays in code."""
    _ = (principal, scope)  # C2 reads these; C1 deliberately ignores them.
    return ALL_TOOLS

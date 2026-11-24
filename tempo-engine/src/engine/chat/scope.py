"""Who is asking (`Principal`), what they may see (`ChatWorkspace`), which
client a tool call resolved to (`ChatScope`), and the one function that decides
which tools a turn may use (`allowed_tools`).

Tanya Tempo is a general chat over the whole ads database, not a per-client
page. The model names a client as a tool argument (`client`, a name or slug),
and the server resolves it *inside the workspace* — so the workspace, never the
model, decides which clients are reachable. `TEMPO_SCOPE=super_admin` (C1's only
scope) is every client; C2 narrows the workspace from the principal (an agency,
a client list) here and nowhere else, without touching the tool loop.
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
class ChatWorkspace:
    """The clients a turn may read. `agency_ids=None` means every client in the
    data database (`super_admin`); a tuple restricts resolution and portfolio
    queries to those agencies. `timezone` dates the portfolio window (most
    clients are in Asia/Jakarta); a single client's tools use its own zone."""

    scope: str = "super_admin"
    agency_ids: tuple[str, ...] | None = None
    timezone: str = "Asia/Jakarta"
    #: Optional client the user is looking at in the UI — a hint for "this
    #: client", never a restriction.
    focus_slug: str | None = None


def workspace_for(principal: Principal, scope_name: str | None, *, focus_slug: str | None = None) -> ChatWorkspace:
    """The C2 seam for *which clients*. C1 knows one scope, `super_admin`
    (every client); anything else is refused rather than silently widened."""
    _ = principal  # C2 maps the principal's organisation/role to agencies here.
    name = (scope_name or "super_admin").strip().lower()
    if name != "super_admin":
        raise ValueError(f"unsupported TEMPO_SCOPE {scope_name!r} (C1 supports only 'super_admin')")
    return ChatWorkspace(scope=name, agency_ids=None, focus_slug=focus_slug or None)


@dataclass(frozen=True)
class ChatScope:
    """One client, resolved server-side from the model's `client` argument
    inside the workspace. `tenant_id` (the client's `clients.id`) and
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
    "find_clients",
    "portfolio_overview",
    "client_overview",
    "saved_reports",
    "improvement_diagnostics",
    "ads_performance",
    "campaign_breakdown",
    "market_scope_insights",
    "strategy_action_log",
)


def allowed_tools(principal: Principal, workspace: ChatWorkspace) -> tuple[str, ...]:
    """The single authorisation point (PRD §10.2, D8). C1 returns every tool
    for every caller, because the dashboard has no user accounts yet.

    C2 implements, *here and nowhere else*:
      - organisation check: the principal's organisation decides
        `workspace.agency_ids` (see `workspace_for`);
      - a role → tools matrix (PRD §10.2): e.g. a brand viewer loses
        `campaign_breakdown`.
    The tools themselves never see the principal, so a role can never be
    argued out of the model — enforcement stays in code."""
    _ = (principal, workspace)  # C2 reads these; C1 deliberately ignores them.
    return ALL_TOOLS

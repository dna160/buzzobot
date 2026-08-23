"""MetricFrame, Entity, Period — the validated input a brief run consumes.

Per PRD §4.1, this is what `data_steward` produces from `tempo_read` and
every downstream node (generator fan-out, probe loop, narrators) works from
— nothing past this point ever holds a raw connection to Tempo.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

BriefType = Literal["awareness", "gmv", "install"]


class EntityLevel(str, Enum):
    """The granularity a `MetricRecord` is reported at. Broader than
    `finding.FindingLevel` — a `MetricFrame` legitimately carries an
    account-level rollup row (needed by G01/G07/G08) even though a `Finding`
    about a single entity uses the narrower, PRD §6.1-defined level set.
    """

    ACCOUNT = "account"
    CAMPAIGN = "campaign"
    AD_GROUP = "adgroup"
    AD = "ad"
    CREATIVE = "creative"
    PRODUCT = "product"
    CREATOR = "creator"
    SESSION = "session"
    PLACEMENT = "placement"
    AUDIENCE = "audience"
    FORMAT = "format"
    CHANNEL = "channel"
    GEO = "geo"
    DEVICE = "device"
    OS = "os"
    DAYPART = "daypart"


class Entity(BaseModel):
    """A named thing a `MetricRecord` is about."""

    model_config = ConfigDict(frozen=True)

    level: EntityLevel
    id: str
    display_name: str


class Period(BaseModel):
    """One comparison window.

    `active_days` (count of days with recorded activity) is distinct from
    the calendar span — the gap between them is exactly what G07
    Comparability Normalizer exists to catch (PRD's "-21% but only 4 active
    days" example).
    """

    model_config = ConfigDict(frozen=True)

    start_date: date
    end_date: date
    active_days: int = Field(ge=0)
    label: str | None = None

    @model_validator(mode="after")
    def _check_range(self) -> Period:
        if self.end_date < self.start_date:
            raise ValueError("end_date must not precede start_date")
        calendar_days = (self.end_date - self.start_date).days + 1
        if self.active_days > calendar_days:
            raise ValueError(
                f"active_days ({self.active_days}) exceeds the calendar span "
                f"({calendar_days} days between {self.start_date} and {self.end_date})"
            )
        return self


class MetricRecord(BaseModel):
    """One entity's metrics for one period.

    Per PRD §3.1: a campaign-level record (rolled up from `adgroup_id IS
    NULL` rows) and an adgroup-level record for one of its own adgroups are
    PARALLEL decompositions of the same activity — a generator must never
    sum an entity's adgroup-level records together and treat the result as
    equivalent to its campaign-level record (reach in particular will not
    match; other metrics might coincidentally match and mask the bug).
    Nothing in this type enforces that by itself — it is enforced by
    property tests over what generators actually do (B2 exit criteria) —
    but the fact that campaign and adgroup records live in the same flat
    `MetricFrame.records` list, distinguished only by `entity.level`, is
    precisely why the rule has to be tested, not assumed.
    """

    model_config = ConfigDict(frozen=True)

    entity: Entity
    period: Period
    metrics: dict[str, float] = Field(default_factory=dict)
    dimensions: dict[str, str] = Field(default_factory=dict)


class MetricFrame(BaseModel):
    """The complete, validated input to one brief run. `tenant_id` is bound
    here at the boundary and re-carried on every `Finding` and
    `SectionPayload` downstream (Hard Rule 6)."""

    model_config = ConfigDict(frozen=True)

    tenant_id: str
    brief_type: BriefType
    current_period: Period
    prior_period: Period | None
    records: list[MetricRecord]
    currency: str
    timezone: str
    generated_at: datetime

    def records_for(self, period_label: Literal["current", "prior"]) -> list[MetricRecord]:
        target = self.current_period if period_label == "current" else self.prior_period
        if target is None:
            return []
        return [r for r in self.records if r.period == target]

"""Install-specific generators (PRD §6.3, B10)."""

from __future__ import annotations

from engine.generators.base import Generator
from engine.generators.install.n01_funnel_leak import N01FunnelLeak
from engine.generators.install.n02_cohort_quality import N02CohortQuality
from engine.generators.install.n03_cpi_payback_proxy import N03CpiPaybackProxy
from engine.generators.install.n04_install_anomaly import N04InstallAnomaly

INSTALL_GENERATORS: tuple[Generator, ...] = (
    N01FunnelLeak(),
    N02CohortQuality(),
    N03CpiPaybackProxy(),
    N04InstallAnomaly(),
)

__all__ = ["INSTALL_GENERATORS", "N01FunnelLeak", "N02CohortQuality", "N03CpiPaybackProxy", "N04InstallAnomaly"]

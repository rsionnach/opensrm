# Phase 3: Mayday Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Mayday — the multi-agent incident response system that consumes SitRep correlation verdicts and produces triage/investigation/communication/remediation verdicts with full lineage.

**Architecture:** Deterministic coordinator (state machine) sequences four agents via an AgentBase ABC. Transport (coordinator, verdict emission, model calls) is code; judgment (prompts, response parsing) is model. Crash recovery via SQLite-persisted IncidentContext. Shared `verdicts.db` with SitRep and Arbiter for lineage.

**Tech Stack:** Python 3.11+, setuptools, pytest, pytest-asyncio, structlog, PyYAML, anthropic SDK, verdict library (path-based dep), SQLite WAL mode.

**Spec:** `opensrm/docs/superpowers/specs/2026-03-19-phase-3-mayday-implementation-design.md`

---

## File Structure

```
mayday/
├── pyproject.toml                        # Project config, deps, entry point
├── src/mayday/
│   ├── __init__.py                       # Minimal — version only
│   ├── __main__.py                       # python -m mayday entry point
│   ├── types.py                          # IncidentContext, IncidentState, AgentRole, result dataclasses
│   ├── config.py                         # MaydayConfig from mayday.yaml
│   ├── context_store.py                  # ContextStore Protocol + SQLiteContextStore
│   ├── coordinator.py                    # Coordinator state machine — pipeline sequencing, crash recovery
│   ├── agents/
│   │   ├── __init__.py                   # empty
│   │   ├── base.py                       # AgentBase ABC — template method, verdict emission, model calls
│   │   ├── triage.py                     # TriageAgent
│   │   ├── investigation.py              # InvestigationAgent
│   │   ├── communication.py              # CommunicationAgent
│   │   └── remediation.py                # RemediationAgent
│   ├── safe_actions/
│   │   ├── __init__.py                   # empty
│   │   ├── registry.py                   # SafeAction, SafeActionRegistry
│   │   └── actions.py                    # Built-in actions: rollback, scale_up, etc.
│   └── cli.py                            # CLI: serve, status, replay, approve, reject, resume
├── tests/
│   ├── conftest.py                       # Shared fixtures
│   ├── test_types.py                     # Type construction and validation
│   ├── test_context_store.py             # SQLite persistence
│   ├── test_agent_base.py                # Template method, verdict emission, degraded mode
│   ├── test_triage.py                    # Triage prompt/parse
│   ├── test_investigation.py             # Investigation prompt/parse
│   ├── test_communication.py             # Communication prompt/parse (both phases)
│   ├── test_remediation.py               # Remediation prompt/parse, safe action validation
│   ├── test_safe_actions.py              # Registry, cooldown, blast radius
│   ├── test_coordinator.py               # Pipeline sequencing, crash recovery, escalation
│   ├── test_replay.py                    # CLI replay command
│   └── test_cli.py                       # Other CLI commands
└── scenarios/synthetic/                   # 8 scenario YAML files
```

---

## Task 1: Project Scaffold + Types

**Files:**
- Create: `mayday/pyproject.toml`
- Create: `mayday/src/mayday/__init__.py`
- Create: `mayday/src/mayday/__main__.py`
- Create: `mayday/src/mayday/types.py`
- Create: `mayday/tests/conftest.py`
- Create: `mayday/tests/test_types.py`

This task establishes the project skeleton and all core dataclasses. Every subsequent task imports from `types.py`.

- [ ] **Step 1: Create pyproject.toml**

```toml
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "mayday"
version = "0.1.0a1"
description = "Mayday — Multi-agent incident response for the OpenSRM ecosystem"
requires-python = ">=3.11"
license = {text = "Apache-2.0"}
dependencies = [
    "pyyaml>=6.0.1",
    "structlog>=24.1",
    "anthropic>=0.39",
    "verdict @ file:///../nthlayer-learn/lib/python",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
]

[project.scripts]
mayday = "mayday.cli:main"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **Step 2: Create `__init__.py` and `__main__.py`**

```python
# src/mayday/__init__.py
"""Mayday — Multi-agent incident response."""
__version__ = "0.1.0a1"
```

```python
# src/mayday/__main__.py
"""Entry point for python -m mayday."""
from mayday.cli import main

main()
```

- [ ] **Step 3: Write failing tests for types**

```python
# tests/test_types.py
"""Tests for core Mayday types."""
from mayday.types import (
    AgentRole,
    CommunicationResult,
    CommunicationUpdate,
    Hypothesis,
    IncidentContext,
    IncidentState,
    InvestigationResult,
    RemediationResult,
    TriageResult,
)


def test_incident_state_values():
    assert IncidentState.TRIGGERED == "triggered"
    assert IncidentState.AWAITING_APPROVAL == "awaiting_approval"
    assert IncidentState.ESCALATED == "escalated"
    assert IncidentState.FAILED == "failed"


def test_incident_state_terminal():
    terminal = {IncidentState.RESOLVED, IncidentState.ESCALATED, IncidentState.FAILED}
    non_terminal = {
        IncidentState.TRIGGERED,
        IncidentState.TRIAGING,
        IncidentState.INVESTIGATING,
        IncidentState.REMEDIATING,
        IncidentState.AWAITING_APPROVAL,
    }
    assert terminal & non_terminal == set()


def test_agent_role_values():
    assert AgentRole.TRIAGE == "triage"
    assert AgentRole.INVESTIGATION == "investigation"
    assert AgentRole.COMMUNICATION == "communication"
    assert AgentRole.REMEDIATION == "remediation"


def test_triage_result():
    result = TriageResult(
        severity=1,
        blast_radius=["payment-api", "checkout-service"],
        affected_slos=["availability"],
        assigned_team="payments-oncall",
        reasoning="High severity due to cascading failure",
    )
    assert result.severity == 1
    assert len(result.blast_radius) == 2


def test_hypothesis():
    h = Hypothesis(
        description="Deploy removed connection pooling",
        confidence=0.87,
        evidence=["latency spike 12m after deploy"],
        change_candidate="payment-api deploy v2.3.1",
    )
    assert h.confidence == 0.87
    assert h.change_candidate is not None


def test_investigation_result():
    result = InvestigationResult(
        hypotheses=[],
        root_cause=None,
        root_cause_confidence=0.0,
        reasoning="Insufficient evidence",
    )
    assert result.root_cause is None


def test_communication_update():
    update = CommunicationUpdate(
        channel="slack",
        timestamp="2026-03-19T10:00:00Z",
        update_type="initial",
        content="We are investigating a payment-api issue.",
    )
    assert update.update_type == "initial"


def test_communication_result_defaults():
    result = CommunicationResult()
    assert result.updates_sent == []
    assert result.reasoning == ""


def test_remediation_result_defaults():
    result = RemediationResult()
    assert result.proposed_action is None
    assert result.requires_human_approval is True
    assert result.executed is False
    assert result.autonomy_reduced is False


def test_incident_context_minimal():
    ctx = IncidentContext(
        id="INC-2026-0001",
        state=IncidentState.TRIGGERED,
        created_at="2026-03-19T10:00:00Z",
        updated_at="2026-03-19T10:00:00Z",
        trigger_source="sitrep",
        trigger_verdict_ids=["vrd-2026-03-19-abc12345-00001"],
        topology={},
    )
    assert ctx.triage is None
    assert ctx.verdict_chain == []
    assert ctx.last_completed_step_index is None
    assert ctx.error is None


def test_incident_context_with_results():
    ctx = IncidentContext(
        id="INC-2026-0001",
        state=IncidentState.INVESTIGATING,
        created_at="2026-03-19T10:00:00Z",
        updated_at="2026-03-19T10:05:00Z",
        trigger_source="sitrep",
        trigger_verdict_ids=[],
        topology={},
        triage=TriageResult(
            severity=1,
            blast_radius=["payment-api"],
            affected_slos=["availability"],
            assigned_team="payments",
            reasoning="test",
        ),
        verdict_chain=["vrd-001", "vrd-002"],
        last_completed_step_index=0,
    )
    assert ctx.triage is not None
    assert ctx.last_completed_step_index == 0
    assert len(ctx.verdict_chain) == 2
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-respond && uv run pytest tests/test_types.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mayday'`

- [ ] **Step 5: Implement types.py**

```python
# src/mayday/types.py
"""Core data types for Mayday."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class IncidentState(str, Enum):
    TRIGGERED = "triggered"
    TRIAGING = "triaging"
    INVESTIGATING = "investigating"
    REMEDIATING = "remediating"
    AWAITING_APPROVAL = "awaiting_approval"
    RESOLVED = "resolved"
    ESCALATED = "escalated"
    FAILED = "failed"


TERMINAL_STATES = frozenset({
    IncidentState.RESOLVED,
    IncidentState.ESCALATED,
    IncidentState.FAILED,
})


class AgentRole(str, Enum):
    TRIAGE = "triage"
    INVESTIGATION = "investigation"
    COMMUNICATION = "communication"
    REMEDIATION = "remediation"


@dataclass
class TriageResult:
    severity: int  # 0-4 (P0-P4)
    blast_radius: list[str]
    affected_slos: list[str]
    assigned_team: str | None
    reasoning: str


@dataclass
class Hypothesis:
    description: str
    confidence: float  # 0.0-1.0
    evidence: list[str]
    change_candidate: str | None


@dataclass
class InvestigationResult:
    hypotheses: list[Hypothesis]
    root_cause: str | None
    root_cause_confidence: float
    reasoning: str


@dataclass
class CommunicationUpdate:
    channel: str
    timestamp: str  # ISO 8601
    update_type: str  # "initial" or "resolution"
    content: str


@dataclass
class CommunicationResult:
    updates_sent: list[CommunicationUpdate] = field(default_factory=list)
    reasoning: str = ""


@dataclass
class RemediationResult:
    proposed_action: str | None = None
    target: str | None = None
    risk_assessment: str = ""
    requires_human_approval: bool = True
    executed: bool = False
    execution_result: str | None = None
    autonomy_reduced: bool = False
    autonomy_target: str | None = None
    previous_autonomy_level: str | None = None
    new_autonomy_level: str | None = None
    reasoning: str = ""


@dataclass
class IncidentContext:
    id: str  # INC-YYYY-NNNN
    state: IncidentState
    created_at: str  # ISO 8601
    updated_at: str
    trigger_source: str  # "sitrep", "pagerduty", "manual"
    trigger_verdict_ids: list[str]
    topology: dict
    triage: TriageResult | None = None
    investigation: InvestigationResult | None = None
    communication: CommunicationResult | None = None
    remediation: RemediationResult | None = None
    verdict_chain: list[str] = field(default_factory=list)
    last_completed_step_index: int | None = None  # pipeline step 0-3
    error: str | None = None
    metadata: dict = field(default_factory=dict)
```

- [ ] **Step 6: Create conftest.py with shared fixtures**

```python
# tests/conftest.py
"""Shared test fixtures for Mayday."""
from __future__ import annotations

import pytest
from verdict import MemoryStore

from mayday.types import IncidentContext, IncidentState


@pytest.fixture
def verdict_store():
    return MemoryStore()


@pytest.fixture
def sample_context():
    return IncidentContext(
        id="INC-2026-0001",
        state=IncidentState.TRIGGERED,
        created_at="2026-03-19T10:00:00Z",
        updated_at="2026-03-19T10:00:00Z",
        trigger_source="sitrep",
        trigger_verdict_ids=["vrd-2026-03-19-abc12345-00001"],
        topology={
            "services": [
                {"name": "payment-api", "tier": "critical", "dependencies": ["database-primary"]},
                {"name": "checkout-service", "tier": "critical", "dependencies": ["payment-api"]},
            ]
        },
    )


@pytest.fixture
def sample_context_pagerduty():
    return IncidentContext(
        id="INC-2026-0002",
        state=IncidentState.TRIGGERED,
        created_at="2026-03-19T10:00:00Z",
        updated_at="2026-03-19T10:00:00Z",
        trigger_source="pagerduty",
        trigger_verdict_ids=[],
        topology={},
    )
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-respond && pip install -e ../nthlayer-learn/lib/python && uv run pytest tests/test_types.py -v`
Expected: All 12 tests PASS

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml src/ tests/
git commit -m "feat: project scaffold + core types (Phase 3.1)"
```

---

## Task 2: Config

**Files:**
- Create: `mayday/src/mayday/config.py`
- Create: `mayday/tests/test_config.py`

- [ ] **Step 1: Write failing tests for config**

```python
# tests/test_config.py
"""Tests for Mayday configuration."""
import textwrap
from mayday.config import MaydayConfig, load_config


def test_default_config():
    cfg = MaydayConfig()
    assert cfg.poll_interval_seconds == 30
    assert cfg.escalation_threshold == 0.3
    assert cfg.model == "claude-sonnet-4-20250514"
    assert cfg.triage_timeout == 15
    assert cfg.investigation_timeout == 60
    assert cfg.communication_timeout == 20
    assert cfg.remediation_timeout == 30
    assert cfg.root_cause_threshold == 0.7
    assert cfg.cooldown_seconds == 300
    assert cfg.arbiter_url == "http://localhost:8080"
    assert cfg.verdict_store_path == "verdicts.db"
    assert cfg.context_store_path == "mayday-incidents.db"


def test_load_config_from_yaml(tmp_path):
    config_file = tmp_path / "mayday.yaml"
    config_file.write_text(textwrap.dedent("""\
        coordinator:
          poll_interval_seconds: 10
          escalation_threshold: 0.5
        agents:
          model: claude-opus-4-20250514
          triage:
            timeout: 10
          investigation:
            timeout: 45
            root_cause_threshold: 0.8
        safe_actions:
          arbiter_url: http://arbiter:9090
        verdict:
          store:
            path: /tmp/verdicts.db
        context_store:
          path: /tmp/incidents.db
    """))
    cfg = load_config(str(config_file))
    assert cfg.poll_interval_seconds == 10
    assert cfg.escalation_threshold == 0.5
    assert cfg.model == "claude-opus-4-20250514"
    assert cfg.triage_timeout == 10
    assert cfg.investigation_timeout == 45
    assert cfg.root_cause_threshold == 0.8
    assert cfg.arbiter_url == "http://arbiter:9090"
    assert cfg.verdict_store_path == "/tmp/verdicts.db"
    assert cfg.context_store_path == "/tmp/incidents.db"


def test_load_config_missing_file():
    cfg = load_config("/nonexistent/path.yaml")
    assert cfg.model == "claude-sonnet-4-20250514"  # defaults


def test_load_config_partial_yaml(tmp_path):
    config_file = tmp_path / "mayday.yaml"
    config_file.write_text("coordinator:\n  poll_interval_seconds: 5\n")
    cfg = load_config(str(config_file))
    assert cfg.poll_interval_seconds == 5
    assert cfg.model == "claude-sonnet-4-20250514"  # default preserved
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement config.py**

```python
# src/mayday/config.py
"""Mayday configuration."""
from __future__ import annotations

from dataclasses import dataclass

import structlog
import yaml

logger = structlog.get_logger()


@dataclass
class MaydayConfig:
    # Coordinator
    poll_interval_seconds: int = 30
    escalation_threshold: float = 0.3
    # Agents
    model: str = "claude-sonnet-4-20250514"
    max_tokens: int = 4096
    triage_timeout: int = 15
    investigation_timeout: int = 60
    communication_timeout: int = 20
    remediation_timeout: int = 30
    root_cause_threshold: float = 0.7
    # Safe actions
    cooldown_seconds: int = 300
    arbiter_url: str = "http://localhost:8080"
    # Stores
    verdict_store_path: str = "verdicts.db"
    context_store_path: str = "mayday-incidents.db"
    # Topology
    manifests_dir: str | None = None


def load_config(path: str) -> MaydayConfig:
    """Load config from YAML file. Returns defaults if file missing."""
    try:
        with open(path) as f:
            data = yaml.safe_load(f) or {}
    except FileNotFoundError:
        logger.info("config_not_found", path=path)
        return MaydayConfig()

    coord = data.get("coordinator", {})
    agents = data.get("agents", {})
    safe = data.get("safe_actions", {})
    verdict = data.get("verdict", {}).get("store", {})
    ctx_store = data.get("context_store", {})
    topo = data.get("topology", {})

    return MaydayConfig(
        poll_interval_seconds=coord.get("poll_interval_seconds", 30),
        escalation_threshold=coord.get("escalation_threshold", 0.3),
        model=agents.get("model", "claude-sonnet-4-20250514"),
        max_tokens=agents.get("max_tokens", 4096),
        triage_timeout=agents.get("triage", {}).get("timeout", 15),
        investigation_timeout=agents.get("investigation", {}).get("timeout", 60),
        communication_timeout=agents.get("communication", {}).get("timeout", 20),
        remediation_timeout=agents.get("remediation", {}).get("timeout", 30),
        root_cause_threshold=agents.get("investigation", {}).get("root_cause_threshold", 0.7),
        cooldown_seconds=safe.get("cooldown_seconds", 300),
        arbiter_url=safe.get("arbiter_url", "http://localhost:8080"),
        verdict_store_path=verdict.get("path", "verdicts.db"),
        context_store_path=ctx_store.get("path", "mayday-incidents.db"),
        manifests_dir=topo.get("manifests_dir"),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_config.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mayday/config.py tests/test_config.py
git commit -m "feat: config loading from mayday.yaml (Phase 3.1)"
```

---

## Task 3: Context Store

**Files:**
- Create: `mayday/src/mayday/context_store.py`
- Create: `mayday/tests/test_context_store.py`

- [ ] **Step 1: Write failing tests for context store**

```python
# tests/test_context_store.py
"""Tests for context store."""
import json
import pytest
from mayday.context_store import SQLiteContextStore
from mayday.types import IncidentContext, IncidentState, TriageResult


@pytest.fixture
def store(tmp_path):
    s = SQLiteContextStore(str(tmp_path / "test-incidents.db"))
    yield s
    s.close()


def make_context(incident_id="INC-2026-0001", state=IncidentState.TRIGGERED):
    return IncidentContext(
        id=incident_id,
        state=state,
        created_at="2026-03-19T10:00:00Z",
        updated_at="2026-03-19T10:00:00Z",
        trigger_source="sitrep",
        trigger_verdict_ids=["vrd-001"],
        topology={},
    )


def test_save_and_load(store):
    ctx = make_context()
    store.save(ctx)
    loaded = store.load("INC-2026-0001")
    assert loaded is not None
    assert loaded.id == "INC-2026-0001"
    assert loaded.state == IncidentState.TRIGGERED
    assert loaded.trigger_verdict_ids == ["vrd-001"]


def test_save_overwrites(store):
    ctx = make_context()
    store.save(ctx)
    ctx.state = IncidentState.TRIAGING
    ctx.updated_at = "2026-03-19T10:01:00Z"
    store.save(ctx)
    loaded = store.load("INC-2026-0001")
    assert loaded.state == IncidentState.TRIAGING


def test_load_nonexistent(store):
    assert store.load("INC-NOPE") is None


def test_save_with_triage_result(store):
    ctx = make_context()
    ctx.triage = TriageResult(
        severity=1,
        blast_radius=["payment-api"],
        affected_slos=["availability"],
        assigned_team="payments",
        reasoning="test",
    )
    store.save(ctx)
    loaded = store.load("INC-2026-0001")
    assert loaded.triage is not None
    assert loaded.triage.severity == 1
    assert loaded.triage.blast_radius == ["payment-api"]


def test_save_failed_with_error(store):
    ctx = make_context(state=IncidentState.FAILED)
    ctx.error = "Unrecoverable: model API key expired"
    store.save(ctx)
    loaded = store.load("INC-2026-0001")
    assert loaded.error == "Unrecoverable: model API key expired"


def test_list_active(store):
    store.save(make_context("INC-001", IncidentState.TRIGGERED))
    store.save(make_context("INC-002", IncidentState.INVESTIGATING))
    store.save(make_context("INC-003", IncidentState.RESOLVED))
    store.save(make_context("INC-004", IncidentState.ESCALATED))
    active = store.list_active()
    assert set(active) == {"INC-001", "INC-002"}


def test_list_all(store):
    for i in range(5):
        store.save(make_context(f"INC-{i:03d}"))
    results = store.list_all(limit=3)
    assert len(results) == 3


def test_get_metadata_default(store):
    assert store.get_metadata("last_poll_timestamp") is None


def test_set_and_get_metadata(store):
    store.set_metadata("last_poll_timestamp", "2026-03-19T10:00:00Z")
    assert store.get_metadata("last_poll_timestamp") == "2026-03-19T10:00:00Z"


def test_set_metadata_overwrites(store):
    store.set_metadata("key", "value1")
    store.set_metadata("key", "value2")
    assert store.get_metadata("key") == "value2"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_context_store.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement context_store.py**

Implement `ContextStore` Protocol and `SQLiteContextStore` with:
- `incidents` table: `id TEXT PRIMARY KEY, state TEXT NOT NULL, error TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL`
- `metadata` table: `key TEXT PRIMARY KEY, value TEXT NOT NULL`
- WAL mode, busy_timeout=5000
- Indexes on `(state)`, `(updated_at DESC)`
- Full JSON serialisation of `IncidentContext` in `data` column
- `save()` extracts `state` and `error` into separate columns
- Deserialisation reconstructs typed `IncidentContext` with nested result dataclasses

The serialisation/deserialisation must handle nested dataclasses (`TriageResult`, `Hypothesis`, `CommunicationUpdate`, etc.) — use a `_to_dict`/`_from_dict` pattern similar to the verdict library's `serialise.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_context_store.py -v`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mayday/context_store.py tests/test_context_store.py
git commit -m "feat: context store with SQLite persistence (Phase 3.1)"
```

---

## Task 4: Agent Base Class

**Files:**
- Create: `mayday/src/mayday/agents/__init__.py`
- Create: `mayday/src/mayday/agents/base.py`
- Create: `mayday/tests/test_agent_base.py`

This is the core of the ZFC boundary. Transport methods on the base, judgment abstract on subclasses.

- [ ] **Step 1: Write failing tests for agent base**

```python
# tests/test_agent_base.py
"""Tests for AgentBase ABC."""
import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from verdict import MemoryStore, create as verdict_create

from mayday.agents.base import AgentBase
from mayday.types import (
    AgentRole, IncidentContext, IncidentState, TriageResult,
)


class StubAgent(AgentBase):
    """Minimal concrete agent for testing the base class."""
    role = AgentRole.TRIAGE
    default_timeout = 5

    def build_prompt(self, context):
        return ("You are a test agent.", "Assess this incident.")

    def parse_response(self, response, context):
        data = self._parse_json(response)
        return TriageResult(
            severity=data.get("severity", 2),
            blast_radius=data.get("blast_radius", []),
            affected_slos=[],
            assigned_team=None,
            reasoning=data.get("reasoning", ""),
        )

    def _apply_result(self, context, result):
        context.triage = result
        return context


@pytest.fixture
def stub_agent(verdict_store):
    return StubAgent(
        model="test-model",
        max_tokens=100,
        verdict_store=verdict_store,
        config={},
    )


@pytest.fixture
def triggered_context():
    return IncidentContext(
        id="INC-2026-0001",
        state=IncidentState.TRIGGERED,
        created_at="2026-03-19T10:00:00Z",
        updated_at="2026-03-19T10:00:00Z",
        trigger_source="sitrep",
        trigger_verdict_ids=["vrd-trigger-001"],
        topology={},
    )


def test_emit_verdict_creates_verdict(stub_agent, verdict_store, triggered_context):
    v = stub_agent._emit_verdict(
        triggered_context,
        subject_summary="Test triage",
        action="flag",
        confidence=0.8,
        reasoning="test reasoning",
    )
    assert v.subject.type == "triage"
    assert v.producer.system == "mayday"
    assert v.judgment.action == "flag"
    assert v.judgment.confidence == 0.8
    assert v.lineage.context == ["vrd-trigger-001"]
    assert v.lineage.parent is None  # first in chain
    assert v.id in triggered_context.verdict_chain
    # Verify persisted
    assert verdict_store.get(v.id) is not None


def test_emit_verdict_chains_parent(stub_agent, verdict_store, triggered_context):
    v1 = stub_agent._emit_verdict(
        triggered_context, "first", "flag", 0.8, "first verdict",
    )
    v2 = stub_agent._emit_verdict(
        triggered_context, "second", "flag", 0.7, "second verdict",
    )
    assert v2.lineage.parent == v1.id
    assert len(triggered_context.verdict_chain) == 2


def test_degraded_verdict(stub_agent, verdict_store, triggered_context):
    v = stub_agent._degraded_verdict(triggered_context, "model timeout")
    assert v.judgment.action == "escalate"
    assert v.judgment.confidence == 0.0
    assert "degraded" in v.judgment.tags
    assert "human-takeover-required" in v.judgment.tags
    assert v.id in triggered_context.verdict_chain


def test_parse_json_clean(stub_agent):
    result = stub_agent._parse_json('{"key": "value"}')
    assert result == {"key": "value"}


def test_parse_json_markdown_fences(stub_agent):
    result = stub_agent._parse_json('```json\n{"key": "value"}\n```')
    assert result == {"key": "value"}


def test_parse_json_preamble(stub_agent):
    result = stub_agent._parse_json('Here is the JSON:\n{"key": "value"}')
    assert result == {"key": "value"}


def test_parse_json_invalid(stub_agent):
    with pytest.raises(ValueError):
        stub_agent._parse_json("not json at all")


async def test_execute_success(stub_agent, triggered_context, verdict_store):
    model_response = json.dumps({
        "severity": 1,
        "blast_radius": ["payment-api"],
        "reasoning": "Critical service affected",
    })
    with patch.object(stub_agent, "_call_model", new_callable=AsyncMock, return_value=model_response):
        result = await stub_agent.execute(triggered_context)
    assert result.triage is not None
    assert result.triage.severity == 1
    assert len(result.verdict_chain) == 1


async def test_execute_model_failure_degrades(stub_agent, triggered_context, verdict_store):
    with patch.object(stub_agent, "_call_model", new_callable=AsyncMock, side_effect=Exception("API down")):
        result = await stub_agent.execute(triggered_context)
    assert result.triage is None  # no result applied
    assert len(result.verdict_chain) == 1  # degraded verdict emitted
    v = verdict_store.get(result.verdict_chain[0])
    assert v.judgment.action == "escalate"
    assert v.judgment.confidence == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_agent_base.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement agents/base.py**

Implement `AgentBase` ABC with:
- `_call_model()`: lazy Anthropic client init, `asyncio.to_thread` with `asyncio.wait_for(timeout)`
- `_emit_verdict()`: `verdict.create()` with lineage wiring (context=trigger_verdict_ids, parent=last in chain), `verdict_store.put()`, append to `verdict_chain`
- `_degraded_verdict()`: confidence=0.0, action="escalate", tags=["degraded", "human-takeover-required"]
- `_parse_json()`: strip markdown fences, find first `{`, parse, raise ValueError on failure
- `_request_autonomy_reduction()`: async HTTP POST with 3 retries (use `urllib.request` in `asyncio.to_thread` to avoid adding httpx dependency)
- `execute()`: template method as per spec
- `_post_execute()`: default no-op, returns context unchanged
- Abstract methods: `build_prompt()`, `parse_response()`, `_apply_result()`

Create empty `agents/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_agent_base.py -v`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mayday/agents/ tests/test_agent_base.py
git commit -m "feat: AgentBase ABC with template method pattern (Phase 3.2)"
```

---

## Task 5: Safe Action Registry

**Files:**
- Create: `mayday/src/mayday/safe_actions/__init__.py`
- Create: `mayday/src/mayday/safe_actions/registry.py`
- Create: `mayday/src/mayday/safe_actions/actions.py`
- Create: `mayday/tests/test_safe_actions.py`

- [ ] **Step 1: Write failing tests for safe action registry**

```python
# tests/test_safe_actions.py
"""Tests for safe action registry."""
import pytest
from mayday.safe_actions.registry import SafeAction, SafeActionRegistry
from mayday.safe_actions.actions import register_builtin_actions
from mayday.types import IncidentContext, IncidentState


def make_context():
    return IncidentContext(
        id="INC-2026-0001", state=IncidentState.REMEDIATING,
        created_at="2026-03-19T10:00:00Z", updated_at="2026-03-19T10:00:00Z",
        trigger_source="sitrep", trigger_verdict_ids=[], topology={},
    )


@pytest.fixture
def registry(tmp_path):
    return SafeActionRegistry(cooldown_store_path=str(tmp_path / "cooldown.db"))


def test_register_and_get(registry):
    action = SafeAction(
        name="test_action", description="A test", target_type="service",
        requires_approval=False, cooldown_seconds=60,
        handler=lambda t, c, **kw: {"success": True, "detail": "ok"},
    )
    registry.register(action)
    assert registry.get("test_action").name == "test_action"


def test_get_unknown_raises(registry):
    with pytest.raises(KeyError):
        registry.get("nonexistent")


def test_list_actions(registry):
    action = SafeAction(
        name="rollback", description="Rollback service", target_type="service",
        requires_approval=True, cooldown_seconds=300,
        handler=lambda t, c, **kw: {"success": True},
    )
    registry.register(action)
    actions = registry.list_actions()
    assert len(actions) == 1
    assert actions[0]["name"] == "rollback"
    assert "description" in actions[0]


async def test_execute_success(registry):
    async def handler(target, context, **kwargs):
        return {"success": True, "detail": f"rolled back {target}"}

    registry.register(SafeAction(
        name="rollback", description="Rollback", target_type="service",
        requires_approval=True, cooldown_seconds=0,
        handler=handler,
    ))
    result = await registry.execute("rollback", "payment-api", make_context())
    assert result["success"] is True


async def test_execute_unknown_action(registry):
    with pytest.raises(KeyError):
        await registry.execute("nonexistent", "target", make_context())


async def test_cooldown_enforcement(registry):
    call_count = 0

    async def handler(target, context, **kwargs):
        nonlocal call_count
        call_count += 1
        return {"success": True, "detail": "ok"}

    registry.register(SafeAction(
        name="rollback", description="Rollback", target_type="service",
        requires_approval=False, cooldown_seconds=3600,  # 1 hour
        handler=handler,
    ))
    await registry.execute("rollback", "payment-api", make_context())
    with pytest.raises(Exception, match="cooldown"):
        await registry.execute("rollback", "payment-api", make_context())
    assert call_count == 1


async def test_cooldown_different_targets(registry):
    async def handler(target, context, **kwargs):
        return {"success": True}

    registry.register(SafeAction(
        name="rollback", description="Rollback", target_type="service",
        requires_approval=False, cooldown_seconds=3600,
        handler=handler,
    ))
    await registry.execute("rollback", "service-a", make_context())
    # Different target should work
    result = await registry.execute("rollback", "service-b", make_context())
    assert result["success"] is True


def test_builtin_actions_registered(tmp_path):
    registry = SafeActionRegistry(cooldown_store_path=str(tmp_path / "cd.db"))
    register_builtin_actions(registry)
    names = [a["name"] for a in registry.list_actions()]
    assert "rollback" in names
    assert "scale_up" in names
    assert "disable_feature_flag" in names
    assert "reduce_autonomy" in names
    assert "pause_pipeline" in names


def test_approval_ratchet(tmp_path):
    """Actions with requires_approval=True cannot be downgraded."""
    registry = SafeActionRegistry(cooldown_store_path=str(tmp_path / "cd.db"))
    register_builtin_actions(registry)
    rollback = registry.get("rollback")
    assert rollback.requires_approval is True


async def test_blast_radius_check_passes(registry):
    async def handler(target, context, **kwargs):
        return {"success": True}

    registry.register(SafeAction(
        name="test_action", description="Test", target_type="service",
        requires_approval=False, cooldown_seconds=0,
        handler=handler,
        blast_radius_check=lambda target, ctx: True,  # always passes
    ))
    result = await registry.execute("test_action", "svc", make_context())
    assert result["success"] is True


async def test_blast_radius_check_fails(registry):
    async def handler(target, context, **kwargs):
        return {"success": True}

    registry.register(SafeAction(
        name="test_action", description="Test", target_type="service",
        requires_approval=False, cooldown_seconds=0,
        handler=handler,
        blast_radius_check=lambda target, ctx: False,  # always fails
    ))
    with pytest.raises(Exception, match="blast.?radius"):
        await registry.execute("test_action", "svc", make_context())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_safe_actions.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement registry.py and actions.py**

`registry.py`: `SafeAction` dataclass, `SafeActionRegistry` with SQLite cooldown tracking, `execute()` with validation/cooldown/blast-radius pipeline. Cooldown persists via a `cooldown_log` table in a small SQLite DB.

`actions.py`: `register_builtin_actions(registry)` function that registers 5 built-in actions. All are Tier 1 stubs (log + return simulated success). `reduce_autonomy` takes `arbiter_url` in kwargs.

Create empty `safe_actions/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_safe_actions.py -v`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mayday/safe_actions/ tests/test_safe_actions.py
git commit -m "feat: safe action registry with cooldown persistence (Phase 3.6)"
```

---

## Task 6: Triage Agent

**Files:**
- Create: `mayday/src/mayday/agents/triage.py`
- Create: `mayday/tests/test_triage.py`

- [ ] **Step 1: Write failing tests**

Test `build_prompt()` with sitrep and pagerduty trigger sources, `parse_response()` with valid/invalid JSON, severity validation (0-4), and the autonomy reduction trigger condition in `_post_execute()`.

Key tests:
- `test_build_prompt_sitrep_source` — prompt includes "pre-correlated context"
- `test_build_prompt_pagerduty_source` — prompt includes "No pre-correlation available"
- `test_parse_response_valid` — returns TriageResult with correct fields
- `test_parse_response_invalid_severity` — clamps to valid range
- `test_system_prompt_includes_slo` — system prompt contains "<10% severity reversal"
- `test_post_execute_autonomy_reduction` — triggers when agent_model_update change candidate + severity <= 2

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_triage.py -v`
Expected: FAIL

- [ ] **Step 3: Implement triage.py**

`TriageAgent(AgentBase)` with `role = AgentRole.TRIAGE`, `default_timeout = 15`. System prompt includes judgment SLO (<10% reversal rate). `build_prompt()` queries verdict store for trigger verdicts and adjusts prompt based on `trigger_source`. `parse_response()` validates severity 0-4, non-empty blast_radius. `_post_execute()` checks for autonomy reduction trigger.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_triage.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mayday/agents/triage.py tests/test_triage.py
git commit -m "feat: triage agent with autonomy reduction trigger (Phase 3)"
```

---

## Task 7: Investigation Agent

**Files:**
- Create: `mayday/src/mayday/agents/investigation.py`
- Create: `mayday/tests/test_investigation.py`

- [ ] **Step 1: Write failing tests**

Key tests:
- `test_build_prompt_includes_triage` — prompt includes triage severity and blast radius
- `test_build_prompt_includes_threshold` — system prompt tells model the root_cause_threshold value
- `test_parse_response_with_root_cause` — sets root_cause when confidence >= threshold
- `test_parse_response_clears_root_cause_below_threshold` — parser clears root_cause if confidence < threshold
- `test_parse_response_no_root_cause` — root_cause=None when model doesn't declare one
- `test_hypotheses_parsed` — multiple hypotheses with change candidates

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_investigation.py -v`

- [ ] **Step 3: Implement investigation.py**

`InvestigationAgent(AgentBase)` with `role = AgentRole.INVESTIGATION`, `default_timeout = 60`. System prompt includes judgment SLO (70% agreement) and `root_cause_threshold`. `parse_response()` enforces the threshold — if model sets root_cause but confidence is below threshold, clear root_cause to None.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_investigation.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mayday/agents/investigation.py tests/test_investigation.py
git commit -m "feat: investigation agent with root cause threshold (Phase 3)"
```

---

## Task 8: Communication Agent

**Files:**
- Create: `mayday/src/mayday/agents/communication.py`
- Create: `mayday/tests/test_communication.py`

- [ ] **Step 1: Write failing tests**

Key tests:
- `test_build_prompt_initial_phase` — when `context.remediation is None`, prompts for initial update
- `test_build_prompt_resolution_phase` — when `context.remediation` is populated, prompts for resolution
- `test_parse_response_creates_updates` — CommunicationUpdate objects with typed fields
- `test_apply_result_appends` — second run appends to existing updates_sent, doesn't replace
- `test_empty_updates_sent_default` — CommunicationResult defaults to empty list
- `test_system_prompt_includes_slo` — contains "<15% human edit rate"

- [ ] **Step 2: Run tests, implement, run tests, commit**

Same TDD cycle. `CommunicationAgent(AgentBase)` with `role = AgentRole.COMMUNICATION`, `default_timeout = 20`. Two-phase prompt based on context state.

```bash
git commit -m "feat: communication agent with two-phase prompting (Phase 3)"
```

---

## Task 9: Remediation Agent

**Files:**
- Create: `mayday/src/mayday/agents/remediation.py`
- Create: `mayday/tests/test_remediation.py`

- [ ] **Step 1: Write failing tests**

Key tests:
- `test_build_prompt_includes_safe_actions` — prompt lists available actions from registry
- `test_parse_response_valid_action` — proposed_action in registry accepted
- `test_parse_response_hallucinated_action` — action NOT in registry → None, requires_human_approval=True, logs warning
- `test_approval_ratchet` — if registry action has `requires_approval=True`, model's `False` is ignored
- `test_post_execute_runs_safe_action` — when not requires_human_approval, calls registry.execute()
- `test_post_execute_skips_when_approval_required` — when requires_human_approval, does NOT call registry
- `test_post_execute_autonomy_reduction` — when recommended, calls _request_autonomy_reduction()
- `test_post_execute_ordering` — safe action before autonomy reduction
- `test_system_prompt_includes_slo` — contains "80% fix success rate"

- [ ] **Step 2: Run tests, implement, run tests, commit**

`RemediationAgent(AgentBase)` with `role = AgentRole.REMEDIATION`, `default_timeout = 30`. Takes `safe_action_registry` in `__init__`. `_post_execute()` implements the two-step ordering: safe action execution → autonomy reduction.

```bash
git commit -m "feat: remediation agent with safe action execution (Phase 3)"
```

---

## Task 10: Coordinator

**Files:**
- Create: `mayday/src/mayday/coordinator.py`
- Create: `mayday/tests/test_coordinator.py`

This is the largest task. The coordinator sequences agents, handles parallel execution, crash recovery, escalation checks, and human approval flow.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_coordinator.py — key tests (not exhaustive, expand during implementation)

async def test_full_pipeline_runs_all_agents():
    """TRIGGERED → triage → investigation+communication → remediation → communication → RESOLVED"""

async def test_crash_recovery_resumes_from_step_index():
    """Set last_completed_step_index=0, verify triage skipped, investigation runs"""

async def test_parallel_step_failure_isolation():
    """Communication fails, investigation succeeds → continues to remediation"""

async def test_escalation_check_triggers():
    """Agent emits escalate with low confidence → state becomes ESCALATED"""

async def test_awaiting_approval_pauses():
    """Remediation requires_human_approval → state=AWAITING_APPROVAL, run() returns"""

async def test_approve_executes_safe_action():
    """approve() on AWAITING_APPROVAL → executes action → RESOLVED"""

async def test_approve_execution_failure():
    """approve() safe action fails → ESCALATED"""

async def test_reject_resolves_verdict():
    """reject() → remediation verdict resolved as overridden → ESCALATED"""

async def test_reject_includes_proposed_action():
    """Override reasoning includes original proposed action"""

async def test_second_communication_skipped_when_escalated():
    """If state is ESCALATED after remediation, skip resolution communication"""

async def test_failed_state_captures_error():
    """Unrecoverable error → FAILED state with error message on context"""
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_coordinator.py -v`

- [ ] **Step 3: Implement coordinator.py**

`Coordinator` class with:
- `PIPELINE` constant: list of list of AgentRole
- `run()`: iterate pipeline steps, handle parallel via `asyncio.gather(return_exceptions=True)`, checkpoint after each step, check escalation, check approval gate
- `resume()`: load from context_store, call run()
- `approve()`: validate AWAITING_APPROVAL, execute safe action, transition
- `reject()`: validate AWAITING_APPROVAL, resolve verdict as overridden with proposed action in reasoning, transition to ESCALATED
- `_next_step()`: returns `list[AgentRole]` based on `last_completed_step_index`
- `_check_escalation()`: check verdict chain for escalate + low confidence
- `_execute_step()`: run single agent, update state
- `_execute_parallel()`: run multiple agents via gather, handle exceptions individually
- Guard on second communication (step index 3): skip if ESCALATED or FAILED

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_coordinator.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mayday/coordinator.py tests/test_coordinator.py
git commit -m "feat: coordinator with crash recovery and parallel execution (Phase 3.1)"
```

---

## Task 11: Scenario Fixtures

**Files:**
- Create: `mayday/scenarios/synthetic/cascading-failure.yaml`
- Create: `mayday/scenarios/synthetic/sitrep-unavailable.yaml`
- Create: `mayday/scenarios/synthetic/model-unavailable.yaml`
- Create: `mayday/scenarios/synthetic/human-override.yaml`
- Create: `mayday/scenarios/synthetic/low-confidence-escalation.yaml`
- Create: `mayday/scenarios/synthetic/remediation-approval.yaml`
- Create: `mayday/scenarios/synthetic/autonomy-reduction.yaml`
- Create: `mayday/scenarios/synthetic/crash-recovery.yaml`

- [ ] **Step 1: Create cascading-failure.yaml**

```yaml
scenario:
  id: cascading-failure
  description: "End-to-end: SitRep correlation → full Mayday pipeline → RESOLVED"
  trigger:
    source: sitrep
    sitrep_scenario: "../../nthlayer-correlate/scenarios/synthetic/cascading-failure.yaml"
  mock_responses:
    triage:
      severity: 1
      blast_radius: ["payment-api", "checkout-service"]
      affected_slos: ["availability", "latency_p99"]
      assigned_team: "payments-oncall"
      reasoning: "Critical payment service affected with cascading dependency impact"
    investigation:
      hypotheses:
        - description: "payment-api deploy v2.3.1 removed connection pooling"
          confidence: 0.87
          evidence:
            - "latency spike 12m after deploy"
            - "connection pool metric dropped to 0"
          change_candidate: "payment-api deploy v2.3.1"
      root_cause: "payment-api deploy v2.3.1 removed connection pooling"
      root_cause_confidence: 0.87
      reasoning: "Strong temporal and causal correlation between deploy and failure"
    communication_initial:
      updates:
        - channel: "slack"
          update_type: "initial"
          content: "Investigating payment-api latency. Checkout-service affected. Payments team engaged."
      reasoning: "Notify affected teams of P1 incident"
    remediation:
      proposed_action: "rollback"
      target: "payment-api"
      risk_assessment: "Low risk — rolling back to known-good v2.3.0"
      requires_human_approval: false
      reasoning: "Rollback is pre-approved safe action for this service"
    communication_resolution:
      updates:
        - channel: "slack"
          update_type: "resolution"
          content: "payment-api rolled back to v2.3.0. Latency recovering. Monitoring."
      reasoning: "Communicate resolution to affected teams"
  interactions: []
  expected_outcomes:
    final_state: "resolved"
    verdict_count: 5
    root_cause: "payment-api deploy v2.3.1 removed connection pooling"
    remediation_executed: true
    autonomy_reduced: false
```

- [ ] **Step 2: Create remaining 7 scenario files**

Create each with appropriate trigger source, mock responses, interactions, and expected outcomes per the spec (Section 10). Key details:
- `sitrep-unavailable.yaml`: trigger.source=pagerduty, trigger.alert={service: "payment-api", severity: 0.9}
- `model-unavailable.yaml`: trigger.source=sitrep, mock_responses all set to `null` (triggers degraded path)
- `human-override.yaml`: interaction at "after:triage" with action=reject
- `low-confidence-escalation.yaml`: investigation mock with root_cause_confidence=0.2
- `remediation-approval.yaml`: remediation requires_human_approval=true, interaction at "after:remediation_proposed" with action=approve
- `autonomy-reduction.yaml`: SitRep change_candidate with type "agent_model_update"
- `crash-recovery.yaml`: special field `crash_after_step: 0` (coordinator restarts after triage)

- [ ] **Step 3: Commit**

```bash
git add scenarios/
git commit -m "feat: 8 synthetic scenario fixtures (Phase 3.1)"
```

---

## Task 12: CLI + Replay

**Files:**
- Create: `mayday/src/mayday/cli.py`
- Create: `mayday/tests/test_replay.py`
- Create: `mayday/tests/test_cli.py`

The replay command is the primary acceptance criterion.

- [ ] **Step 1: Write failing tests for replay**

```python
# tests/test_replay.py
"""Tests for mayday replay command — primary acceptance criterion."""
import pytest
from mayday.cli import replay_command


async def test_replay_cascading_failure_no_model(tmp_path):
    """The primary acceptance criterion:
    mayday replay --scenario cascading-failure.yaml --no-model
    produces expected verdicts with full lineage."""
    # This test runs the full pipeline with mock responses
    # and verifies: verdict count, final state, lineage chain


async def test_replay_pagerduty_trigger(tmp_path):
    """Replay with pagerduty trigger (no SitRep)."""


async def test_replay_with_interaction(tmp_path):
    """Replay scenario with human approve interaction."""


async def test_replay_model_unavailable(tmp_path):
    """All agents degrade — verify escalated state."""
```

- [ ] **Step 2: Write failing tests for CLI commands**

```python
# tests/test_cli.py
"""Tests for CLI argument parsing and command dispatch."""
from mayday.cli import build_parser


def test_parser_serve():
    parser = build_parser()
    args = parser.parse_args(["serve"])
    assert args.command == "serve"


def test_parser_replay():
    parser = build_parser()
    args = parser.parse_args(["replay", "--scenario", "test.yaml", "--no-model"])
    assert args.command == "replay"
    assert args.scenario == "test.yaml"
    assert args.no_model is True


def test_parser_approve():
    parser = build_parser()
    args = parser.parse_args(["approve", "INC-2026-0001"])
    assert args.command == "approve"
    assert args.incident_id == "INC-2026-0001"


def test_parser_reject():
    parser = build_parser()
    args = parser.parse_args(["reject", "INC-2026-0001", "--reason", "Wrong action"])
    assert args.command == "reject"
    assert args.reason == "Wrong action"


def test_parser_resume():
    parser = build_parser()
    args = parser.parse_args(["resume", "INC-2026-0001"])
    assert args.command == "resume"
    assert args.incident_id == "INC-2026-0001"


def test_parser_status():
    parser = build_parser()
    args = parser.parse_args(["status"])
    assert args.command == "status"


async def test_status_shows_active_incidents(tmp_path, capsys):
    """Functional test: status command displays active incidents."""
    # Create a context store with active and resolved incidents,
    # run status_command(), verify output includes active IDs
    # and excludes resolved ones


async def test_resume_loads_and_runs(tmp_path):
    """Functional test: resume loads context from store and runs coordinator."""
    # Save a context with last_completed_step_index=0 (triage done),
    # run resume_command(), verify investigation runs next
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_replay.py tests/test_cli.py -v`

- [ ] **Step 4: Implement cli.py**

`build_parser()` with argparse subcommands: serve, status, replay, approve, reject, resume.

`replay_command()`:
1. Load scenario YAML
2. Based on trigger.source:
   - "sitrep": try import sitrep replay logic, run correlation, capture verdicts. On ImportError: print clear message "SitRep must be installed: pip install -e ../sitrep"
   - "pagerduty"/"manual": create context from raw alert or pre-built verdicts
3. Create IncidentContext
4. If `--no-model`: inject mock responses (monkey-patch agent `_call_model` to return scenario mock_responses)
5. Run coordinator
6. For interactions: inject at specified timing points
7. Print incident timeline + verdict chain

`serve_command()`:
- Poll loop: query `verdict_store` for new SitRep correlation verdicts using `VerdictFilter(producer_system="sitrep", subject_type="correlation", from_time=last_poll_timestamp)`
- `last_poll_timestamp` persisted via `context_store.set_metadata("last_poll_timestamp", ...)`; on first start (None), look back `poll_interval_seconds * 2`
- Action filtering: post-query Python filter for `judgment.action in ("escalate", "flag")`, skip `"defer"`
- Incident dedup: skip if `context_store.list_active()` has incident with overlapping services
- SIGINT/SIGTERM: set shutdown event, drain current pipeline step, save context, exit

`status_command()`: query `context_store.list_active()` and `list_all()`, print table with ID, state, last step, error (for FAILED).

`approve_command()`, `reject_command()`, `resume_command()`: load config, create stores, delegate to coordinator methods.

`main()`: parse args, dispatch to command function.

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_replay.py tests/test_cli.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/mayday/cli.py tests/test_replay.py tests/test_cli.py
git commit -m "feat: CLI with replay command (Phase 3.5)"
```

---

## Task 13: Integration Test + Acceptance

**Files:**
- Modify: `mayday/tests/test_replay.py` (expand)

This is the final integration pass — run `mayday replay --scenario cascading-failure.yaml --no-model` and verify the full verdict chain.

- [ ] **Step 1: Run the full test suite**

Run: `uv run pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 2: Run the acceptance criterion manually**

Run: `uv run mayday replay --scenario scenarios/synthetic/cascading-failure.yaml --no-model`
Expected output:
- Incident timeline showing 5 steps (triage → investigation → communication → remediation → communication)
- Verdict chain with 5+ verdicts
- Final state: RESOLVED
- Lineage: each Mayday verdict links to SitRep correlation verdicts

- [ ] **Step 3: Run replay for each scenario**

```bash
uv run mayday replay --scenario scenarios/synthetic/sitrep-unavailable.yaml --no-model
uv run mayday replay --scenario scenarios/synthetic/model-unavailable.yaml --no-model
uv run mayday replay --scenario scenarios/synthetic/human-override.yaml --no-model
uv run mayday replay --scenario scenarios/synthetic/low-confidence-escalation.yaml --no-model
uv run mayday replay --scenario scenarios/synthetic/remediation-approval.yaml --no-model
uv run mayday replay --scenario scenarios/synthetic/autonomy-reduction.yaml --no-model
uv run mayday replay --scenario scenarios/synthetic/crash-recovery.yaml --no-model
```

Verify each produces the expected final state from the scenario's `expected_outcomes`.

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "feat: integration tests pass, acceptance criteria met (Phase 3)"
```

---

## Task 14: Update Beads

- [ ] **Step 1: Close completed beads tasks**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/opensrm
bd update opensrm-m50.1 --status done   # Coordinator + crash recovery
bd update opensrm-m50.2 --status done   # Triage agent
bd update opensrm-m50.3 --status done   # Investigation agent
bd update opensrm-m50.4 --status done   # Communication agent
bd update opensrm-m50.5 --status done   # Remediation agent
bd update opensrm-m50.6 --status done   # Safe Action Registry
bd update opensrm-m50.8 --status done   # Human override flow
bd update opensrm-m50.9 --status done   # Mayday CLI
bd update opensrm-m50.10 --status done  # mayday replay
bd update opensrm-m50.11 --status done  # Mayday tests
bd update opensrm-m50 --status done     # Phase 3 epic
```

- [ ] **Step 2: Commit beads state**

```bash
git add .beads/
git commit -m "chore: close Phase 3 beads tasks"
```

---

## Task 15: Update mayday/CLAUDE.md

**Files:**
- Modify: `mayday/CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Add autonomy reduction as a first-class concept in the Key Design Patterns section. Update the implementation phases section to reference the design spec. Update status from "architecture phase only" to "Phase 3 implemented". Add build commands section matching SitRep's pattern (`uv run pytest tests/ -v`, `uv run mayday serve | status | replay`).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Phase 3 implementation details"
```

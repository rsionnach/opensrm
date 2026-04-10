# Phase 1: Arbiter Verdict Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the verdict library into Arbiter so every evaluation becomes a queryable verdict, every override becomes a verdict resolution, and accuracy is measurable via `verdict accuracy --producer arbiter` (Demo 1: "The Feedback Loop").

**Architecture:** Verdict creation slots into PipelineRouter.run() after save_score(). Override-to-resolution happens inside SQLiteScoreStore.save_override(). A new VerdictCalibration class runs alongside existing JudgmentSLOChecker as a strangler fig. All verdict calls use asyncio.to_thread() to bridge sync verdict library into async arbiter.

**Tech Stack:** Python 3.11+, pytest + pytest-asyncio, verdict library (path dependency), SQLite, asyncio

**Python:** Use `/opt/homebrew/bin/python3.12` — system Python is 3.9.6, arbiter requires >=3.10.

**Test command prefix:** `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest`

**Spec:** `opensrm/docs/superpowers/specs/2026-03-13-phase-1-arbiter-verdict-integration-design.md`

---

## File Structure

### Files to Modify

| File | Responsibility | Changes |
|------|---------------|---------|
| `arbiter/pyproject.toml` | Project metadata + dependencies | Add verdict path dependency |
| `arbiter/src/arbiter/config.py` | Configuration dataclasses + YAML loading | Add `VerdictConfig`, optional `verdict` field on `ArbiterConfig`, parse in `load_config()` |
| `arbiter/src/arbiter/store/sqlite.py` | Score persistence | Accept optional verdict store, `ALTER TABLE` migration for `verdict_id`, `set_verdict_id()` method, verdict resolution in `save_override()` |
| `arbiter/src/arbiter/pipeline/router.py` | Pipeline orchestration | Accept verdict store + threshold, create verdict after save_score(), call set_verdict_id() |
| `arbiter/src/arbiter/cli.py` | CLI entry point | Add `--verdict` flag to `calibrate` subcommand, wire VerdictCalibration |

### Files to Create

| File | Responsibility |
|------|---------------|
| `arbiter/src/arbiter/calibration/verdict_calibration.py` | VerdictCalibration class — system-wide accuracy via verdict store |
| `arbiter/tests/test_verdict_integration.py` | All verdict integration tests |

### Files Unchanged

- `arbiter/src/arbiter/pipeline/evaluator.py` — assessment logic untouched
- `arbiter/src/arbiter/store/protocol.py` — ScoreStore protocol unchanged; verdict store is internal to SQLiteScoreStore
- `arbiter/src/arbiter/calibration/slos.py` — existing JudgmentSLOChecker stays as-is
- `arbiter/src/arbiter/calibration/loop.py` — existing OverrideCalibration stays
- All existing test files — no modifications

---

## Chunk 1: Foundation (Config + Dependency + Schema Migration)

### Task 1: Add verdict path dependency to pyproject.toml

**Files:**
- Modify: `arbiter/pyproject.toml:11`

- [ ] **Step 1: Add verdict dependency**

In `arbiter/pyproject.toml`, change line 11 from:
```toml
dependencies = ["pyyaml>=6.0", "anthropic>=0.39.0"]
```
to:
```toml
dependencies = ["pyyaml>=6.0", "anthropic>=0.39.0", "verdict @ file:///../nthlayer-learn/lib/python"]
```

- [ ] **Step 2: Verify the dependency resolves**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pip install -e ".[dev]"`
Expected: Installs successfully, verdict package is importable.

- [ ] **Step 3: Verify verdict is importable from arbiter context**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -c "from verdict import create, SQLiteVerdictStore, AccuracyFilter; print('OK')"`
Expected: Prints `OK`.

- [ ] **Step 4: Commit**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure
git add pyproject.toml
git commit -m "feat: add verdict path dependency to arbiter"
```

---

### Task 2: Add VerdictConfig to config.py

**Files:**
- Modify: `arbiter/src/arbiter/config.py:57-110`
- Test: `arbiter/tests/test_verdict_integration.py` (new file, first tests)

- [ ] **Step 1: Write the failing tests for VerdictConfig**

Create `arbiter/tests/test_verdict_integration.py`:

```python
"""Tests for Arbiter / Verdict integration (Phase 1)."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from arbiter.config import ArbiterConfig, VerdictConfig, load_config


class TestVerdictConfig:
    """Tests for VerdictConfig dataclass and config loading."""

    def test_verdict_config_defaults(self):
        vc = VerdictConfig()
        assert vc.store_path == "verdicts.db"

    def test_verdict_config_custom_path(self):
        vc = VerdictConfig(store_path="/tmp/custom.db")
        assert vc.store_path == "/tmp/custom.db"

    def test_arbiter_config_verdict_none_by_default(self):
        config = ArbiterConfig()
        assert config.verdict is None

    def test_load_config_without_verdict_section(self, tmp_path):
        cfg_file = tmp_path / "arbiter.yaml"
        cfg_file.write_text(textwrap.dedent("""\
            evaluator:
              model: test-model
        """))
        config = load_config(cfg_file)
        assert config.verdict is None

    def test_load_config_with_verdict_section(self, tmp_path):
        cfg_file = tmp_path / "arbiter.yaml"
        cfg_file.write_text(textwrap.dedent("""\
            evaluator:
              model: test-model
            verdict:
              store:
                path: custom-verdicts.db
        """))
        config = load_config(cfg_file)
        assert config.verdict is not None
        assert config.verdict.store_path == "custom-verdicts.db"

    def test_load_config_with_verdict_section_defaults(self, tmp_path):
        cfg_file = tmp_path / "arbiter.yaml"
        cfg_file.write_text(textwrap.dedent("""\
            evaluator:
              model: test-model
            verdict:
              store: {}
        """))
        config = load_config(cfg_file)
        assert config.verdict is not None
        assert config.verdict.store_path == "verdicts.db"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestVerdictConfig -v`
Expected: FAIL — `ImportError: cannot import name 'VerdictConfig'` from `arbiter.config`.

- [ ] **Step 3: Implement VerdictConfig and update ArbiterConfig + load_config**

In `arbiter/src/arbiter/config.py`:

**Add VerdictConfig dataclass** after `DetectionConfig` (after line 54):

```python
@dataclass
class VerdictConfig:
    """Configuration for verdict integration."""

    store_path: str = "verdicts.db"
```

**Add `verdict` field to `ArbiterConfig`** (line 66, after `agents`):

```python
    verdict: VerdictConfig | None = None
```

**Update `load_config()`** — add verdict parsing before the `return` statement (before line 103):

```python
    verdict_cfg = None
    verdict_raw = raw.get("verdict")
    if verdict_raw is not None:
        if not isinstance(verdict_raw, dict):
            raise ValueError(f"Config section 'verdict' must be a mapping, got {type(verdict_raw).__name__}")
        store_raw = verdict_raw.get("store", {})
        if not isinstance(store_raw, dict):
            raise ValueError(f"Config section 'verdict.store' must be a mapping, got {type(store_raw).__name__}")
        verdict_cfg = VerdictConfig(store_path=store_raw.get("path", "verdicts.db"))
```

**Update the `return ArbiterConfig(...)` call** to include `verdict=verdict_cfg`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestVerdictConfig -v`
Expected: All 6 tests PASS.

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest -v`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure
git add src/arbiter/config.py tests/test_verdict_integration.py
git commit -m "feat: add VerdictConfig to arbiter config with YAML parsing"
```

---

### Task 3: Schema migration — add verdict_id column + set_verdict_id method

**Files:**
- Modify: `arbiter/src/arbiter/store/sqlite.py:21-27` (init), add new method
- Test: `arbiter/tests/test_verdict_integration.py` (append to file)

- [ ] **Step 1: Write the failing tests for schema migration and set_verdict_id**

Append to `arbiter/tests/test_verdict_integration.py`:

```python
import pytest_asyncio
from datetime import datetime, timedelta, timezone

from arbiter.store.sqlite import SQLiteScoreStore
from arbiter.types import QualityScore


def _make_score(eval_id: str = "e1", agent: str = "agent-a", task: str = "t1", **kwargs) -> QualityScore:
    return QualityScore(
        eval_id=eval_id,
        agent_name=agent,
        task_id=task,
        dimensions=kwargs.get("dimensions", {"correctness": 0.9, "style": 0.7}),
        reasoning=kwargs.get("reasoning", {"correctness": "Good", "style": "OK"}),
        confidence=kwargs.get("confidence", 0.85),
        evaluator_model=kwargs.get("evaluator_model", "test-model"),
        cost_usd=kwargs.get("cost_usd", 0.01),
    )


class TestSchemaMigration:
    """Tests for verdict_id column migration and set_verdict_id."""

    @pytest_asyncio.fixture
    async def store(self, tmp_path):
        s = SQLiteScoreStore(tmp_path / "test.db")
        yield s
        s.close()

    @pytest.mark.asyncio
    async def test_verdict_id_column_exists_after_init(self, store):
        """The evaluations table should have a verdict_id column after init."""
        with store._lock:
            row = store._conn.execute(
                "PRAGMA table_info(evaluations)"
            ).fetchall()
        col_names = [r["name"] for r in row]
        assert "verdict_id" in col_names

    @pytest.mark.asyncio
    async def test_verdict_id_null_by_default(self, store):
        """New evaluations should have verdict_id = NULL."""
        await store.save_score(_make_score())
        with store._lock:
            row = store._conn.execute(
                "SELECT verdict_id FROM evaluations WHERE eval_id = ?", ("e1",)
            ).fetchone()
        assert row["verdict_id"] is None

    @pytest.mark.asyncio
    async def test_set_verdict_id(self, store):
        """set_verdict_id should update the verdict_id for a given eval_id."""
        await store.save_score(_make_score())
        await store.set_verdict_id("e1", "vrd-2026-03-13-abcd1234-00001")
        with store._lock:
            row = store._conn.execute(
                "SELECT verdict_id FROM evaluations WHERE eval_id = ?", ("e1",)
            ).fetchone()
        assert row["verdict_id"] == "vrd-2026-03-13-abcd1234-00001"

    @pytest.mark.asyncio
    async def test_set_verdict_id_unknown_raises(self, store):
        """set_verdict_id on non-existent eval_id should raise ValueError."""
        with pytest.raises(ValueError, match="non-existent"):
            await store.set_verdict_id("no-such-id", "vrd-xxx")

    @pytest.mark.asyncio
    async def test_migration_idempotent(self, tmp_path):
        """Creating SQLiteScoreStore twice on the same DB should not crash."""
        db = tmp_path / "test.db"
        s1 = SQLiteScoreStore(db)
        s1.close()
        s2 = SQLiteScoreStore(db)
        s2.close()
        # No exception means migration is idempotent
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestSchemaMigration -v`
Expected: FAIL — `verdict_id` column does not exist, `set_verdict_id` not defined.

- [ ] **Step 3: Implement schema migration and set_verdict_id**

In `arbiter/src/arbiter/store/sqlite.py`:

**Add migration call to `__init__`** — after `self._apply_schema()` (after line 27), add:

```python
        self._migrate_verdict_id()
```

**Add the migration method** after `_apply_schema` (after line 32):

```python
    def _migrate_verdict_id(self) -> None:
        """Add verdict_id column to evaluations if not present."""
        with self._lock:
            try:
                self._conn.execute("ALTER TABLE evaluations ADD COLUMN verdict_id TEXT")
                self._conn.commit()
            except sqlite3.OperationalError as e:
                if "duplicate column" not in str(e):
                    raise
```

**Add `_set_verdict_id_sync` and `set_verdict_id`** after `save_score` (after line 58):

```python
    def _set_verdict_id_sync(self, eval_id: str, verdict_id: str) -> None:
        with self._lock:
            cursor = self._conn.execute(
                "UPDATE evaluations SET verdict_id = ? WHERE eval_id = ?",
                (verdict_id, eval_id),
            )
            if cursor.rowcount == 0:
                raise ValueError(f"Cannot set verdict_id on non-existent evaluation: {eval_id}")
            self._conn.commit()

    async def set_verdict_id(self, eval_id: str, verdict_id: str) -> None:
        await asyncio.to_thread(self._set_verdict_id_sync, eval_id, verdict_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestSchemaMigration -v`
Expected: All 5 tests PASS.

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest -v`
Expected: All tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure
git add src/arbiter/store/sqlite.py tests/test_verdict_integration.py
git commit -m "feat: add verdict_id column migration and set_verdict_id to SQLiteScoreStore"
```

---

## Chunk 2: Verdict Emission (Router Integration)

### Task 4: Verdict creation in PipelineRouter.run()

**Files:**
- Modify: `arbiter/src/arbiter/pipeline/router.py:1-62`
- Test: `arbiter/tests/test_verdict_integration.py` (append)

- [ ] **Step 1: Write the failing tests for verdict emission**

Append to `arbiter/tests/test_verdict_integration.py`:

```python
import asyncio
from unittest.mock import AsyncMock, MagicMock

from verdict import SQLiteVerdictStore, AccuracyFilter, VerdictFilter, create as verdict_create

from arbiter.pipeline.router import DEFAULT_APPROVE_THRESHOLD, PipelineRouter


class TestVerdictEmission:
    """Tests for verdict creation in PipelineRouter."""

    @pytest_asyncio.fixture
    async def verdict_store(self, tmp_path):
        vs = SQLiteVerdictStore(str(tmp_path / "verdicts.db"))
        yield vs
        vs.close()

    @pytest_asyncio.fixture
    async def score_store(self, tmp_path):
        s = SQLiteScoreStore(tmp_path / "score.db")
        yield s
        s.close()

    def _make_pipeline(self, score_store, verdict_store=None, threshold=None):
        """Build a PipelineRouter with mock adapter/evaluator for testing."""
        adapter = AsyncMock()
        evaluator_mock = AsyncMock()
        tracker = AsyncMock()
        tracker.compute_window = AsyncMock()

        return PipelineRouter(
            adapter=adapter,
            evaluator=evaluator_mock,
            store=score_store,
            tracker=tracker,
            dimensions=["correctness", "style"],
            verdict_store=verdict_store,
            approve_threshold=threshold,
        )

    async def _run_single(self, router, score):
        """Configure adapter to yield one output, evaluator to return score, run pipeline."""
        output = MagicMock()
        output.agent_name = score.agent_name

        async def _receive():
            yield output

        router._adapter.receive = _receive
        router._evaluator.evaluate = AsyncMock(return_value=score)
        await router.run()

    @pytest.mark.asyncio
    async def test_verdict_created_after_scoring(self, score_store, verdict_store):
        router = self._make_pipeline(score_store, verdict_store)
        score = _make_score(dimensions={"correctness": 0.8, "style": 0.6})
        await self._run_single(router, score)

        # Verdict should be in verdict store
        verdicts = verdict_store.query(VerdictFilter(producer_system="arbiter", limit=10))
        assert len(verdicts) == 1
        v = verdicts[0]
        assert v.subject.type == "agent_output"
        assert v.subject.ref == "t1"
        assert v.subject.agent == "agent-a"
        assert v.judgment.action == "approve"  # avg 0.7 >= 0.5
        assert v.judgment.confidence == pytest.approx(0.85)
        assert v.judgment.score == pytest.approx(0.7)
        assert v.judgment.dimensions == {"correctness": 0.8, "style": 0.6}
        assert v.subject.summary == "Evaluation of agent-a: t1"
        assert v.producer.system == "arbiter"
        assert v.producer.model == "test-model"
        assert v.metadata.cost_currency == pytest.approx(0.01)

    @pytest.mark.asyncio
    async def test_verdict_id_written_to_evaluations(self, score_store, verdict_store):
        router = self._make_pipeline(score_store, verdict_store)
        score = _make_score()
        await self._run_single(router, score)

        # verdict_id should be set on the evaluations row
        with score_store._lock:
            row = score_store._conn.execute(
                "SELECT verdict_id FROM evaluations WHERE eval_id = ?", ("e1",)
            ).fetchone()
        assert row["verdict_id"] is not None
        assert row["verdict_id"].startswith("vrd-")

    @pytest.mark.asyncio
    async def test_approve_threshold_boundary_approve(self, score_store, verdict_store):
        """Score exactly at threshold -> approve."""
        router = self._make_pipeline(score_store, verdict_store)
        score = _make_score(dimensions={"d1": 0.5})
        await self._run_single(router, score)

        verdicts = verdict_store.query(VerdictFilter(producer_system="arbiter", limit=10))
        assert verdicts[0].judgment.action == "approve"

    @pytest.mark.asyncio
    async def test_approve_threshold_boundary_reject(self, score_store, verdict_store):
        """Score just below threshold -> reject."""
        router = self._make_pipeline(score_store, verdict_store)
        score = _make_score(dimensions={"d1": 0.49})
        await self._run_single(router, score)

        verdicts = verdict_store.query(VerdictFilter(producer_system="arbiter", limit=10))
        assert verdicts[0].judgment.action == "reject"

    @pytest.mark.asyncio
    async def test_custom_threshold(self, score_store, verdict_store):
        """Custom approve_threshold should be respected."""
        router = self._make_pipeline(score_store, verdict_store, threshold=0.8)
        score = _make_score(dimensions={"d1": 0.75})
        await self._run_single(router, score)

        verdicts = verdict_store.query(VerdictFilter(producer_system="arbiter", limit=10))
        assert verdicts[0].judgment.action == "reject"  # 0.75 < 0.8

    @pytest.mark.asyncio
    async def test_no_verdict_when_store_is_none(self, score_store):
        """When verdict_store is None, pipeline works without creating verdicts."""
        router = self._make_pipeline(score_store, verdict_store=None)
        score = _make_score()
        await self._run_single(router, score)

        # Score still saved
        since = datetime.now(timezone.utc) - timedelta(hours=1)
        results = await score_store.get_scores("agent-a", since)
        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_verdict_reasoning_formatted(self, score_store, verdict_store):
        """Reasoning dict should be formatted as semicolon-separated string."""
        router = self._make_pipeline(score_store, verdict_store)
        score = _make_score(
            reasoning={"correctness": "Looks good", "style": "Needs work"}
        )
        await self._run_single(router, score)

        verdicts = verdict_store.query(VerdictFilter(producer_system="arbiter", limit=10))
        reasoning = verdicts[0].judgment.reasoning
        assert "correctness: Looks good" in reasoning
        assert "style: Needs work" in reasoning

    @pytest.mark.asyncio
    async def test_default_approve_threshold_value(self):
        assert DEFAULT_APPROVE_THRESHOLD == 0.5
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestVerdictEmission -v`
Expected: FAIL — `ImportError: cannot import name 'DEFAULT_APPROVE_THRESHOLD'` from `arbiter.pipeline.router`.

- [ ] **Step 3: Implement verdict creation in PipelineRouter**

In `arbiter/src/arbiter/pipeline/router.py`:

**Add imports** at the top (after existing imports):

```python
import asyncio
from verdict import create as verdict_create, VerdictStore as VerdictStoreBase
```

**Add module-level constant** before the class:

```python
DEFAULT_APPROVE_THRESHOLD = 0.5
```

**Update `__init__`** to accept verdict store and threshold. The full signature becomes:

```python
    def __init__(
        self,
        adapter: Adapter,
        evaluator: Evaluator,
        store: ScoreStore,
        tracker: TrendTracker,
        dimensions: list[str],
        governance: GovernanceEngine | None = None,
        detector: DegradationDetector | None = None,
        detection_window_days: int = 7,
        verdict_store: VerdictStoreBase | None = None,
        approve_threshold: float | None = None,
    ) -> None:
        self._adapter = adapter
        self._evaluator = evaluator
        self._store = store
        self._tracker = tracker
        self._dimensions = dimensions
        self._governance = governance
        self._detector = detector
        self._detection_window_days = detection_window_days
        self._verdict_store = verdict_store
        self._approve_threshold = (
            approve_threshold if approve_threshold is not None
            else DEFAULT_APPROVE_THRESHOLD
        )
```

**Update `run()`** — after `await self._store.save_score(score)` (line 49), add verdict creation:

```python
            # Create verdict if verdict store is configured
            if self._verdict_store is not None:
                verdict = await self._create_verdict(score)
                await asyncio.to_thread(self._verdict_store.put, verdict)
                await self._store.set_verdict_id(score.eval_id, verdict.id)
```

**Add `_create_verdict` helper** as a new method on PipelineRouter:

```python
    async def _create_verdict(self, score):
        """Map QualityScore to a verdict."""
        avg_score = sum(score.dimensions.values()) / len(score.dimensions)

        reasoning_summary = "; ".join(
            f"{name}: {reason}" for name, reason in score.reasoning.items()
        ) if score.reasoning else None

        return await asyncio.to_thread(
            verdict_create,
            subject={
                "type": "agent_output",
                "ref": score.task_id,
                "summary": f"Evaluation of {score.agent_name}: {score.task_id}",
                "agent": score.agent_name,
            },
            judgment={
                "action": (
                    "approve" if avg_score >= self._approve_threshold
                    else "reject"
                ),
                "confidence": score.confidence,
                "score": avg_score,
                "dimensions": score.dimensions,
                "reasoning": reasoning_summary,
            },
            producer={
                "system": "arbiter",
                "model": score.evaluator_model,
            },
            metadata={
                "cost_currency": score.cost_usd,
            },
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestVerdictEmission -v`
Expected: All 8 tests PASS.

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest -v`
Expected: All tests pass. Existing router tests do not pass `verdict_store`, so it defaults to `None` — no verdict ops.

- [ ] **Step 6: Commit**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure
git add src/arbiter/pipeline/router.py tests/test_verdict_integration.py
git commit -m "feat: emit verdicts from PipelineRouter after scoring"
```

---

## Chunk 3: Override to Verdict Resolution

### Task 5: Verdict resolution in save_override

**Files:**
- Modify: `arbiter/src/arbiter/store/sqlite.py:18-27` (init), `118-146` (save_override)
- Test: `arbiter/tests/test_verdict_integration.py` (append)

- [ ] **Step 1: Write the failing tests for override to resolution**

Append to `arbiter/tests/test_verdict_integration.py`:

```python
class TestOverrideResolution:
    """Tests for override to verdict resolution in SQLiteScoreStore."""

    @pytest_asyncio.fixture
    async def verdict_store(self, tmp_path):
        vs = SQLiteVerdictStore(str(tmp_path / "verdicts.db"))
        yield vs
        vs.close()

    @pytest_asyncio.fixture
    async def score_store(self, tmp_path, verdict_store):
        s = SQLiteScoreStore(tmp_path / "score.db", verdict_store=verdict_store)
        yield s
        s.close()

    @pytest.mark.asyncio
    async def test_override_resolves_verdict(self, score_store, verdict_store):
        """Override should resolve the linked verdict as overridden."""
        # Save score
        await score_store.save_score(_make_score())

        # Create and store verdict, link it
        verdict = await asyncio.to_thread(
            verdict_create,
            subject={"type": "agent_output", "ref": "t1", "agent": "agent-a",
                     "summary": "Test evaluation"},
            judgment={"action": "approve", "confidence": 0.85, "score": 0.8},
            producer={"system": "arbiter", "model": "test-model"},
        )
        await asyncio.to_thread(verdict_store.put, verdict)
        await score_store.set_verdict_id("e1", verdict.id)

        # Override
        await score_store.save_override("e1", {"correctness": 0.3}, "human-reviewer")

        # Verdict should be resolved
        resolved = verdict_store.get(verdict.id)
        assert resolved.outcome.status == "overridden"
        assert resolved.outcome.override.by == "human-reviewer"

    @pytest.mark.asyncio
    async def test_override_without_verdict_id_still_works(self, score_store):
        """Override on pre-integration data (no verdict_id) should work normally."""
        await score_store.save_score(_make_score())
        # No verdict_id set — simulates pre-integration data
        await score_store.save_override("e1", {"correctness": 0.3}, "reviewer")

        since = datetime.now(timezone.utc) - timedelta(hours=1)
        overrides = await score_store.get_overrides(since)
        assert len(overrides) == 1

    @pytest.mark.asyncio
    async def test_score_store_without_verdict_store(self, tmp_path):
        """SQLiteScoreStore without verdict_store should work identically to before."""
        s = SQLiteScoreStore(tmp_path / "test.db")
        try:
            await s.save_score(_make_score())
            await s.save_override("e1", {"correctness": 0.3}, "reviewer")
            since = datetime.now(timezone.utc) - timedelta(hours=1)
            overrides = await s.get_overrides(since)
            assert len(overrides) == 1
        finally:
            s.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestOverrideResolution -v`
Expected: FAIL — `SQLiteScoreStore.__init__() got an unexpected keyword argument 'verdict_store'`.

- [ ] **Step 3: Implement verdict store injection and resolution in save_override**

In `arbiter/src/arbiter/store/sqlite.py`:

**Add verdict import** at the top:

```python
from verdict import VerdictStore as VerdictStoreBase
```

**Update `__init__`** to accept optional verdict store:

```python
    def __init__(self, db_path: str | Path, verdict_store: VerdictStoreBase | None = None) -> None:
        self._db_path = Path(db_path)
        self._conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._lock = threading.Lock()
        self._verdict_store = verdict_store
        self._apply_schema()
        self._migrate_verdict_id()
```

**Replace `_save_override_sync`** with this version that looks up verdict_id and resolves:

```python
    def _save_override_sync(
        self, eval_id: str, corrected_dimensions: dict[str, float], corrector: str
    ) -> None:
        verdict_id = None
        with self._lock:
            # Verify eval_id exists
            exists = self._conn.execute(
                "SELECT 1 FROM evaluations WHERE eval_id = ?", (eval_id,)
            ).fetchone()
            if not exists:
                raise ValueError(
                    f"Cannot override non-existent evaluation: {eval_id}"
                )

            for dim_name, corrected_score in corrected_dimensions.items():
                row = self._conn.execute(
                    "SELECT score FROM dimension_scores "
                    "WHERE eval_id = ? AND dimension = ?",
                    (eval_id, dim_name),
                ).fetchone()
                original_score = row["score"] if row else 0.0
                self._conn.execute(
                    "INSERT INTO overrides "
                    "(override_id, eval_id, dimension, original_score, "
                    "corrected_score, corrector) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        str(uuid.uuid4()),
                        eval_id,
                        dim_name,
                        original_score,
                        corrected_score,
                        corrector,
                    ),
                )
                emit_override_event(
                    eval_id, dim_name, original_score,
                    corrected_score, corrector,
                )
            self._conn.commit()

            # Look up verdict_id for resolution
            if self._verdict_store is not None:
                verdict_row = self._conn.execute(
                    "SELECT verdict_id FROM evaluations WHERE eval_id = ?",
                    (eval_id,),
                ).fetchone()
                verdict_id = (
                    verdict_row["verdict_id"] if verdict_row else None
                )

        # Resolve linked verdict outside the lock (verdict store has its own)
        if self._verdict_store is not None and verdict_id is not None:
            self._verdict_store.resolve(
                verdict_id, "overridden", override={"by": corrector},
            )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestOverrideResolution -v`
Expected: All 3 tests PASS.

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest -v`
Expected: All tests pass. Existing tests create `SQLiteScoreStore(path)` without `verdict_store` — defaults to `None`, no verdict ops.

- [ ] **Step 6: Commit**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure
git add src/arbiter/store/sqlite.py tests/test_verdict_integration.py
git commit -m "feat: resolve linked verdict on override in SQLiteScoreStore"
```

---

## Chunk 4: VerdictCalibration + CLI

### Task 6: VerdictCalibration class

**Files:**
- Create: `arbiter/src/arbiter/calibration/verdict_calibration.py`
- Test: `arbiter/tests/test_verdict_integration.py` (append)

- [ ] **Step 1: Write the failing tests for VerdictCalibration**

Append to `arbiter/tests/test_verdict_integration.py`:

```python
from arbiter.calibration.verdict_calibration import VerdictCalibration


class TestVerdictCalibration:
    """Tests for VerdictCalibration — system-wide accuracy via verdict store."""

    @pytest_asyncio.fixture
    async def verdict_store(self, tmp_path):
        vs = SQLiteVerdictStore(str(tmp_path / "verdicts.db"))
        yield vs
        vs.close()

    def _seed_verdicts(self, verdict_store, count=5, overridden_count=1):
        """Create verdicts: confirmed + overridden to given counts."""
        for i in range(count):
            v = verdict_create(
                subject={
                    "type": "agent_output",
                    "ref": f"task-{i}",
                    "agent": "agent-a",
                    "summary": f"Test evaluation {i}",
                },
                judgment={
                    "action": "approve",
                    "confidence": 0.9,
                    "score": 0.8,
                },
                producer={"system": "arbiter", "model": "test-model"},
            )
            verdict_store.put(v)
            if i < overridden_count:
                verdict_store.resolve(
                    v.id, "overridden", override={"by": "human"},
                )
            else:
                verdict_store.resolve(v.id, "confirmed")

    @pytest.mark.asyncio
    async def test_check_returns_accuracy_report(self, verdict_store):
        self._seed_verdicts(verdict_store, count=5, overridden_count=1)
        cal = VerdictCalibration(verdict_store)
        report = await cal.check()

        assert report.total == 5
        assert report.total_resolved == 5
        # 4 confirmed / 5 resolved = 0.8
        assert report.confirmation_rate == pytest.approx(0.8)
        # 1 overridden / 5 resolved = 0.2
        assert report.override_rate == pytest.approx(0.2)

    @pytest.mark.asyncio
    async def test_check_empty_store(self, verdict_store):
        cal = VerdictCalibration(verdict_store)
        report = await cal.check()

        assert report.total == 0
        assert report.total_resolved == 0
        assert report.confirmation_rate == 0.0
        assert report.override_rate == 0.0

    @pytest.mark.asyncio
    async def test_check_custom_window(self, verdict_store):
        self._seed_verdicts(verdict_store, count=3, overridden_count=0)
        cal = VerdictCalibration(verdict_store)
        report = await cal.check(window_days=1)

        assert report.total == 3
        assert report.confirmation_rate == pytest.approx(1.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestVerdictCalibration -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'arbiter.calibration.verdict_calibration'`.

- [ ] **Step 3: Implement VerdictCalibration**

Create `arbiter/src/arbiter/calibration/verdict_calibration.py`:

```python
"""Verdict-based calibration — system-wide accuracy via verdict store.

Strangler fig: runs alongside JudgmentSLOChecker, does not replace it.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from verdict import AccuracyFilter, AccuracyReport, VerdictStore


class VerdictCalibration:
    """System-wide accuracy for all arbiter verdicts.

    Note: this is NOT per-agent. AccuracyFilter does not support
    filtering by subject.agent. Per-agent accuracy would require
    extending the verdict library's AccuracyFilter (Phase 2+).
    For Phase 1, system-wide accuracy is sufficient for Demo 1.
    """

    def __init__(self, verdict_store: VerdictStore) -> None:
        self._store = verdict_store

    async def check(self, window_days: int = 30) -> AccuracyReport:
        from_time = datetime.now(timezone.utc) - timedelta(days=window_days)
        return await asyncio.to_thread(
            self._store.accuracy,
            AccuracyFilter(producer_system="arbiter", from_time=from_time),
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestVerdictCalibration -v`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure
git add src/arbiter/calibration/verdict_calibration.py tests/test_verdict_integration.py
git commit -m "feat: add VerdictCalibration strangler fig for system-wide accuracy"
```

---

### Task 7: Add --verdict flag to calibrate CLI subcommand

**Files:**
- Modify: `arbiter/src/arbiter/cli.py:199-226` (cmd_calibrate), `324-326` (calibrate parser)
- Test: `arbiter/tests/test_verdict_integration.py` (append)

- [ ] **Step 1: Write the failing tests for --verdict CLI flag**

Append to `arbiter/tests/test_verdict_integration.py`:

```python
import argparse as _argparse
import io
import json
import contextlib

from arbiter.cli import cmd_calibrate


class TestCalibrateVerdictFlag:
    """Tests for --verdict flag on calibrate subcommand."""

    @pytest_asyncio.fixture
    async def verdict_db(self, tmp_path):
        """Create a seeded verdict store and return the db path."""
        db_path = str(tmp_path / "verdicts.db")
        vs = SQLiteVerdictStore(db_path)
        # Seed: 4 confirmed, 1 overridden
        for i in range(5):
            v = verdict_create(
                subject={
                    "type": "agent_output",
                    "ref": f"t-{i}",
                    "agent": "a",
                    "summary": f"Test {i}",
                },
                judgment={
                    "action": "approve",
                    "confidence": 0.9,
                    "score": 0.8,
                },
                producer={"system": "arbiter", "model": "test"},
            )
            vs.put(v)
            if i == 0:
                vs.resolve(v.id, "overridden", override={"by": "human"})
            else:
                vs.resolve(v.id, "confirmed")
        vs.close()
        return db_path

    def _make_config_file(self, tmp_path, verdict_store_path):
        """Write a minimal arbiter.yaml with verdict config."""
        cfg = tmp_path / "arbiter.yaml"
        cfg.write_text(
            f"evaluator:\n  model: test\n"
            f"store:\n  path: {tmp_path / 'arbiter.db'}\n"
            f"verdict:\n  store:\n    path: {verdict_store_path}\n"
        )
        return cfg

    def test_calibrate_verdict_flag_prints_report(self, tmp_path, verdict_db):
        cfg_file = self._make_config_file(tmp_path, verdict_db)

        args = _argparse.Namespace(
            config=cfg_file,
            agent=None,
            window_days=30,
            verdict=True,
        )

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            cmd_calibrate(args)
        output = buf.getvalue()
        result = json.loads(output)

        assert result["total"] == 5
        assert result["total_resolved"] == 5
        assert result["confirmation_rate"] == pytest.approx(0.8)
        assert result["override_rate"] == pytest.approx(0.2)

    def test_calibrate_verdict_flag_no_config_errors(self, tmp_path):
        """--verdict without verdict config section should print error."""
        cfg = tmp_path / "arbiter.yaml"
        cfg.write_text("evaluator:\n  model: test\n")
        args = _argparse.Namespace(
            config=cfg,
            agent=None,
            window_days=30,
            verdict=True,
        )

        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            with pytest.raises(SystemExit):
                cmd_calibrate(args)
        assert "verdict" in buf.getvalue().lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestCalibrateVerdictFlag -v`
Expected: FAIL — `args.verdict` attribute error or similar.

- [ ] **Step 3: Implement --verdict flag in CLI**

In `arbiter/src/arbiter/cli.py`:

**Add `--verdict` flag to calibrate parser** — after the `--agent` argument on the calibrate subparser (after line 326):

```python
    cal_parser.add_argument(
        "--verdict", action="store_true", default=False,
        help="Use verdict-based calibration (system-wide)",
    )
```

**Replace `cmd_calibrate`** with this version that handles the `--verdict` flag:

```python
def cmd_calibrate(args: argparse.Namespace) -> None:
    """Run calibration report."""
    config = _load_config(args)

    if getattr(args, "verdict", False):
        # Verdict-based calibration (system-wide)
        if config.verdict is None:
            print(
                "Error: --verdict requires a 'verdict' section in arbiter.yaml",
                file=sys.stderr,
            )
            sys.exit(1)

        from verdict import SQLiteVerdictStore
        from arbiter.calibration.verdict_calibration import VerdictCalibration

        verdict_store = SQLiteVerdictStore(config.verdict.store_path)
        cal = VerdictCalibration(verdict_store)

        async def _run():
            return await cal.check(window_days=args.window_days)

        report = asyncio.run(_run())
        verdict_store.close()
        result = {
            "producer": report.producer,
            "total": report.total,
            "total_resolved": report.total_resolved,
            "confirmation_rate": report.confirmation_rate,
            "override_rate": report.override_rate,
            "partial_rate": report.partial_rate,
            "pending_rate": report.pending_rate,
            "mean_confidence_on_confirmed": report.mean_confidence_on_confirmed,
            "mean_confidence_on_overridden": report.mean_confidence_on_overridden,
        }
        print(json.dumps(result, indent=2))
        return

    store = _build_store(config)

    async def _run():
        if args.agent:
            from arbiter.calibration.slos import JudgmentSLOChecker
            from arbiter.manifest import JudgmentSLO, load_manifest

            slo = None
            for ac in config.agents:
                if ac.name == args.agent and ac.manifest:
                    slo = load_manifest(Path(ac.manifest))
                    break

            checker = JudgmentSLOChecker(store, slo=slo)
            report = await checker.check(args.agent, window_days=args.window_days)
            return asdict(report)
        else:
            from arbiter.calibration.loop import OverrideCalibration

            cal = OverrideCalibration(store)
            report = await cal.calibrate(window_days=args.window_days)
            return asdict(report)

    result = asyncio.run(_run())
    print(json.dumps(result, indent=2))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestCalibrateVerdictFlag -v`
Expected: All 2 tests PASS.

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest -v`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure
git add src/arbiter/cli.py tests/test_verdict_integration.py
git commit -m "feat: add --verdict flag to calibrate CLI subcommand"
```

---

## Chunk 5: End-to-End Integration + CLI Wiring

### Task 8: End-to-end integration test (Demo 1 path)

**Files:**
- Test: `arbiter/tests/test_verdict_integration.py` (append)

This test exercises the full Demo 1 flow: score -> verdict stored -> override -> verdict resolved -> accuracy reflects the change.

- [ ] **Step 1: Write the end-to-end integration test**

Append to `arbiter/tests/test_verdict_integration.py`:

```python
class TestEndToEndFeedbackLoop:
    """End-to-end test: score -> verdict -> override -> resolution -> accuracy."""

    @pytest_asyncio.fixture
    async def stores(self, tmp_path):
        verdict_store = SQLiteVerdictStore(str(tmp_path / "verdicts.db"))
        score_store = SQLiteScoreStore(
            tmp_path / "scores.db", verdict_store=verdict_store,
        )
        yield score_store, verdict_store
        score_store.close()
        verdict_store.close()

    @pytest.mark.asyncio
    async def test_full_feedback_loop(self, stores):
        score_store, verdict_store = stores

        # 1. Three agent outputs scored through the pipeline
        scores = [
            _make_score(
                eval_id="e1", agent="coder", task="pr-101",
                dimensions={"correctness": 0.9, "safety": 0.8},
                confidence=0.9,
            ),
            _make_score(
                eval_id="e2", agent="coder", task="pr-102",
                dimensions={"correctness": 0.7, "safety": 0.6},
                confidence=0.7,
            ),
            _make_score(
                eval_id="e3", agent="coder", task="pr-103",
                dimensions={"correctness": 0.3, "safety": 0.2},
                confidence=0.5,
            ),
        ]

        router = PipelineRouter(
            adapter=AsyncMock(),
            evaluator=AsyncMock(),
            store=score_store,
            tracker=AsyncMock(),
            dimensions=["correctness", "safety"],
            verdict_store=verdict_store,
        )

        for score in scores:
            output = MagicMock()
            output.agent_name = score.agent_name

            async def _receive(o=output):
                yield o

            router._adapter.receive = _receive
            router._evaluator.evaluate = AsyncMock(return_value=score)
            await router.run()

        # 2. Verify three verdicts exist
        verdicts = verdict_store.query(
            VerdictFilter(producer_system="arbiter", limit=0),
        )
        assert len(verdicts) == 3

        # e1 avg=0.85 -> approve, e2 avg=0.65 -> approve, e3 avg=0.25 -> reject
        actions = sorted([v.judgment.action for v in verdicts])
        assert actions == ["approve", "approve", "reject"]

        # 3. Check accuracy before any overrides — all pending
        report_before = verdict_store.accuracy(
            AccuracyFilter(producer_system="arbiter"),
        )
        assert report_before.total == 3
        assert report_before.total_resolved == 0
        assert report_before.pending_rate == pytest.approx(1.0)

        # 4. Override e1 — human disagrees with the approve
        await score_store.save_override(
            "e1", {"correctness": 0.3}, "senior-reviewer",
        )

        # 5. Confirm e2 and e3 manually (resolve their verdicts)
        for v in verdicts:
            if v.subject.ref in ("pr-102", "pr-103"):
                verdict_store.resolve(v.id, "confirmed")

        # 6. Check accuracy after resolutions
        report_after = verdict_store.accuracy(
            AccuracyFilter(producer_system="arbiter"),
        )
        assert report_after.total == 3
        assert report_after.total_resolved == 3
        # 2 confirmed, 1 overridden
        assert report_after.confirmation_rate == pytest.approx(2 / 3, abs=0.01)
        assert report_after.override_rate == pytest.approx(1 / 3, abs=0.01)

        # 7. VerdictCalibration should report the same
        cal = VerdictCalibration(verdict_store)
        cal_report = await cal.check()
        assert cal_report.total_resolved == 3
        assert cal_report.override_rate == pytest.approx(1 / 3, abs=0.01)
```

- [ ] **Step 2: Run the end-to-end test**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestEndToEndFeedbackLoop -v`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest -v`
Expected: All tests pass — existing + all new verdict integration tests.

- [ ] **Step 4: Commit**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure
git add tests/test_verdict_integration.py
git commit -m "test: add end-to-end feedback loop integration test (Demo 1)"
```

---

### Task 9: Wire verdict store in CLI _build_pipeline

**Files:**
- Modify: `arbiter/src/arbiter/cli.py:92-123` (_build_pipeline only; _build_store unchanged)

- [ ] **Step 1: Write the failing test for CLI wiring**

Append to `arbiter/tests/test_verdict_integration.py`:

```python
from arbiter.cli import _build_pipeline


class TestCLIVerdictWiring:
    """Tests that CLI wires verdict store when config has verdict section."""

    def test_build_pipeline_includes_verdict_store(self, tmp_path):
        from arbiter.config import ArbiterConfig, VerdictConfig

        config = ArbiterConfig(
            verdict=VerdictConfig(
                store_path=str(tmp_path / "verdicts.db"),
            ),
        )
        config.store.path = str(tmp_path / "arbiter.db")

        router = _build_pipeline(config)
        assert router._verdict_store is not None

    def test_build_pipeline_no_verdict_config(self, tmp_path):
        from arbiter.config import ArbiterConfig

        config = ArbiterConfig()
        config.store.path = str(tmp_path / "arbiter.db")

        router = _build_pipeline(config)
        assert router._verdict_store is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestCLIVerdictWiring -v`
Expected: FAIL — `router._verdict_store` is always None because `_build_pipeline` does not create it.

- [ ] **Step 3: Wire verdict store in _build_pipeline**

In `arbiter/src/arbiter/cli.py`:

**Leave `_build_store` unchanged** — it is used by other CLI commands (status, overrides, governance) that don't need verdict integration. Only `_build_pipeline` needs the verdict store.

**Update `_build_pipeline`** (around line 92) to create verdict store and share it between score store and router:

```python
def _build_pipeline(config: ArbiterConfig):
    from arbiter.detection.detector import SLOThresholds, ThresholdDetector
    from arbiter.governance.engine import ErrorBudgetGovernance
    from arbiter.pipeline.router import PipelineRouter
    from arbiter.store.sqlite import SQLiteScoreStore

    # Build verdict store if configured
    verdict_store = None
    if config.verdict is not None:
        from verdict import SQLiteVerdictStore
        verdict_store = SQLiteVerdictStore(config.verdict.store_path)

    # Share the same verdict store between score store (for override resolution)
    # and router (for verdict creation)
    store = SQLiteScoreStore(config.store.path, verdict_store=verdict_store)
    tracker = _build_tracker(store)
    evaluator = _build_evaluator(config)
    governance = ErrorBudgetGovernance(
        store=store,
        tracker=tracker,
        window_days=config.governance.error_budget_window_days,
        threshold=config.governance.error_budget_threshold,
        model=config.evaluator.model,
    )
    thresholds = SLOThresholds(
        max_reversal_rate=config.detection.max_reversal_rate,
        min_dimension_scores=config.detection.min_dimension_scores,
        min_confidence=config.detection.min_confidence,
    )
    detector = ThresholdDetector(thresholds)
    adapter = _build_adapter(config)

    return PipelineRouter(
        adapter=adapter,
        evaluator=evaluator,
        store=store,
        tracker=tracker,
        dimensions=config.dimensions,
        governance=governance,
        detector=detector,
        verdict_store=verdict_store,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest tests/test_verdict_integration.py::TestCLIVerdictWiring -v`
Expected: All 2 tests PASS.

- [ ] **Step 5: Run the full test suite one final time**

Run: `cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure && /opt/homebrew/bin/python3.12 -m pytest -v`
Expected: ALL tests pass — existing arbiter tests + all new verdict integration tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure
git add src/arbiter/cli.py tests/test_verdict_integration.py
git commit -m "feat: wire verdict store through CLI build pipeline"
```

---

### Task 10: Update IMPLEMENTATION-PLAN.md and close bead

**Files:**
- Modify: `opensrm/IMPLEMENTATION-PLAN.md`

- [ ] **Step 1: Mark Phase 1 as complete in IMPLEMENTATION-PLAN.md**

Update the Phase 1 section status to complete with date 2026-03-13. Update accept criteria to reflect test count.

- [ ] **Step 2: Close the Phase 1 bead**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/opensrm
# Update beads database — mark phase 1 task(s) as done
```

- [ ] **Step 3: Commit both repos**

```bash
cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/nthlayer-measure
git add -A && git commit -m "feat: Phase 1 Arbiter Verdict Integration complete"

cd /Users/robfox/Documents/GitHub/opensrm-ecosystem/opensrm
git add IMPLEMENTATION-PLAN.md .beads/
git commit -m "docs: mark Phase 1 Arbiter Verdict Integration complete"
```

---

## Test Summary

| Test Class | Tests | What It Covers |
|-----------|-------|----------------|
| `TestVerdictConfig` | 6 | VerdictConfig defaults, custom paths, ArbiterConfig default None, YAML parsing with/without verdict section |
| `TestSchemaMigration` | 5 | verdict_id column exists, null by default, set_verdict_id works, unknown id raises, idempotent migration |
| `TestVerdictEmission` | 8 | Verdict created after scoring, verdict_id on evaluations, threshold boundary approve/reject, custom threshold, no verdict when store None, reasoning formatted, constant value |
| `TestOverrideResolution` | 3 | Override resolves verdict, override without verdict_id works, store without verdict_store works |
| `TestVerdictCalibration` | 3 | Accuracy report correct, empty store zeros, custom window |
| `TestCalibrateVerdictFlag` | 2 | --verdict prints report, --verdict without config errors |
| `TestEndToEndFeedbackLoop` | 1 | Full Demo 1 path: score -> verdict -> override -> resolve -> accuracy |
| `TestCLIVerdictWiring` | 2 | Pipeline includes verdict store when configured, None when not |
| **Total new tests** | **30** | |

All existing arbiter tests remain unchanged and pass — verdict store is optional everywhere.

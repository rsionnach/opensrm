# Phase 1: Arbiter Verdict Integration — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Prerequisite:** Phase 0 complete (verdict library + CLI, 135 tests passing)
**Goal:** Demo 1 — "The Feedback Loop": evaluate agent output, verdict stored, override it, `verdict accuracy --producer arbiter` reflects the change.

---

## Context

Arbiter evaluates AI agent output using a model, stores quality scores in SQLite, and supports human overrides. Currently this is a closed loop — scores and overrides live in arbiter's own store with no cross-component visibility.

The verdict library provides a shared substrate for recording AI decisions and measuring their correctness. Integrating verdict into arbiter means every evaluation becomes a queryable verdict, every override becomes a verdict resolution, and accuracy is measurable via `verdict accuracy --producer arbiter`.

This integration is **additive** — the existing ScoreStore, calibration, and governance systems remain unchanged.

---

## Architecture

### Integration Point: PipelineRouter

The `PipelineRouter.run()` method is the orchestration hub. Verdict creation slots into the existing flow:

```
adapter.receive() → evaluator.evaluate() → store.save_score()
    → verdict.create() + verdict_store.put()          ← NEW
    → store.set_verdict_id(eval_id, verdict.id)       ← NEW (UPDATE back-link)
    → detector.check() → governance.check_agent()
```

**Sequence for verdict_id mapping:** `save_score()` runs first (INSERT without verdict_id). Then the router creates the verdict and calls a new `set_verdict_id(eval_id, verdict_id)` method on the store to UPDATE the evaluations row. This avoids changing `save_score()`'s signature.

Verdict resolution happens inside `save_override()`:

```
store.save_override(eval_id, corrected_dims, corrector)
    → look up verdict_id from evaluations table        ← NEW
    → verdict_store.resolve(verdict_id, "overridden")  ← NEW
```

### Async/Sync Boundary

The verdict library is synchronous. Arbiter is async. All verdict calls are wrapped in `asyncio.to_thread()`, matching the pattern `SQLiteScoreStore` already uses for its own SQLite operations.

---

## QualityScore → Verdict Mapping

```python
DEFAULT_APPROVE_THRESHOLD = 0.5  # module-level constant in router.py

# QualityScore fields used:
#   .eval_id (str), .agent_name (str), .task_id (str)
#   .evaluator_model (str), .confidence (float), .cost_usd (float)
#   .dimensions (dict[str, float]) — dimension name → score
#   .reasoning (dict[str, str]) — dimension name → reasoning text

avg_score = sum(score.dimensions.values()) / len(score.dimensions)

# Format per-dimension reasoning as a single string for verdict
reasoning_summary = "; ".join(
    f"{name}: {reason}" for name, reason in score.reasoning.items()
) if score.reasoning else None

verdict = create(
    subject={
        "type": "agent_output",
        "ref": score.task_id,
        "summary": f"Evaluation of {score.agent_name}: {score.task_id}",
        "agent": score.agent_name,
    },
    judgment={
        "action": "approve" if avg_score >= DEFAULT_APPROVE_THRESHOLD else "reject",
        "confidence": score.confidence,
        "score": avg_score,
        "dimensions": score.dimensions,  # dict[str, float] — directly compatible
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

- `avg_score`: mean of `score.dimensions` values (dict[str, float])
- `action`: `approve` if avg_score >= `DEFAULT_APPROVE_THRESHOLD` (0.5), else `reject`
- `subject.type`: always `"agent_output"` (arbiter evaluates agent output)
- `producer.system`: always `"arbiter"`

---

## Override → Verdict Resolution

When `save_override()` is called:

1. Existing behavior runs unchanged (insert override row)
2. Look up `verdict_id` from `evaluations` table using `eval_id`
3. If `verdict_id` exists, call `verdict_store.resolve(verdict_id, "overridden", override={"by": corrector})`
4. If `verdict_id` is `None` (pre-integration evaluation), skip silently

The verdict store is passed into `SQLiteScoreStore` at construction as an optional parameter. When `None`, no verdict operations occur.

---

## Configuration

New optional section in `arbiter.yaml`:

```yaml
verdict:
  store:
    path: verdicts.db
```

In `config.py`:

```python
@dataclass
class VerdictConfig:
    store_path: str = "verdicts.db"
```

`ArbiterConfig` gains `verdict: VerdictConfig | None = None`. When the `verdict` section is absent from config, no verdict store is created and all verdict operations are skipped. The system behaves identically to pre-integration.

---

## Schema Migration

The `evaluations` table gains one nullable column:

```sql
ALTER TABLE evaluations ADD COLUMN verdict_id TEXT;
```

- Nullable: existing rows have no verdict, and verdict-disabled deployments never write one
- Migration runs at `SQLiteScoreStore.__init__()` with a targeted try/except:
  ```python
  try:
      conn.execute("ALTER TABLE evaluations ADD COLUMN verdict_id TEXT")
  except sqlite3.OperationalError as e:
      if "duplicate column" not in str(e):
          raise
  ```
- No index on `verdict_id` — only used in point lookups during `save_override()` with known `eval_id`

---

## Parallel Verdict-Based Calibration

New file: `src/arbiter/calibration/verdict_calibration.py`

```python
class VerdictCalibration:
    def __init__(self, verdict_store: SQLiteVerdictStore):
        self._store = verdict_store

    async def check(self, window_days: int = 30) -> AccuracyReport:
        """System-wide accuracy for all arbiter verdicts.

        Note: this is NOT per-agent. AccuracyFilter does not support
        filtering by subject.agent. Per-agent accuracy would require
        extending the verdict library's AccuracyFilter (Phase 2+).
        For Phase 1, system-wide accuracy is sufficient for Demo 1.
        """
        from_time = datetime.now(timezone.utc) - timedelta(days=window_days)
        return await asyncio.to_thread(
            self._store.accuracy,
            AccuracyFilter(producer_system="arbiter", from_time=from_time),
        )
```

This is a strangler fig — runs alongside `JudgmentSLOChecker`, does not replace it. The CLI `calibrate` subcommand gains an optional `--verdict` flag to print the verdict-based report.

**Scope difference:** `JudgmentSLOChecker.check()` is per-agent. `VerdictCalibration.check()` is system-wide (all arbiter verdicts). The metrics correspond at the system level:
- `AccuracyReport.confirmation_rate` ≈ `1 - JudgmentSLOReport.reversal_rate` (aggregated)
- `AccuracyReport.override_rate` ≈ `JudgmentSLOReport.reversal_rate` (aggregated)

---

## Dependency

Add to `arbiter/pyproject.toml`:

```toml
dependencies = [
    "pyyaml>=6.0",
    "anthropic>=0.39.0",
    "verdict @ file:///../nthlayer-learn/lib/python",
]
```

Path-based dependency per IMPLEMENTATION-PLAN.md. Verdict API is frozen after Phase 0.

---

## Files Changed

| File | Change |
|------|--------|
| `pyproject.toml` | Add verdict path dependency |
| `src/arbiter/config.py` | Add `VerdictConfig` dataclass, optional `verdict` on `ArbiterConfig` |
| `src/arbiter/pipeline/router.py` | Add `DEFAULT_APPROVE_THRESHOLD`, verdict creation after `save_score()`, accept verdict store |
| `src/arbiter/store/sqlite.py` | Accept optional verdict store at `__init__`, `ALTER TABLE` migration, verdict_id UPDATE after verdict creation, verdict resolution in `save_override()` |
| `src/arbiter/cli.py` | Add `--verdict` flag to `calibrate` subcommand |

| File | Created |
|------|---------|
| `src/arbiter/calibration/verdict_calibration.py` | `VerdictCalibration` class |
| `tests/test_verdict_integration.py` | All verdict integration tests |

## Files Unchanged

- `src/arbiter/pipeline/evaluator.py` — evaluation logic untouched
- `src/arbiter/store/protocol.py` — ScoreStore protocol unchanged; verdict store is an internal concern of SQLiteScoreStore, not part of the protocol
- `src/arbiter/calibration/slos.py` — existing checker stays as-is
- `src/arbiter/calibration/loop.py` — existing MAE calibration stays
- All existing test files — no modifications

---

## Testing

Single new test file: `tests/test_verdict_integration.py`

### Verdict emission (Phase 1.1)
- Evaluate agent output → verdict created in verdict store with correct mapping
- `verdict_id` written to evaluations table
- `DEFAULT_APPROVE_THRESHOLD` boundary: score 0.5 → approve, score 0.49 → reject
- Verdict not created when verdict config is `None` (backwards compat)

### Override → resolution (Phase 1.2)
- Evaluate → override → verdict resolved with `status="overridden"`, corrector in `override.by`
- Override on pre-verdict evaluation (no verdict_id) → no crash, override still works
- Verdict outcome fields populated after resolution

### Parallel calibration (Phase 1.3)
- Seed store with evaluations + overrides → `VerdictCalibration.check()` returns correct `AccuracyReport`
- Compare against `JudgmentSLOChecker` — rates should correspond
- Empty store → graceful zeros

### Existing tests
All must continue passing unchanged. Verdict store is optional, so existing fixtures work without it.

---

## Accept Criteria

Run Arbiter against sample agent output. Verdict is stored. Override it. Run `verdict accuracy --producer arbiter` — the override is reflected in the accuracy report. This is **Demo 1: "The Feedback Loop"**.

All existing arbiter tests pass. All new verdict integration tests pass.

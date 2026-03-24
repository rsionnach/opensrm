# OpenSRM Ecosystem — Cohesive Implementation Plan (v2)

## Context

Six spec documents define the full ecosystem vision. Currently: verdict Python library (core + MemoryStore), nthlayer-measure (full pipeline), and NthLayer (CLI) have working code. nthlayer-correlate and nthlayer-respond are architecture-only. This plan reconciles 5 conflicting implementation orderings, flags critical issues, and is optimised for a solo developer working evenings/weekends who is also building a portfolio for Reliability Architect / Observability roles.

---

## Staff Engineer Review — Issues Found

### R1. Timeline is Fiction (BLOCKING)

**Issue:** 11-17 weeks assumes full-time. For evenings/weekends (~10-15 hrs/week), Phase 2 (nthlayer-correlate from scratch, 8 sub-phases) alone is 8-12 weeks, and Phase 3 (nthlayer-respond from scratch) is 6-10 weeks. Realistic total: 20-35 weeks.

**Resolution:** Reframe around demo milestones, not completion. Define three checkpoints where the project is demonstrably valuable. Reorder to front-load portfolio impact.

### R2. No Demo Milestone Defined (SIGNIFICANT)

**Issue:** The plan never answers "what does someone run end-to-end?" At Phase 0 completion, you have a library with no CLI. Nobody runs `pytest` to evaluate a portfolio project.

**Resolution:** Define Demo 1 explicitly: Phase 0 + Phase 1 + a minimal verdict CLI (`nthlayer-learn accuracy`). Run the nthlayer-measure, evaluate agent output, override it, query accuracy. This demonstrates the core feedback loop thesis in ~3-4 weekends.

### R3. OTel Emission Built Too Early (SIGNIFICANT)

**Issue:** Phase 0.3 builds OTel emission before any consumer exists. NthLayer doesn't need live OTel for demos — it queries Prometheus. Without Prometheus + OTel Collector infrastructure, this code is untestable and unusable.

**Resolution:** Move OTel emission to Phase 4 (ecosystem hardening). It's a production concern, not a demo concern. The verdict store queries work without OTel for all demo and portfolio purposes.

### R4. Shared SQLite with WAL Mode is Fine for Tier 1 (SIGNIFICANT)

**Issue:** The per-component store split (`verdicts-arbiter.db`, `verdicts-sitrep.db`) breaks cross-component lineage queries — nthlayer-respond can't traverse a lineage chain that spans nthlayer-correlate and nthlayer-respond stores. The `connect_readonly()` pattern is SQLite-specific and won't translate to PostgreSQL. This is premature optimization for a project with no real concurrent writers.

**Resolution:** Single shared `verdicts.db` with WAL mode (`PRAGMA journal_mode=WAL`). WAL allows concurrent readers + one writer. Write contention in a demo/portfolio context is effectively zero. If production contention materialises, upgrade to PostgreSQL (the interface abstracts the backend). The per-component split was solving a problem that doesn't exist yet.

### R5. Verdict CLI in Phase 5 is Wrong (SIGNIFICANT)

**Issue:** `nthlayer-learn accuracy --producer arbiter` is a single-file CLI (~80 lines) that makes the entire feedback loop visible. Burying it in Phase 5 ("Quality of Life") means Phase 0+1 has no user-facing artifact.

**Resolution:** Move verdict CLI into Phase 0. Just `nthlayer-learn accuracy` and `nthlayer-learn list` — two subcommands. This is the primary demo interface.

### R6. Scenario Fixtures Must Precede nthlayer-correlate Code (SIGNIFICANT)

**Issue:** Phase 2 builds nthlayer-correlate then Phase 4.4 adds scenario replay. But HOW do you test nthlayer-correlate without scenarios? Each nthlayer-correlate sub-phase needs synthetic test data. Building nthlayer-correlate then testing is backwards.

**Resolution:** Phase 2.0 (before any nthlayer-correlate code) creates 3-5 synthetic scenario fixtures. Each subsequent sub-phase tests against them. Replay is not a Phase 4 bolt-on — it's the test harness for Phase 2.

### R7. Phase 4 Items Are Mostly YAGNI (MINOR)

**Issue:** Contract enforcement library (4.1), staleness policy in NthLayer (4.2), and tiered evaluation (4.3) are production hardening features. For portfolio purposes, they add complexity without visible value.

**Resolution:** Move 4.1/4.2/4.3 to Phase 5. Keep scenario replay (now integrated into Phase 2) and documentation updates.

### R8. No Versioning Strategy for 4 Packages (SIGNIFICANT)

**Issue:** Four separate git repos all depending on `verdict`. When verdict's API changes, what breaks?

**Resolution:** For the portfolio phase: path-based dependencies (`pip install -e ../verdicts`). Treat the verdict library API as frozen after Phase 0. Any breaking changes go through deprecation. Formal versioning (semver + compatibility tests) is a Phase 5 concern that only matters with external users.

### R9. Verdict Mutability Window Is Closing (MINOR)

**Issue:** Once the nthlayer-measure integrates with mutable verdicts in Phase 1, switching to frozen dataclasses becomes a multi-repo breaking change. The decision window is Phase 0.

**Resolution:** Accept mutability. For this codebase, the `store.put()` / `store.get()` boundary provides effective immutability — the store owns the object, callers get copies (in SQLite, always a new object on `get()`). Document this. Frozen dataclasses add `dataclasses.replace()` boilerplate everywhere for no measurable benefit in a single-developer project.

### R10. nthlayer-correlate Pre-Correlation Is the Portfolio Centrepiece (SIGNIFICANT)

**Issue:** nthlayer-correlate's pre-correlation engine (the transport/judgment split that makes AI cost-viable at scale) is the most architecturally interesting part of the ecosystem for a Reliability Architect role. But it's buried as "Phase 2.4" with no visibility.

**Resolution:** The pre-correlation engine (Phase 2.1-2.5) should be explicitly called out as a demo milestone (Demo 2). It demonstrates: FTS5 indexing, temporal/topology grouping, token budget management, and the ZFC transport/judgment boundary. All deterministic, all testable, all demonstrable WITHOUT a model API key.

### R11. 74 Existing Tests Are Actually Good (MINOR)

**Issue:** The review asked whether the 74 verdict tests are "just happy-path." Having examined them: they test error cases (invalid status, double resolve, missing fields), edge cases (NaN confidence, empty store, limit=0), serialization roundtrips, and lineage traversal. They're solid. The gap is concurrency testing (multi-threaded put/query).

**Resolution:** Add 5-10 concurrent access tests in Phase 0.1 for the SQLite store. The existing test suite is a strong foundation.

---

## Critical Issues (Carried Forward, Revised)

### 1. nthlayer-correlate Must Be Python (not TypeScript)
SITREP-PRECORRELATION.md uses TS interfaces as spec notation. Implementation is Python. Convert to `Protocol` + `@dataclass`.

### 2. Subject Types: Add `"communication"`, Use `"custom"` for nthlayer-respond-Specific Types
`escalation` and `incident_summary` map to `"custom"` with `metadata.custom["incident_type"]`.

### 3. Store-level `resolve()` Convenience Needed
Add `resolve(verdict_id, status, **kwargs)` to `VerdictStore` ABC.

### 4. Safe Action Conditions: Closed Registry of Named Functions
NO expression language. Each condition is a registered callable. Unknown names fail at startup.

### 5. Self-Calibration: Strangler Fig, Not Rewrite
Keep existing nthlayer-measure calibration. Add verdict-based calibration in parallel. Compare. Deprecate later.

### 6. Coordinator Crash Recovery: Build in Phase 3.1
Serialize `IncidentContext` to SQLite after each agent step. Resume on restart.

### 7. Token Budget: Character-Based Estimation for Tier 1
`len(text) // 4` behind a `TokenEstimator` protocol.

---

## What NOT to Build

| Feature | Reason to Defer |
|---------|----------------|
| PostgreSQL/ClickHouse stores | SQLite+WAL first |
| NATS/Kafka ingesters | Tier 2+, WebhookIngester for Tier 1 |
| Full scenario schema | Event stream + expected verdicts only |
| Model routing table | Optimization, not architecture |
| Prompt compression | Ship then measure |
| Local models (lora-forge) | Spec says "not near-term" |
| `opensrm init` CLI | Manual YAML works |
| Grafana dashboard | `nthlayer-learn accuracy` CLI is MVP |
| Differential snapshots | After caching works |
| Criteria rotation / prompt diversity | After verdict history exists |
| Channel integrations (Slack/PD) | Agents draft messages, sending is glue |
| OTel emission from verdict library | Production concern, not demo concern |
| Contract enforcement library | 15 lines of staleness check per component, not a shared library |
| Staleness policy in NthLayer | Needs real Prometheus infrastructure |
| nthlayer-measure tiered evaluation | Optimization on working system |
| Per-component verdict store split | WAL mode handles Tier 1 concurrency |

---

## Revised Implementation Phases

### Phase 0: Verdict Foundation + CLI [2-3 weekends]

**0.1 — SQLite Verdict Store** ✅ COMPLETE (2026-03-12)
- Created: `verdicts/lib/python/nthlayer_learn/sqlite_store.py` (~260 lines)
- Modified: `verdicts/lib/python/nthlayer_learn/__init__.py` (export `SQLiteVerdictStore`)
- Modified: `verdicts/lib/python/tests/test_store.py` (parameterized for both backends)
- Created: `verdicts/lib/python/tests/test_sqlite_concurrency.py` (7 concurrency tests)
- Single shared store with WAL mode (`PRAGMA journal_mode=WAL`)
- Schema: `verdicts` table, indexes on `(timestamp)`, `(producer_system, timestamp)`, `(subject_type)`, `(outcome_status)`
- `accuracy()` as SQL aggregation, `by_lineage()` as iterative traversal, `expire()` in Python
- 106 tests passing: 50 store tests (25 x 2 backends) + 7 concurrency + 49 non-store

**0.2 — Store-level `resolve()` + Subject Type Fix**
- Modify: `verdicts/lib/python/nthlayer_learn/store.py` — add `resolve()` to ABC, implement in both stores
- Modify: `verdicts/lib/python/nthlayer_learn/models.py` — add `"communication"` to `VALID_SUBJECT_TYPES`

**0.3 — Verdict CLI (MVP)** ✅ COMPLETE (2026-03-13)
- Created: `verdicts/lib/python/nthlayer_learn/cli.py` (~80 lines)
- Created: `verdicts/lib/python/nthlayer_learn/__main__.py` (entry point for `python -m nthlayer_learn`)
- Modified: `verdicts/lib/python/pyproject.toml` (added `[project.scripts]` entry point)
- Created: `verdicts/lib/python/tests/test_cli.py` (13 tests)
- Two subcommands: `nthlayer-learn accuracy --producer <name> [--window 30d] [--db path]` and `nthlayer-learn list [--producer <name>] [--status pending] [--limit 20] [--db path]`
- Duration parsing: OpenSRM format (ms, s, m, h, d, w)
- 135 tests passing: 122 prior + 13 CLI tests

**Accept:** `nthlayer-learn accuracy --producer arbiter` returns a formatted accuracy report from a SQLite store. All 135 tests pass on both store backends.

---

### Phase 1: nthlayer-measure Verdict Integration [COMPLETE — 2026-03-13]

**1.1 — Add verdict dependency + emission** DONE
- Modified: `arbiter/pyproject.toml` — verdict as named dependency
- Modified: `arbiter/src/arbiter/pipeline/router.py` — after `save_score()`, creates verdict via `verdict_create()` + `verdict_store.put()`, sets `verdict_id` back-link
- Config: `VerdictConfig(store_path="verdicts.db")` — optional `verdict` section in `arbiter.yaml`
- ADDITIVE: existing ScoreStore protocol unchanged

**1.2 — Override to Verdict Resolution** DONE
- Modified: `arbiter/src/arbiter/store/sqlite.py` — after `save_override()`, calls `verdict_store.resolve(verdict_id, "overridden")`
- Added `verdict_id TEXT` column to evaluations table via idempotent migration
- `set_verdict_id()` method links evaluations to verdicts

**1.3 — Parallel verdict-based calibration** DONE
- Created: `arbiter/src/arbiter/calibration/verdict_calibration.py` — `VerdictCalibration` strangler fig
- Queries `verdict_store.accuracy(AccuracyFilter(producer_system="arbiter"))`
- Runs alongside existing JudgmentSLOChecker — does NOT replace it
- `--verdict` flag added to `nthlayer-measure calibrate` CLI subcommand
- CLI `_build_pipeline` wires verdict store to both score store and router

**Test coverage:** 30 new tests (116 total passing), covering config, schema migration, verdict emission, override resolution, calibration, CLI, and end-to-end feedback loop.

**Accept:** PASSED. nthlayer-measure evaluates agent output, verdict stored. Override triggers verdict resolution. `nthlayer-measure calibrate --verdict` shows updated accuracy rates. **This is Demo 1.**

### >>> DEMO 1: "The Feedback Loop" <<<

Run the nthlayer-measure against sample agent output. Verdicts are produced. Override one. Query accuracy — the override is reflected. This demonstrates the core thesis: AI decisions become measurable, improvable data.

**Portfolio artifact:** README walkthrough with terminal output. ~5 minute demo.

---

### Phase 2: nthlayer-correlate Implementation [8-12 weekends]

**2.0 — Synthetic Scenario Fixtures (BEFORE any nthlayer-correlate code)**
- Create: `sitrep/scenarios/synthetic/` with 3-5 YAML fixtures:
  - `simple-causal-chain.yaml` (deploy then latency spike)
  - `cascading-failure.yaml` (primary service then dependents)
  - `misleading-correlation.yaml` (two things at same time, unrelated)
  - `quiet-period.yaml` (no incidents, all normal)
  - `multi-candidate.yaml` (3 changes, only one caused the issue)
- Minimal schema: `events: [{at, type, payload}]` + `expected_outcomes: {}`
- These are the test harness for everything below

**2.1 — Data types and store interface**
- Create: `sitrep/src/sitrep/types.py`, `store/protocol.py`, `pyproject.toml`
- Convert TS interfaces to Python `@dataclass` + `Protocol`

**2.2 — SQLite FTS5 EventStore**
- Create: `sitrep/src/sitrep/store/sqlite.py`, `store/schema.sql`
- Events table, FTS5, BM25, TTL cleanup, state hashing
- Test: Load scenario fixtures, query by time/service/text

**2.3 — WebhookIngester**
- Create: `sitrep/src/sitrep/ingestion/webhook.py`
- Severity pre-scoring: `min(1.0, (current - target) / target)`

**2.4 — Pre-Correlation Engine**
- Create: `sitrep/src/sitrep/correlation/engine.py`, `temporal.py`, `topology.py`, `changes.py`, `dedup.py`
- All deterministic transport
- Test: Feed scenario fixtures through engine, verify CorrelationGroups

**2.5 — Snapshot Generator with Caching**
- Create: `sitrep/src/sitrep/snapshot/generator.py`
- Token budget (`len(text) // 4` behind `TokenEstimator` protocol)
- Priority tiers, content hashing, cache TTL
- Test: Generate prompts from scenario fixtures, verify budget compliance

### >>> DEMO 2: "Pre-Correlation Engine" (no model required) <<<

Feed a synthetic scenario through the pre-correlation engine. Show: 10,000 raw events reduced to 3 correlation groups with change candidates. The model would receive 500 tokens instead of 50,000. This demonstrates the ZFC transport/judgment boundary and the cost architecture.

**Portfolio artifact:** Blog post or README section showing the compression ratio. Demonstrates deep observability thinking.

**2.6 — Model Interface and Verdict Output**
- Create: `sitrep/src/sitrep/snapshot/model.py`, `parser.py`
- Model call, parse into correlation verdicts with lineage

**2.7 — State Machine + CLI**
- Create: `sitrep/src/sitrep/state.py`, `cli.py`, `__main__.py`
- WATCHING/ALERT/INCIDENT/DEGRADED
- `nthlayer-correlate serve`, `nthlayer-correlate status`, `nthlayer-correlate replay --scenario path.yaml`

**Accept:** `nthlayer-correlate replay --scenario scenarios/synthetic/cascading-failure.yaml` produces correlation verdicts. `nthlayer-correlate serve` starts the full pipeline.

---

### Phase 3: nthlayer-respond Implementation [6-10 weekends]

**3.1 — Coordinator + Crash Recovery**
- Create: `mayday/src/mayday/coordinator.py`, `types.py`, `config.py`, `pyproject.toml`
- State machine, agent runner with timeout/fallback
- IncidentContext persistence to SQLite after each step
- Testable with mock agents

**3.2 — Agent Base Class + Triage Agent**
- Create: `mayday/src/mayday/agents/base.py`, `triage.py`
- Verdict emission with lineage

**3.3 — Investigation Agent**
- Create: `mayday/src/mayday/agents/investigation.py`
- Hypothesis generation, iteration, `subject.type="investigation"`

**3.4 — Safe Action Registry + Remediation Agent**
- Create: `mayday/src/mayday/safe_actions.py`, `agents/remediation.py`
- Closed condition registry, cooldown, blast radius checks

**3.5 — Communication Agent + Human Input + Post-Incident**
- Create: `mayday/src/mayday/agents/communication.py`
- Human input handling, verdict resolution on override
- Post-incident: resolve pending verdicts, export minimal scenario

**Accept:** `nthlayer-respond replay --scenario scenarios/synthetic/cascading-failure.yaml` runs the full pipeline with mock model responses. Verdict lineage chain is complete from nthlayer-correlate correlation through nthlayer-respond triage/investigation/remediation.

### >>> DEMO 3: "The Full Chain" <<<

Replay a synthetic incident end-to-end: nthlayer-correlate correlation verdicts feed nthlayer-respond's triage agent, investigation identifies root cause, remediation proposes rollback. The verdict lineage chain links every decision. Override one verdict, the accuracy signal propagates.

---

### Phase 4: Documentation + Polish [2-3 weekends]

**4.1 — Documentation updates** per VERDICT-INTEGRATION.md sections 5-7
**4.2 — README walkthroughs** for each demo checkpoint
**4.3 — OTel emission** (if needed for a specific demo)

---

### Phase 5: Production Hardening [ongoing, as needed]

- OTel emission from verdict library
- Contract enforcement
- Staleness policy in NthLayer
- nthlayer-measure tiered evaluation
- Criteria rotation / prompt diversity
- `opensrm init` CLI
- Grafana dashboards
- Per-component store split (if concurrency becomes real)
- PyPI packaging
- Gaming detection CLI + alerting

---

## Verification Strategy

**Phase 0:**
- `pytest verdicts/` — all 106+ tests pass on both MemoryStore and SQLiteVerdictStore
- 7 concurrent read/write tests for SQLiteVerdictStore
- Manual: `nthlayer-learn accuracy --producer test` returns formatted report

**Phase 1:**
- `pytest arbiter/tests/` — all existing tests pass (no regressions)
- New: evaluate output, verify verdict in store. Override, verify resolution. Query accuracy.
- Manual: Demo 1 walkthrough end-to-end

**Phase 2:**
- Each sub-phase tested against synthetic scenario fixtures
- Pre-correlation engine: feed each scenario, verify CorrelationGroups match expected
- Snapshot generator: verify token budget compliance
- Model interface: mock model responses, verify verdict output
- Replay: `nthlayer-correlate replay --scenario scenarios/synthetic/` produces expected verdicts
- Manual: Demo 2 showing compression ratio

**Phase 3:**
- Coordinator tested with mock agents (no model required)
- Each agent tested with predetermined context and mock model response
- Lineage chain verified: nthlayer-correlate verdicts linked to nthlayer-respond verdicts
- Replay: `nthlayer-respond replay --scenario` runs full pipeline
- Manual: Demo 3 end-to-end walkthrough

**Synthetic Data Strategy:**
- 3-5 scenario fixtures created in Phase 2.0 before any nthlayer-correlate code
- Each fixture: event stream with known timeline + expected correlation groups + expected verdicts
- Fixtures are reusable across nthlayer-correlate and nthlayer-respond testing
- Additional fixtures added as new edge cases are discovered

---

## Portfolio Prioritisation

For maximum impact in Reliability Architect / Observability interviews:

| Priority | What | Why It's Compelling | When Ready |
|----------|------|-------------------|------------|
| 1 | Verdict primitive + SQLite store + CLI | Novel data primitive for AI judgment quality | Phase 0 (~3 weekends) |
| 2 | nthlayer-measure feedback loop (Demo 1) | Measurement-driven AI reliability in action | Phase 1 (~6 weekends cumulative) |
| 3 | nthlayer-correlate pre-correlation engine (Demo 2) | Deep observability architecture, ZFC boundary, cost analysis | Phase 2.5 (~14 weekends cumulative) |
| 4 | ARCHITECTURE.md + specs (already exist) | Systems thinking, component taxonomy, data flows | Now |
| 5 | Full chain demo (Demo 3) | End-to-end incident response | Phase 3 (~22 weekends cumulative) |

**Recommendation:** Phases 0-1 (Demo 1) are the minimum viable portfolio. Phase 2.0-2.5 (Demo 2) is the high-impact addition. Phase 3 is impressive but optional for most interviews.

---

## Dependency Graph

```
Phase 0: Verdict SQLite Store + CLI + Subject Type Fix  [2-3 weekends]
    |
    v
Phase 1: nthlayer-measure Verdict Integration  [2-3 weekends]
    |                                    >>> DEMO 1 <<<
    v
Phase 2.0: Synthetic Scenario Fixtures  [1 weekend]
    |
    v
Phase 2.1-2.5: nthlayer-correlate Pre-Correlation (no model)  [4-6 weekends]
    |                                    >>> DEMO 2 <<<
    v
Phase 2.6-2.7: nthlayer-correlate Model + State Machine  [2-3 weekends]
    |
    v
Phase 3: nthlayer-respond (coordinator, agents, safe actions)  [6-10 weekends]
    |                                    >>> DEMO 3 <<<
    v
Phase 4: Documentation + Polish  [2-3 weekends]
    |
    v
Phase 5: Production Hardening  [ongoing]
```

**Critical path to Demo 1:** ~5 weekends
**Critical path to Demo 2:** ~12 weekends
**Critical path to Demo 3:** ~22 weekends

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| `json_each()` for tag filtering may not be available in all SQLite builds | SQLite 3.38+ (Python 3.11+ ships 3.39+) includes JSON1 by default. Tag filtering done in Python for now. |
| Expire query timestamp arithmetic might have precision issues | Using Python `timedelta` comparison, not SQL `julianday()`. |
| `from_dict()` validation on every `get()` adds overhead | Acceptable for Tier 1. The alternative (trusted deserialization) saves ~5% but loses schema validation. |
| nthlayer-correlate must be Python, not TypeScript | Convert TS spec interfaces to `Protocol` + `@dataclass`. |
| Cross-repo dependency management | Path-based deps for now (`pip install -e ../verdicts`). Verdict API frozen after Phase 0. |

---

## Beads Issue Mapping

Each phase maps to beads epics/tasks in the respective component repo:

| Phase | Repo | Epic ID | Notes |
|-------|------|---------|-------|
| 0 | verdicts | verdict-t0c | SQLite store + CLI |
| 1 | arbiter | arbiter-6be | Verdict integration |
| 2 | sitrep | sitrep-ist (fixtures) + sitrep-5yh (core) + sitrep-77y (state machine) | Fixtures MUST precede core |
| 3 | mayday | mayday-bel | Full agent pipeline |
| 4-5 | all | Various deferred issues | Production hardening |

Cross-repo dependencies are documented here (beads tracks within repos):
- Phase 1 (arbiter-6be) depends on Phase 0 (verdict-t0c) completion
- Phase 2 (sitrep-5yh) depends on Phase 1 (arbiter-6be) for Demo 1 baseline
- Phase 3 (mayday-bel) depends on Phase 2 (sitrep-5yh) completion
- Phase 4 depends on Phase 3 completion

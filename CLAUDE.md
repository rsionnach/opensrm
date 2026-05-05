# OpenSRM Project Context

This file provides AI assistants with essential context about the OpenSRM project.

---

## Project Description

<!-- AUTO-MANAGED: project-description -->
OpenSRM (Open Service Reliability Manifest) is a specification and ecosystem for declaring, enforcing, and measuring service reliability as code. It enables shift-left reliability by defining SLOs, dependencies, contracts, and ownership before deployment rather than after incidents.

Core specification:
- YAML/JSON manifest format (apiVersion: `opensrm/v1`)
- JSON Schema validation (spec/v1/schema.json)
- Support for service types: api, worker, stream, ai-gate, batch, database
- Standard SLOs: availability, latency, error_rate, throughput, processing_time, lag, success_rate
- Judgment SLOs for AI decision services: reversal_rate, high_confidence_failure, calibration, feedback_latency
- Contract definitions separate from internal SLOs
- Dependency-aware SLO feasibility with `expects` field
- Template inheritance for organizational defaults

Ecosystem components:
- GitHub Action for CI/CD validation
- NthLayer: reliability-as-code CLI tool (Alpha, available on PyPI) — validation, artifact generation, deployment gates
- OTel semantic conventions: Change Events, Decision Telemetry
- **Verdict**: data primitive (Python library implemented) — schema + transport library for recording AI judgments and closing the loop on correctness; foundation layer all other components depend on; repo: `nthlayer-learn/`
- nthlayer-correlate: pre-correlation agent (implemented, Phase 2 Tier 1) — continuously groups signals; snapshot schema; states: WATCHING/ALERT/INCIDENT/DEGRADED; 14 test files, 5 synthetic scenarios
- nthlayer-respond: multi-agent incident response (implemented, Phase 3 complete) — deterministic orchestrator + Triage/Investigation/Communication/Remediation agents; PagerDuty downstream not upstream; 13 test files, 8 synthetic scenarios; CLI: `nthlayer-respond replay --scenario scenarios/synthetic/cascading-failure.yaml`
- nthlayer-measure: quality measurement engine + governance (implemented) — per-agent tracking, self-calibration (MAE + judgment SLOs + verdict-based), verdict integration (Phase 1 complete: every evaluation emits a verdict, overrides resolve verdicts, `nthlayer-measure calibrate --verdict` queries accuracy), one-way safety ratchet; proven as Guardian in GasTown

Status: Draft specification (v1.0.0-draft, stabilizing)
<!-- END AUTO-MANAGED -->

---

## Architecture

<!-- AUTO-MANAGED: architecture -->
```
opensrm/
├── spec/v1/                          # Canonical specification location
│   ├── specification.md              # Complete OpenSRM v1 spec
│   ├── schema.json                   # JSON Schema for validation
│   └── judgment-slos.md              # Judgment SLO maturity model
├── examples/                         # Example manifests (opensrm/v1)
│   ├── api-*.yaml                   # API service examples
│   ├── ai-gate-*.yaml               # AI gate examples
│   ├── batch-*.yaml                 # Batch service examples
│   └── database-*.yaml              # Database service examples
├── action/                           # GitHub Action for validation
│   ├── src/                         # TypeScript source
│   └── dist/                        # Bundled action
├── conventions/                      # OTel semantic convention proposals
│   ├── change-events/               # Deploy, config, feature flag telemetry
│   └── decision-telemetry/          # AI decision quality telemetry
├── components/                       # Ecosystem component specifications
│   ├── nthlayer-correlate/                      # Pre-correlation layer
│   └── nthlayer-respond/                      # Multi-agent incident response
├── diagrams/                         # Visual documentation
│   ├── src/                         # Excalidraw source files
│   ├── svg/                         # Exported SVG diagrams (light + dark themes)
│   ├── scripts/                     # Diagram export automation
│   ├── opensrm-explained.html       # Interactive deep-dive reference (scrollable, 9 abstractions)
│   └── opensrm-explained-slides.html # 35-slide deck version of the deep dive
├── opensrm-animation/               # Motion Canvas ecosystem animation
│   ├── src/
│   │   ├── project.ts              # Animation project entry point (single scene: ecosystem)
│   │   ├── project.meta            # Motion Canvas metadata (canvas 1280x720, preview 30fps, rendering 60fps, PNG image-sequence export quality 100, colorSpace srgb, groupByScene false)
│   │   └── scenes/ecosystem.tsx    # Interactive ecosystem visualization (7-phase narrative)
│   └── output/                      # Rendered animations (GIF/MP4/PNG sequence)
├── articles/                         # Conceptual documentation
├── skills/shift-left-reliability/   # Claude Code skill
├── IMPLEMENTATION-PLAN.md           # Cohesive ecosystem implementation plan (v2) — phases, demo milestones, key decisions
├── .beads/                          # Centralized ecosystem task tracking (component repos use .beads.archived)
└── .claude/                         # Claude configuration
```

### 4-Layer System Architecture (from ARCHITECTURE.md)

```
Static Layer (Data + Tools)
  OpenSRM Manifests → NthLayer Compiler → Generated Artifacts (Prom rules, Grafana, topology)
  Execution: on-demand (CLI) or CI/CD pipeline. No long-running processes. Fully deterministic.
        │
        ▼
Verdict Layer (Data Primitive)  ← THE shared substrate for all agent feedback
  verdict.create()  verdict.resolve()  verdict.query()
  Store: SQLite (Tier 1); PostgreSQL/ClickHouse deferred.
  OTel events (gen_ai.decision.*, gen_ai.override.*) are SIDE-EFFECTS, not the primary path.
        │
        ▼
Agent Layer (Reasoning)
  nthlayer-correlate → [verdict] → nthlayer-respond Agents ← [verdict.accuracy()] → nthlayer-measure
  All agents emit verdicts with lineage. Verdict store is primary feedback mechanism.
        │ OTel side-effects
        ▼
Semantic Conventions (OTel)
  Change Events | Decision Telemetry | Outcomes
  Emitted automatically on verdict create/resolve → Prometheus → Grafana via NthLayer
```

### Agent Communication
Three mechanisms (from ARCHITECTURE.md):
- **Verdicts with lineage** (cross-component, primary): nthlayer-correlate emits correlation verdicts → nthlayer-respond triage consumes and emits triage verdicts linked via lineage → Investigation → Remediation. Traceable chain; verdict store is queryable without direct coupling.
- **Shared incident context** (within nthlayer-respond, same process): agents read/write a single YAML accumulator object. Agents are function calls sequenced by coordinator — no mailboxes, no polling.
- **OTel events** (observability side-channel, read-only): `gen_ai.decision.*` and `gen_ai.override.*` feed Prometheus/Grafana. Not a communication path.

nthlayer-respond coordinator: deterministic state machine, not an agent. Sequences `triage()` → `investigate()` + `communicate()` in parallel → `remediate()` as direct function calls. If scale requires separate processes, transport changes to NATS or direct HTTP.

### Agent Observability
Each agent has its own OpenSRM manifest (`type: ai-gate`). The same spec/tooling that defines service reliability defines agent reliability.
- verdict.gaming-check: score-outcome divergence > 0.10 triggers alerts
- 7-step pipeline: `verdict.create()` → `verdict.resolve()` → OTel events → Prometheus → NthLayer dashboards → `verdict.accuracy()` (nthlayer-measure) → governance decisions

Standalone component repositories (all implemented). License: Apache 2.0. Contributing: fork → feature branch from main → PR:
- `nthlayer-measure/`: Quality measurement engine — per-agent quality tracking (rolling windows), degradation detection, self-calibration, cost-per-quality tracking, governance (one-way safety ratchet). Config: arbiter.yaml. CLI: `nthlayer-measure start --config arbiter.yaml`. Adapters: GasTown, generic webhook, Devin (planned). ZFC canonical doc: nthlayer-measure/ZFC.md
- `nthlayer-correlate/`: Pre-correlation agent — continuously groups signals (WATCHING→ALERT→INCIDENT→DEGRADED states). Snapshot schema: id, triggered_by, window, severity, summary, signals, correlations (with confidence scores), topology, recommended_actions. Generation modes: batch (5-min), incident-triggered, refresh (1-min during INCIDENT). Self-measured: correlation accuracy + false positive rate as judgment SLOs via nthlayer-measure.
- `nthlayer-respond/`: Multi-agent incident response — deterministic state machine orchestrator (transport, not agent framework). Alert flow: Alert Source → nthlayer-correlate Snapshot → nthlayer-respond Orchestrator → Agent Pipeline → Notification Channels. PagerDuty is DOWNSTREAM of nthlayer-respond. Agents: Triage (<10% severity reversal), Investigation (70% post-incident agreement), Communication (<15% human edit rate), Remediation (80% fix success). Shared incident context YAML. Pre-approved safe actions in OpenSRM manifest enable automated remediation without human approval.
<!-- END AUTO-MANAGED -->

---

## Specification Files

<!-- AUTO-MANAGED: specification-files -->
### spec/v1/specification.md
Complete OpenSRM v1.0.0-draft specification covering:
- Document structure (apiVersion: `opensrm/v1`, kind, metadata, spec)
- Service types and their applicable SLOs: api, worker, stream, ai-gate, batch, database
- Standard SLOs: availability (target ratio), latency (percentiles: p50/p90/p95/p99/p999), error_rate, throughput
- Worker-specific: processing_time, success_rate
- Stream-specific: lag (max_seconds), throughput
- Batch-specific: duration, schedule_adherence, data_freshness
- Database-specific: query_latency, replication_lag, connection_availability
- AI Gate extensions: judgment SLOs defined within `spec.slos.judgment`
  - reversal_rate: target, window, observation_period
  - high_confidence_failure: target, window, confidence_threshold
  - calibration: target (ECE), window
  - feedback_latency: percentiles (p50, p90)
  - See spec/v1/judgment-slos.md for 4-level maturity model
- Contracts vs SLOs: external promises (contract) separate from internal targets (slos)
- Contract judgment SLOs: max_reversal_rate, max_hcf_rate (in spec.contract.judgment)
- Dependencies with `expects` field for guaranteed requirements
- Templates for inheritance across services
- Ownership metadata with escalation paths
- Instrumentation requirements for AI gates (event/attribute mappings for decision, reversal, outcome events)
- Duration format: `[0-9]+(ms|s|m|h|d|w)`
- Ratio format: 0.0 to 1.0 (not percentages like 99.9)

### spec/v1/schema.json
JSON Schema (draft-07) definition providing:
- Schema ID: `https://opensrm.io/schemas/v1/manifest.json` with apiVersion: `opensrm/v1`
- Schema validation for ServiceReliabilityManifest and Template kinds
- Type definitions: Duration (pattern-validated), Ratio (0-1 range), ServiceType enum (6 types), Tier enum
- Standard SLO schemas: AvailabilitySLO, LatencySLO, ErrorRateSLO, ThroughputSLO, ProcessingTimeSLO, LagSLO, SuccessRateSLO
- Batch SLO schemas: DurationSLO, ScheduleAdherenceSLO, DataFreshnessSLO
- Database SLO schemas: QueryLatencySLO, ReplicationLagSLO, ConnectionAvailabilitySLO
- Judgment SLO schemas: ReversalRateSLO, HighConfidenceFailureSLO, CalibrationSLO, FeedbackLatencySLO (grouped under JudgmentSLOs)
- Contract schemas: Contract (with ContractLatency, ContractThroughput, ContractJudgment using max_reversal_rate, max_hcf_rate)
- Dependency schema with `expects` field (availability, latency.p99)
- Instrumentation schema for AI gates (events: decision/reversal/outcome; attributes: decision_id, confidence, decision)
- Observability schema (metrics, dashboards, alerts, tracing)
- Deployment schema (environments, gates, rollback)

Note: Schema is embedded in GitHub Action dist/ bundle (action/dist/index.js)
<!-- END AUTO-MANAGED -->

---

## Conventions

<!-- AUTO-MANAGED: conventions -->
### Specification Format
- API version: `opensrm/v1` (standardized across spec, schema, and all examples as of commit df80f12)
- Kinds: `ServiceReliabilityManifest` or `Template`
- Duration values: numeric + unit suffix (ms, s, m, h, d, w) - e.g., "100ms", "30d"
- Ratio values: decimal 0.0-1.0, NOT percentages (0.999 not 99.9%, 0.05 not 5%)
- Field requirements: MUST (required), SHOULD (recommended), MAY (optional)

### Service Type Mappings
- `api`: availability, latency, error_rate, throughput
- `worker`: availability, processing_time, success_rate
- `stream`: availability, lag, throughput
- `ai-gate`: extends `api` with judgment SLOs (reversal_rate, high_confidence_failure, calibration, feedback_latency)
- `batch`: availability, duration, schedule_adherence, data_freshness
- `database`: availability, query_latency, replication_lag, connection_availability, throughput

### SLO Structure
All SLOs require:
- `target`: ratio (0-1) for compliance
- `window`: measurement duration (default varies by SLO type: 30d for api/database, 7d for worker/stream)

Latency/processing time SLOs require at least one percentile (p50, p90, p95, p99, p999) plus target ratio

### Judgment SLO Structure (ai-gate)
Judgment SLOs are defined within `spec.slos.judgment`:
- `reversal_rate`: target, window, observation_period
- `high_confidence_failure`: target, window, confidence_threshold
- `calibration`: target (ECE), window
- `feedback_latency`: percentiles (p50, p90)
- Requires `spec.instrumentation` section mapping event/attribute names

### Contracts vs SLOs
- `spec.contract`: External promises to dependents (what you guarantee)
- `spec.slos`: Internal targets (typically tighter than contract)
- Example: contract.availability = 0.999, slos.availability.target = 0.9995
- Contract judgment: `spec.contract.judgment.max_reversal_rate`, `max_hcf_rate`

### Notifications Section (spec.notifications)
Optional manifest section separate from `spec.ownership` (ownership = who owns; notifications = where alerts route):
- `spec.notifications.slack.channel_id`: Slack Web API channel ID for interactive messages (routing); `channel` is display name/fallback
- `spec.notifications.events`: list of `{type, severity?}` — types: breach/correlation/incident/remediation/verification/resolution; severity filter [0-4] optional
- Absent `notifications` section: all six lifecycle events notified (backward compatible)
- Channel resolution order: spec.notifications.slack.channel_id → spec.ownership.slack_channel → SLACK_CHANNEL_ID env → None
- Schema designed for future `email`/`pagerduty` entries; only `slack` is implemented
- `nthlayer validate` warns: unknown event type, channel_id starting with `#`, severity outside 0-4

### Dependencies
- Use `expects` field to declare required guarantees from dependencies
- Format: `expects.availability` (ratio), `expects.latency.p99` (duration)
- Set `critical: true` if dependency failure causes service failure
- Optional `manifest` URL points to dependency's OpenSRM file

### Design Principles (from ARCHITECTURE.md)
1. **Schemas + Enforcement**: Every component is defined by a specification first. Implementation follows.
2. **Shift-Left Reliability**: Reliability concerns move earlier in the lifecycle (manifests define SLOs before deployment)
3. **Operator-Agnostic**: Stack supports both human and AI operators (nthlayer-correlate outputs work for dashboards and LLMs)
4. **Open Standards**: Extend existing standards (OTel) rather than invent new ones
5. **Reasoning Boundary**: Agent capabilities reserved for components requiring interpretation. Deterministic operations (validation, generation, arithmetic) remain as tools that agents invoke.

### Component Taxonomy (from ARCHITECTURE.md)
Four execution models determine how components are built, deployed, tested, and monitored:
- **Data Sources**: Static, queryable, no reasoning (OpenSRM manifests in Git, Prometheus metrics, change event logs)
- **Data Primitives**: Schema + transport library, no reasoning (Verdict — records AI judgments, sits below all other components in the dependency graph)
- **Tools**: Deterministic, invocable, no reasoning (NthLayer compiler, schema validator, dependency math engine)
- **Agents**: Reasoning, adaptive, judgment required (nthlayer-correlate/nthlayer-correlate, nthlayer-respond/nthlayer-respond Triage/Investigation/Communication/Remediation, nthlayer-measure/nthlayer-measure)

Test: Does this component need to reason about ambiguous inputs? If yes, it's an agent. If it does the same thing every time given the same input, it's a tool. If it's queryable state, it's a data source.

Why this matters: Data and tool layers work without any AI. Teams can adopt OpenSRM manifests and NthLayer today with zero agents. The agent layer is additive, not foundational. System degrades gracefully if an agent fails.

### Data Flows (from ARCHITECTURE.md)
- **Flow 1 — Manifest → Monitoring**: service.reliability.yaml → NthLayer (validate + generate) → Prometheus rules / Grafana dashboards / topology → nthlayer-correlate (nthlayer-correlate)
- **Flow 2 — Events → Verdicts (nthlayer-correlate loop)**: Alerts/changes (webhook) + topology (NthLayer tool call) + nthlayer-measure (nthlayer-measure) quality verdicts → nthlayer-correlate (nthlayer-correlate) correlates → `verdict.create()` correlation + snapshot verdicts with lineage → [OTel side-effect: gen_ai.decision.* per correlation]
- **Flow 3 — Decision → Verdict → Measurement**: Any agent `verdict.create()` → [OTel side-effect] → human/CI `verdict.resolve()` → [OTel side-effect] → nthlayer-measure (nthlayer-measure) `verdict.accuracy()` + `verdict.gaming-check()` → autonomy policy back to agents
- **Flow 4 — Agent Tool Invocation**: Agent → `topology_query` to NthLayer → NthLayer reads manifest → returns topology.json; Agent → `check_deploy_gate` → pass/fail
- **Flow 5 — Incident Lifecycle**: PagerDuty → nthlayer-correlate (nthlayer-correlate) snapshot → Orchestrator creates context → Triage (severity/blast radius) → Investigation + Communication in parallel → Remediation → Communication update

### Integration Points
External systems: Prometheus (remote write, query), Alertmanager (webhook), GitHub/ArgoCD/LaunchDarkly (webhooks for change events), PagerDuty (API, webhook), Grafana (JSON import), OTel Collector (OTLP for logs/traces)
<!-- END AUTO-MANAGED -->

---

## Ecosystem Components

<!-- AUTO-MANAGED: ecosystem-components -->
### Data Primitives Layer
- **Verdict** (repo: `nthlayer-learn/`): Schema + Python transport library for recording AI judgments and measuring correctness. Foundation layer — all judgment-producing components (nthlayer-measure, nthlayer-correlate, nthlayer-respond) depend on it. No reasoning, no model calls. Status: Phase 0 complete — Python library + CLI implemented (`pip install nthlayer-learn`). Three phases per verdict: Judgment (at decision time), Outcome (filled later), Lineage (optional links). Key operations: `create()`, `link()`, `resolve()`, `accuracy()`, `gaming-check()` (score-outcome divergence > 0.10 triggers alert), `review()`, `replay()`. CLI: `nthlayer-learn accuracy --producer <name> [--window 30d]` and `nthlayer-learn list` query a SQLite store directly — the primary demo interface for the feedback loop. Store: SQLite (Tier 1, default); PostgreSQL/ClickHouse deferred until contention warrants. OTel emission (`gen_ai.decision.*`, `gen_ai.override.*`) is a side-effect of verdict operations, not a separate instrumentation step. Verdict store is the shared substrate — not OTel, not Prometheus, not a message bus. See `nthlayer-learn/CLAUDE.md` for full API reference.
  - `store.resolve(verdict_id, status, ...)`: preferred single-call method on `VerdictStore` — combines `get()` + `core.resolve()` + `update_outcome()`. Use this instead of the two-step pattern; the two-step pattern silently drops persistence with `SQLiteVerdictStore`.
  - `VALID_SUBJECT_TYPES` (in `nthlayer_learn/models.py`): `agent_output`, `correlation`, `triage`, `investigation`, `remediation`, `review`, `classification`, `recommendation`, `moderation`, `communication`, `custom`.

### Static Layer (Data + Tools)
- **OpenSRM Manifests**: Source of truth in Git for service identity, SLO targets, dependencies, contracts, AI gates. No reasoning, fully deterministic.
- **NthLayer Compiler**: Tool that transforms manifests into operational artifacts. Validates schema, generates Prometheus rules/Grafana dashboards, calculates dependency math, exports topology (partial — topology export for nthlayer-correlate consumption in progress; judgment SLO alerting not yet started). Execution: on-demand (CLI) or CI/CD pipeline. No long-running processes.
- **OpenSRM Validator Action**: Official GitHub Action (`rsionnach/opensrm@v1`) for CI/CD validation
- **Shift-Left Reliability Skill**: Claude Code skill for generating manifests, suggesting SLOs, and validating reliability decisions during development

### Agent Layer (Reasoning)
- **nthlayer-correlate Agent** (repo: `nthlayer-correlate/`): Long-running pre-correlation agent — continuously groups signals in background so correlated view is ready before anyone asks
  - Tier 1 inputs: Alerts (webhook), Changes (webhook), Topology (NthLayer tool call), Verdicts (nthlayer-measure quality verdicts as events)
  - Tier 2/3 deferred inputs: Metrics (Prometheus remote write), Logs (OTLP), Events via NATS/Kafka
  - Outputs: correlation verdicts + snapshot verdicts stored in SQLite FTS5 (Tier 1); snapshot verdicts link to child correlation verdicts via lineage
  - States: WATCHING → ALERT → INCIDENT → DEGRADED (self-aware: reduces confidence when own accuracy drops)
  - DEGRADED mode: when model unavailable, continues transport pipeline (ingest, group, deduplicate), emits template-based verdicts with `confidence: 0.0`, flagged for human review; fully testable without a model
  - Self-measured via nthlayer-measure: correlation accuracy and false positive rate as judgment SLOs

- **nthlayer-respond Agents** (repo: `nthlayer-respond/`): Multi-agent incident response — implemented (Phase 3 complete)
  - Orchestrator: deterministic state machine (transport), not an agent framework — sequences agents as direct function calls. Pure ZFC.
  - Alert flow: Alert Source → nthlayer-correlate Snapshot → nthlayer-respond Orchestrator → Agent Pipeline → Notification Channels. PagerDuty is DOWNSTREAM of nthlayer-respond, not upstream.
  - Package: `src/nthlayer_respond/` — `types.py`, `config.py` (mayday.yaml), `coordinator.py`, `context_store.py` (ContextStore Protocol + SQLite), `agents/` (base.py + 4 agents), `safe_actions/` (registry + built-ins), `cli.py`
  - CLI: `nthlayer-respond serve | status | replay | approve | reject | resume`; `serve` exposes `GET /metrics` (Prometheus text exposition) via `VerdictMetricsCollector` — gauges: `nthlayer_verdict_accuracy`, `nthlayer_verdicts_total`, `nthlayer_verdict_reversal_rate` with `component`/`verdict_type`/`window` labels; no prometheus_client dep
  - `IncidentContext`: id (INC-YYYY-NNNN), state (IncidentState enum), trigger_source ("sitrep"/"pagerduty"/"manual"), trigger_verdict_ids, topology, per-agent result fields, verdict_chain, last_completed_step_index (0-3, not AgentRole — disambiguates parallel steps and two COMMUNICATION occurrences)
  - `IncidentState` terminal states: RESOLVED, ESCALATED, FAILED
  - ZFC boundary: `_call_model()` and `_emit_verdict()` are transport (AgentBase); `build_prompt()` and `parse_response()` are judgment (abstract on subclasses)
  - Verdict lineage: every nthlayer-respond verdict links to nthlayer-correlate correlation verdicts via `lineage.context`; chains to previous nthlayer-respond verdict via `lineage.parent`
  - Approval ratchet: model can escalate `requires_approval` but never downgrade — same principle as nthlayer-measure's autonomy ratchet
  - Degraded mode: model failure → low-confidence verdict with `action="escalate"`, `tags=["degraded", "human-takeover-required"]`
  - Crash recovery: `IncidentContext` persisted to SQLite after every pipeline step; coordinator resumes from `last_completed_step_index`
  - nthlayer-correlate is NOT a package dependency — components communicate through the shared verdict store
  - Dependencies: `pyyaml>=6.0.1`, `structlog>=24.1`, `anthropic>=0.39`, `verdict` (path-based)
  - Scenarios: `scenarios/synthetic/` — cascading-failure, sitrep-unavailable, model-unavailable, human-override, low-confidence-escalation, remediation-approval, autonomy-reduction, crash-recovery
  - Triage Agent: severity (0-4), blast radius, team assignment. Judgment SLO: <10% severity reversal rate
  - Investigation Agent: hypotheses ranked by confidence, root cause declared when confidence exceeds threshold. Judgment SLO: 70% post-incident agreement
  - Communication Agent: audience-appropriate messaging, both initial and resolution phases. Judgment SLO: <15% human edit rate
  - Remediation Agent: executes pre-approved safe actions without human approval; cannot act outside blast radius. Judgment SLO: 80% fix success rate
  - Post-incident learning: findings → manifest updates, NthLayer rule refinements, nthlayer-measure threshold revisions, nthlayer-correlate correlation improvements

- **nthlayer-measure** (repo: `nthlayer-measure/`): Quality measurement engine + governance — implemented
  - Phase 1 (verdict integration, complete): integration point is `PipelineRouter.run()` — verdict created after `save_score()` with `set_verdict_id()` back-link to evaluations table; `DEFAULT_APPROVE_THRESHOLD = 0.5`; `subject.type` always `"agent_output"`, `producer.system` always `"arbiter"`; override calls `verdict_store.resolve(verdict_id, "overridden")`; verdict config optional in `arbiter.yaml` (`verdict.store.path: verdicts.db`) — absent means no verdict ops, fully backwards-compat; `VerdictCalibration` class provides system-wide (not per-agent) accuracy alongside existing `JudgmentSLOChecker` as strangler fig; `--verdict` flag on `calibrate` CLI subcommand; async/sync boundary via `asyncio.to_thread()`; schema migration: `ALTER TABLE evaluations ADD COLUMN verdict_id TEXT`
  - Phase 2 (risk tiering, design approved — bead opensrm-8o6.2): 4 tiers: `minimal` (auto-approve, no model call, 5% sampled for calibration), `standard` (cheap model e.g. Haiku), `deep` (default model e.g. Sonnet), `critical` (frontier model e.g. Opus). Tier resolution: caller `metadata.risk_tier` override → OpenSRM manifest `spec.evaluation.tier` → config `tiering.default_tier` → fallback `standard`. One-way promotion ratchet: sample failure rate > threshold (default 10%) promotes agent minimal→standard; only human can restore. `tiering.enabled: false` by default (fully opt-in). New: `TierClassifier` (pure transport), `TierPromotionChecker` (emits promotion verdicts). `QualityScore` gains `tier` and `auto_approved` fields. New CLI: `nthlayer-measure tiering show/restore`. Spec: [`docs/superpowers/specs/2026-03-30-tiered-evaluation-design.md`](https://github.com/rsionnach/nthlayer/blob/main/docs/superpowers/specs/2026-03-30-tiered-evaluation-design.md) (in `nthlayer/` ecosystem hub).
  - Governance triggers: override rate > SLO → increase human review threshold; error budget exhausted → advisory-only mode; sustained good performance → propose autonomy increase (human approval required); calibration drift → flag for retraining; score-outcome divergence > 0.10 → gaming alert
  - Governance: one-way safety ratchet — can always reduce agent autonomy, can never increase without human approval
  - Config: `arbiter.yaml` | CLI: `nthlayer-measure start --config arbiter.yaml`
  - ZFC canonical document: `nthlayer-measure/ZFC.md` — applies to entire ecosystem

### Zero Framework Cognition (ZFC)
Core architectural principle for all ecosystem components. Canonical doc: `nthlayer-measure/ZFC.md`.
- **Transport (code):** receiving inputs, routing, persisting results, exposing APIs, sending alerts, validating YAML, computing aggregations
- **Judgment (model):** evaluating quality, scoring dimensions, deciding degradation vs variance, determining SLO targets, assessing incident severity
- Key implication: fail open — if model unavailable, transport continues, judgment pauses ("no quality opinion" not "wrong opinion")
- Model-agnostic: swap Claude for Gemini/GPT/local, transport unchanged; judgment quality changes and is itself measurable

### OTel Semantic Conventions (Proposed)
- **Change Events** (`change.*`): Operational changes (deploy, config, feature flags, infrastructure, database, model version swaps, prompt changes, LoRA adapters, formula revisions) for change-incident correlation. Targeting OTel CI/CD SIG.
- **Decision Telemetry** (`gen_ai.decision.*`, `gen_ai.reversal.*`, `gen_ai.outcome.*`): AI/human decision events enabling judgment SLO measurement. Targeting OTel GenAI SIG.
- Transport: OTel Events | Storage: Any OTel-compatible backend

### Deployment Tiers
- **Tier 1** (zero agents): OpenSRM manifests + NthLayer CLI. No infrastructure beyond existing Prometheus/Grafana. Gets: validated manifests, generated monitoring, dependency math, deployment gates.
- **Tier 2** (+nthlayer-correlate/nthlayer-correlate): Continuous pre-correlated snapshots. Answers "what changed?" before anyone asks.
- **Tier 3+** (+nthlayer-measure/nthlayer-measure, +nthlayer-respond/nthlayer-respond): Quality measurement, governance, and coordinated incident response.

Status: Specification and GitHub Action are stable. NthLayer is Alpha. All agent-layer components are implemented: nthlayer-correlate (Phase 2 Tier 1), nthlayer-respond (Phase 3 complete), nthlayer-measure (Phase 1 complete). nthlayer-learn (Verdict) is fully implemented. OTel conventions are drafted.
<!-- END AUTO-MANAGED -->

---

## Key Design Principles

<!-- MANUAL -->
From specification section 1.1:
1. **Declarative**: Describe desired state, not how to achieve it
2. **Tooling-agnostic**: Works with Prometheus, Datadog, or any backend
3. **Minimal but complete**: Only what's needed, nothing more
4. **Human-readable**: YAML-first, JSON-compatible
<!-- END MANUAL -->

---

## Related Files

<!-- AUTO-MANAGED: related-files -->
### Core Specification
- `spec/v1/specification.md`: Complete OpenSRM v1.0.0-draft specification
- `spec/v1/schema.json`: JSON Schema for manifest validation (embedded in action/dist/index.js)
- `spec/v1/judgment-slos.md`: AI gate judgment SLO maturity model (moved from root as of df80f12)
- `CHANGELOG.md`: Specification version history tracking apiVersion standardization and ai-gate additions

### Ecosystem Documentation
- `README.md`: Unified project overview with ecosystem diagram, component status table, core features (contracts & SLOs, dependency-aware feasibility, ownership, observability, deployment gates, templates), quick start examples (as of df80f12)
- `ARCHITECTURE.md`: Comprehensive ecosystem architecture with design principles, component taxonomy (data sources / data primitives / tools / agents with decision test), 4-layer system overview (Static → Verdict → Agent → OTel), component details (Verdict/nthlayer-learn, NthLayer, nthlayer-correlate/nthlayer-correlate, nthlayer-respond/nthlayer-respond, nthlayer-measure/nthlayer-measure), agent communication protocol (verdicts with lineage, shared incident context, OTel side-channel), agent observability (each agent has its own ai-gate manifest), 5 data flows (manifest → monitoring; events → verdicts; decision → verdict → measurement; agent tool invocation; incident lifecycle), integration points
- `ECOSYSTEM.md`: How components compose — component taxonomy (data sources/tools/agents), integration diagram, data flows (forward/quality/change/learning paths), event volume problem, streaming layer (NATS vs Kafka), deployment tiers (Tier 1–3+), post-incident learning loop, change event ecosystem (traditional + AI-specific change types), security model (data classification, access control, agent authority boundaries — one-way safety ratchet)
- `IMPLEMENTATIONS.md`: Tools implementing OpenSRM (GitHub Action, NthLayer, Shift-Left Reliability Skill), contribution guidelines for listing new tools
- `STATUS.md`: Comprehensive component status table with legend (stable/partial/drafted/in-design/architecture), sections for specification, tooling, agent layer, and semantic conventions with progress tracking
- `REPO-SPEC.md`: Repository expansion specification documenting evolution from spec-only to ecosystem hub, current directory structure, target expanded structure, and new files being added

### OTel Semantic Conventions (Proposed)
- `conventions/README.md`: Overview of proposed OTel extensions for operational reliability targeting CI/CD SIG and GenAI SIG
- `conventions/change-events/README.md`: Operational change event attributes (change.id, change.type, change.scope.service, change.risk.score) for change-incident correlation
- `conventions/decision-telemetry/README.md`: AI/human decision event attributes (gen_ai.decision.*, gen_ai.reversal.*, gen_ai.outcome.*) for judgment SLO measurement

### Ecosystem Components (Architecture)
- `components/README.md`: Component status table (NthLayer, nthlayer-correlate, nthlayer-respond) with component flow diagram
- `components/sitrep/sitrep-technical-appendix.md`: Pre-correlation layer v2 spec with hybrid generation model (batch + incident-triggered + refresh), Change Event and Decision Telemetry integration, service identity via OpenSRM catalog
- `components/nthlayer-respond/README.md`: Multi-agent incident response system (triage, investigation, communication, remediation agents) - architecture only

### Standalone Component Repositories
- `nthlayer-measure/README.md`: Quality measurement engine full design — ZFC architecture, self-calibration metrics (false accept rate, precision, recall), governance one-way ratchet, cost tracking, adapter list, OpenSRM manifest integration
- `nthlayer-measure/ZFC.md`: Canonical Zero Framework Cognition document — transport vs judgment distinction, practical implications (config as guidance, fail open, self-calibration, model-agnostic), what ZFC is not
- `nthlayer-measure/CONTRIBUTING.md`: Contribution guide referencing ZFC.md — fork → feature branch from main → PR; issue templates for bug reports and feature requests
- `nthlayer-correlate/README.md`: nthlayer-correlate full design — pre-correlation concept, snapshot schema, generation modes, agent states (WATCHING/ALERT/INCIDENT/DEGRADED), change attribution via OpenSRM change event schema, signal sources, self-measurement via nthlayer-measure
- `nthlayer-correlate/CONTRIBUTING.md`: Contribution guide with ZFC transport/judgment split for nthlayer-correlate (transport=ingest/group/window/count; judgment=interpret correlations/assess causality)
- `nthlayer-respond/README.md`: nthlayer-respond full design — alert flow (PagerDuty downstream), orchestration model (deterministic state machine), all four agent roles with judgment SLOs, incident context schema, human-in-the-loop design, post-incident learning loop, OpenSRM integration
- `nthlayer-respond/CONTRIBUTING.md`: Contribution guide with ZFC transport/judgment split for nthlayer-respond (transport=receive alerts/sequence agents/route messages/persist context; judgment=triage severity/form hypotheses/assess risk/draft comms)

### Visual Documentation
Diagram source files (Excalidraw JSON format):
- `diagrams/src/ecosystem-overview.excalidraw`: Complete ecosystem flow diagram showing Specification → NthLayer → nthlayer-correlate → Consumers → OTel Conventions (referenced in README.md and ARCHITECTURE.md)
- `diagrams/src/manifest-processing-flow.excalidraw`: Manifest validation and deployment flow from service.reliability.yaml through validation and enforcement (referenced in README.md)
- `diagrams/src/manifest-to-monitoring-flow.excalidraw`: Developer to NthLayer to monitoring system integration sequence diagram (referenced in ARCHITECTURE.md)
- `diagrams/src/component-flow.excalidraw`: Component integration flow between ecosystem components (referenced in components/README.md)
- `diagrams/src/ai-reliability-stack.excalidraw`: The AI Reliability Loop showing complete feedback cycle: raw signals (metrics, alerts, changes via OTel, logs) → nthlayer-correlate correlation layer (context-rich snapshots) → AI agent/human operator (decision making) → Decision Telemetry OTel (records decisions, reversals, outcomes) → Judgment SLOs OpenSRM (reversal_rate, calibration, audit_accuracy) with feedback loop tuning correlation confidence
- `diagrams/src/sitrep-architecture.excalidraw`: nthlayer-correlate pre-correlation layer architecture
- `diagrams/src/telemetry-to-decision-flow.excalidraw`: Telemetry flow for decision quality measurement (referenced in ARCHITECTURE.md)

Exported diagrams and tooling:
- `diagrams/svg/`: Exported SVG diagrams in light and dark themes (auto-generated from src/ using export-all.sh)
- `diagrams/scripts/export-all.sh`: Shell script to export all Excalidraw files to SVG (calls excalidraw-to-svg.mjs)
- `diagrams/scripts/excalidraw-to-svg.mjs`: Node.js ESM converter (no external dependencies) that generates light + dark theme SVGs from Excalidraw JSON with native canvas drawing (updated with improved rendering)

Interactive web documentation:
- `diagrams/opensrm-explained.html`: Scrollable deep-dive reference covering 9 abstractions and 4 key flows (~25 min read); warm editorial theme (Crimson Pro + DM Sans); sticky TOC with 13 sections; Mermaid.js ecosystem diagram; color-coded cards (spec=blue, tool=teal, agent=amber, otel=purple); collapsible gotcha sections and comprehension checkpoint
- `diagrams/opensrm-explained-slides.html`: 35-slide deck covering the same content; Midnight Editorial theme (Instrument Serif + JetBrains Mono, deep navy); scroll-snap full-page slides; dot + progress-bar navigation; staggered reveal animations; keyboard navigation; light/dark mode support

### Animation
- `opensrm-animation/`: Motion Canvas animated visualization of ecosystem data flow
  - `src/project.ts`: Animation project entry point (single scene: ecosystem; `makeProject({ scenes: [ecosystem] })`)
  - `src/project.meta`: Motion Canvas metadata (canvas 1280x720, preview 30fps, rendering 60fps, colorSpace srgb, PNG image-sequence export quality 100, groupByScene false)
  - `src/scenes/ecosystem.tsx`: Interactive ecosystem visualization (7-phase narrative sequence):
    - Phase 1: Problem framing — scattered alert signals, "Alerts fire. Metrics spike. A deploy just happened." → "What's connected?" → "OpenSRM: Define, enforce, and measure reliability as code"
    - Phase 2: Static layer setup — OpenSRM spec → NthLayer → Prometheus rules/Grafana dashboards/topology; topology line crosses to agent layer
    - Phase 3: Live incident — 4 signals flow into nthlayer-correlate sequentially: Alerts (payment-service latency breach), Deploys (auth-service v2.4.1 deploy 4m ago), Logs (checkout-service connection timeouts), Metrics (p99 latency spiking across 3 services); nthlayer-correlate correlates into enriched snapshot
    - Phase 4: Agent response — enriched pulse moves to nthlayer-respond; decision: "rollback auth-service — 87% confident the deploy is the cause"
    - Phase 5: Measurement — decision telemetry flows to OTel, then to Judgment SLOs; "96.8% of agent decisions stood — only 3.2% needed human correction"
    - Phase 6: Governance — nthlayer-measure monitors decision quality; feedback loop (dashed) back to nthlayer-correlate; autonomy policy to nthlayer-respond: "nthlayer-measure can reduce agent authority and autonomy, but never expand it"
    - Phase 7: Closed-loop summary — static layer restored; "Declare → Enforce → Correlate → Respond → Measure → Govern → repeat" → "Every decision feeds back to improve the next one"
    - Visual design: Nord theme (spec=frost4 #5e81ac, impl=green #a3be8c, sitrep=yellow #ebcb8b, mayday=orange #d08770, telemetry=purple #b48ead, arbiter=frost2 #88c0d0, alert=red #bf616a, change=frost2, logs=orange, metrics=frost3 #81a1c1, pulse=yellow, success=green, dark=#2e3440 for subtitle text on bright component boxes); dual-layer static/agent split with dashed divider at x=-270; JetBrains Mono font throughout; enriched pulse concept (yellow circle + ring) tracks decision through system
  - Rendering: GIF/MP4/PNG sequence via Motion Canvas editor UI
  - Output exported to assets for README/website/talks

### Examples (using opensrm/v1)
- `examples/api-minimal.yaml`, `api-full.yaml`, `api-internal.yaml`: API service examples
- `examples/ai-gate-minimal.yaml`, `ai-gate-full.yaml`, `ai-gate-security-scanner.yaml`: AI gate examples with judgment SLOs
- `examples/batch-etl.yaml`: Batch service example
- `examples/database-mysql.yaml`: Database service example

### Development Tools
- `IMPLEMENTATION-PLAN.md`: Cohesive ecosystem implementation plan (v2) — phase ordering, demo milestones (Demo 1 Feedback Loop / Demo 2 nthlayer-correlate pre-correlation / Demo 3 Full Chain), key architecture decisions (single shared verdicts.db WAL mode, path-based deps, OTel deferred to Phase 4), and per-phase accept criteria. Phase 0 complete (SQLite store + store.resolve() + CLI). Phase 1 complete (nthlayer-measure verdict integration: every eval emits a verdict, overrides resolve verdicts, `nthlayer-measure calibrate --verdict` queries accuracy). Demo 1 "The Feedback Loop" is live. Phase 2 (nthlayer-correlate) implemented. Phase 3 (nthlayer-respond) implemented.
- `shift-left-reliability-skill.md`: Claude Code skill documentation
- `skills/shift-left-reliability/`: Claude Code skill implementation with templates and examples
- `action/`: GitHub Action for CI/CD validation (rsionnach/opensrm@v1)
- `.github/workflows/pages.yml`: GitHub Actions workflow deploying the `diagrams/` directory to GitHub Pages; triggers on push to main when `diagrams/opensrm-explained*.html` changes, or manually via workflow_dispatch
- `articles/README.md`: Conceptual documentation and drafts
- `CONTRIBUTING.md`: Contribution guidelines
- `GOVERNANCE.md`: RFC process for spec changes

### Design Specs
- `docs/superpowers/specs/2026-03-13-phase-0.2-store-resolve-subject-type-design.md`: Phase 0.2 verdict library design — `store.resolve()` concrete method on `VerdictStore` ABC (eliminates two-step resolve footgun with SQLiteVerdictStore) + adds `"communication"` to `VALID_SUBJECT_TYPES` (unblocks nthlayer-respond Communication agent). Files changed: `nthlayer_learn/store.py`, `nthlayer_learn/models.py`, `tests/test_store.py`.
- `docs/superpowers/plans/2026-03-13-phase-0.2-store-resolve-subject-type.md`: Phase 0.2 implementation plan — step-by-step TDD checklist for adding `store.resolve()` to `VerdictStore` ABC and adding `"communication"` to `VALID_SUBJECT_TYPES`. Two tasks: (1) communication subject type (2 tests × 2 backends), (2) store-level `resolve()` (7 tests × 2 backends = 14 new tests); target: 122 total passing.
- `docs/superpowers/specs/2026-03-13-phase-1-arbiter-verdict-integration-design.md`: Phase 1 nthlayer-measure verdict integration design (approved) — `PipelineRouter.run()` as integration point; verdict created after `save_score()` + `set_verdict_id()` back-link; override→resolution in `save_override()` via `verdict_store.resolve(verdict_id, "overridden")`; `DEFAULT_APPROVE_THRESHOLD = 0.5`; `VerdictConfig` dataclass + optional `verdict` section in `arbiter.yaml`; `ALTER TABLE evaluations ADD COLUMN verdict_id TEXT` migration; `VerdictCalibration` strangler fig (system-wide, not per-agent); `--verdict` flag on `calibrate` CLI. Files changed: `config.py`, `router.py`, `sqlite.py`, `cli.py`; created: `verdict_calibration.py`, `tests/test_verdict_integration.py`. Accept criteria: Demo 1 "The Feedback Loop" — evaluate → verdict stored → override → `nthlayer-learn accuracy --producer arbiter` reflects the change.
- `docs/superpowers/specs/2026-03-19-phase-3-mayday-implementation-design.md`: Phase 3 nthlayer-respond implementation design (approved) — full package structure (`src/nthlayer_respond/`: types, config, coordinator, context_store, agents, safe_actions, cli); `IncidentContext` dataclass with `last_completed_step_index` (pipeline step 0-3, not AgentRole); ZFC boundary: `_call_model()`/`_emit_verdict()` transport on AgentBase, `build_prompt()`/`parse_response()` judgment abstract on subclasses; approval ratchet (model can escalate `requires_approval` never downgrade); degraded mode (`action="escalate"`, `tags=["degraded","human-takeover-required"]`); crash recovery via SQLite + resume from step index; nthlayer-correlate not a package dep (shared verdict store only); 8 synthetic scenarios. Accept criteria: `nthlayer-respond replay --scenario scenarios/synthetic/cascading-failure.yaml`.
- `docs/superpowers/plans/2026-03-19-phase-3-mayday-implementation.md`: Phase 3 nthlayer-respond implementation plan — step-by-step TDD checklist for building the full nthlayer-respond package. Task 1 covers project scaffold and types: pyproject.toml (deps: pyyaml>=6.0.1, structlog>=24.1, anthropic>=0.39, verdict path-based), `__init__.py`, `__main__.py`, `types.py` (IncidentContext, IncidentState, AgentRole, TriageResult, Hypothesis, InvestigationResult, CommunicationUpdate, CommunicationResult, RemediationResult), conftest.py with shared fixtures. Run via `uv run pytest` from `/Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond/`. Accept criteria: `nthlayer-respond replay --scenario scenarios/synthetic/cascading-failure.yaml`.
- [`docs/superpowers/specs/2026-03-30-tiered-evaluation-design.md`](https://github.com/rsionnach/nthlayer/blob/main/docs/superpowers/specs/2026-03-30-tiered-evaluation-design.md) (in `nthlayer/` ecosystem hub): Phase 2 nthlayer-measure tiered evaluation design (approved, bead opensrm-8o6.2) — `TierClassifier` between router/API and evaluator; 4 tiers: minimal/standard/deep/critical; minimal auto-approves with 5% calibration sampling; one-way promotion ratchet (minimal→standard on sample failure rate > 10%, human-only restore); per-tier model routing via `TieringConfig.models` dict; OpenSRM manifest extension `spec.evaluation.tier`; `metadata.risk_tier` caller override; `QualityScore` gains `tier` + `auto_approved` fields; new `tiering/` package (`classifier.py`, `promotion.py`); new CLI `nthlayer-measure tiering show/restore`; `tiering.enabled: false` by default. No breaking changes to API contract or store schema.
- [`docs/superpowers/specs/2026-04-02-execution-bindings-design.md`](https://github.com/rsionnach/nthlayer/blob/main/docs/superpowers/specs/2026-04-02-execution-bindings-design.md) (in `nthlayer/` ecosystem hub): nthlayer-respond execution bindings design (approved, bead opensrm-9sv.3, implementation pending) — adds `binding` section to each action in `registry/safe-actions.yaml`; new `safe_actions/webhook.py` with `WebhookDispatcher` class; `{{variable}}` template syntax in URL/headers/body (`{{service}}`, `{{target}}`, `{{incident_id}}`, `{{severity}}`, `{{previous_revision}}`); `${ENV_VAR}` secret resolution at execution time (never logged/stored/prompted — missing var = clear error); optional `verify_after` block: waits N seconds then runs PromQL against Prometheus, result stored in verdict `metadata.custom.execution` as `verified: true/false/null`; `binding: stub` or absent → existing stub handler; `SafeAction` gains optional `binding` field; `registry.py` / `execute()` unchanged (abstraction at handler level); approval ratchet, cooldown, blast radius checks unmodified.
- [`docs/superpowers/specs/2026-04-02-slack-notifications-design.md`](https://github.com/rsionnach/nthlayer/blob/main/docs/superpowers/specs/2026-04-02-slack-notifications-design.md) (in `nthlayer/` ecosystem hub): Slack notification design (approved, bead opensrm-2gg.2, implementation pending) — 6-message incident lifecycle in a single thread: measure breach → correlate root cause → respond triage → respond remediation → verification → resolution; threading via `slack_thread_ts` stored in evaluation verdict `metadata.custom`, walked from lineage by downstream components; shared `SlackNotifier` transport in `nthlayer-common/src/nthlayer_common/slack.py` (httpx, ~60 lines); component-specific block builders in `nthlayer_measure/notifications.py`, `nthlayer_correlate/notifications.py`, `nthlayer_respond/notifications.py`; opt-in via `SLACK_WEBHOOK_URL` env var; `--notify slack` CLI flag; fail-open (Slack unreachable → warning + pipeline continues; thread lost → respond starts new thread); incident pipeline and verdict store unchanged.
- [`docs/superpowers/plans/2026-04-02-slack-notifications.md`](https://github.com/rsionnach/nthlayer/blob/main/docs/superpowers/plans/2026-04-02-slack-notifications.md) (in `nthlayer/` ecosystem hub): Slack notifications implementation plan — 5 tasks: (1) `SlackNotifier` transport in nthlayer-common (`slack.py`, 4 tests: success/threading/fail-open/no-url); (2) breach block builders + cli.py integration in nthlayer-measure; (3) correlation block builders + cli.py integration in nthlayer-correlate; (4) triage/remediation/verification/resolution block builders + coordinator.py integration in nthlayer-respond; (5) full verification across the chain. Spec: `docs/superpowers/specs/2026-04-02-slack-notifications-design.md`.
- `docs/superpowers/specs/2026-04-03-approval-workflow-design.md`: Approval workflow design (approved, bead opensrm-9sv.4, implementation pending) — HTTP API + Slack interactive buttons for nthlayer-respond approval gates; `ApprovalServer` (Starlette/uvicorn) with 4 routes (approve/reject/status/slack-interactions) on port 8090; `coordinator.approve(id, approved_by=None)` / `reject(id, reason, rejected_by=None)` gain optional identity params threaded into verdict `metadata.custom`; `build_approval_blocks()` adds Approve/Reject buttons to remediation Slack messages when `SLACK_BOT_TOKEN` set; `SlackWebClient` in `nthlayer-common/slack_web.py` (post_message, update_message, verify_signature) coexists with existing `SlackNotifier` (incoming webhook only); 900s approval timeout via `asyncio.Task` — auto-rejects with `rejected_by="system/timeout"`, persists across server restarts via context store scan; channel routing via manifest `metadata.ownership.slack_channel` then `SLACK_CHANNEL_ID` env var; `respond.yaml` gains `server:`, `approval:`, `slack:` sections; new deps: `starlette>=0.40`, `uvicorn>=0.30`; existing CLI approve/reject commands unchanged.
- `docs/superpowers/plans/2026-04-03-approval-workflow.md`: Approval workflow implementation plan — 11 tasks: (1) `approved_by`/`rejected_by` identity to coordinator approve/reject with verdict metadata; (2) add server/approval/slack config fields to RespondConfig (`server_host`, `server_port` 8090, `approval_timeout_seconds` 900, `slack_signing_secret`, `slack_bot_token`); (3) `SlackWebClient` in nthlayer-common (post_message, update_message, verify_signature HMAC-SHA256 with stale-timestamp protection, 8 tests); (4) `build_approval_blocks` with Approve/Reject interactive buttons (block_id `approval_{incident_id}`, action_ids `approve`/`reject`); (5) add starlette>=0.40/uvicorn>=0.30 deps; (6) `ApprovalServer` HTTP routes with asyncio timeout management and `recover_pending_approvals()` on startup (8 tests); (7) Slack interaction handler with HMAC verification and fire-and-forget message update (4 more tests); (8) wire `serve` CLI to ApprovalServer with `--host`/`--port` overrides; (9) approval timeout tests (auto-reject, cancel, skip-resolved); (10) `resolve_slack_channel` with manifest `spec.ownership.slack_channel` then `SLACK_CHANNEL_ID` env fallback; (11) full suite verification. Spec: `docs/superpowers/specs/2026-04-03-approval-workflow-design.md`.
- `docs/superpowers/specs/2026-04-04-human-interface-design.md`: Human interface design (approved, bead opensrm-2gg.1 and .3, implementation pending) — two parts: (1) Manifest notification config: new optional `spec.notifications` section separate from `spec.ownership`; `notifications.slack.channel_id` (Slack Web API ID) + `channel` (display name); `notifications.events` filter list with `type` (breach/correlation/incident/remediation/verification/resolution) and optional `severity` [0-4] per entry; channel resolution order in `resolve_slack_channel`: spec.notifications.slack.channel_id → spec.ownership.slack_channel → SLACK_CHANNEL_ID env → None; `send_slack_notification` gains optional `event_type: str` and `severity: int | None`; absent `notifications` section notifies all six events (backward compatible); extension schema accommodates future `email`/`pagerduty` channels (not built); `nthlayer validate` warns on unknown event type names, `#channel` in channel_id, severity outside 0-4. (2) Prometheus verdict metrics on ApprovalServer: new `GET /metrics` route on `nthlayer-respond serve` (port 8090); `VerdictMetricsCollector` in `nthlayer-respond/src/nthlayer_respond/metrics.py`; reads shared verdict SQLite, aggregates on scrape (no caching, no prometheus_client dep — plain text exposition format); gauges: `nthlayer_verdict_accuracy` (1.0 - reversal_rate), `nthlayer_verdicts_total`, `nthlayer_verdict_reversal_rate`; labels: `component` (from verdict.producer.system stripped to e.g. `measure`), `verdict_type`, `window` (7d/30d); gauge omitted when total=0; adds `job_name: nthlayer-respond` scrape target to test/prometheus.yml. (3) Grafana dashboard provisioned at `test/grafana/dashboards/nthlayer-verdict-accuracy.json`: Row 1 Verdict Accuracy (Y 0-1, thresholds 0.8 yellow/0.9 green, PromQL `nthlayer_verdict_accuracy{window="7d"}`), Row 2 Reversal Rate (Y 0-0.2, thresholds 0.05 yellow/0.10 red); docker-compose mounts `test/grafana/` into Grafana provisioning.
- `docs/superpowers/specs/2026-04-04-llm-retry-design.md`: LLM retry logic design (approved, bead opensrm-gcg, implemented) — transient error resilience inside `llm_call` in `nthlayer-common`; new `retry: int = 3` parameter (default gives measure/correlate/respond resilience for free; `retry=0` disables); status code classification: transient (429, 408, 502, 503 + httpx.TimeoutException/ConnectError/RemoteProtocolError), permanent (400, 401, 403, 404, 422), unknown 5xx retry-by-default (trade-off noted in code comment); backoff: full jitter `random.uniform(0, min(1.0 * 2**attempt, 30.0))` to avoid thundering herd; `Retry-After` header parsed (integer seconds + HTTP-date formats) and used as delay floor; timeout budget check before each sleep — raises immediately if remaining budget < calculated delay; `LLMError` gains `status_code: int | None = None` field (backward compatible, lets callers distinguish network failure from bad request without string parsing); each retry logs warning with `transient`/`permanent` label + attempt count + delay. Files changed: `nthlayer-common/src/nthlayer_common/llm.py`, `nthlayer-common/tests/test_llm.py`. No new dependencies.
- `docs/superpowers/plans/2026-04-04-llm-retry.md`: LLM retry implementation plan (bead opensrm-gcg) — 3 tasks: (1) `_is_transient` + `_parse_retry_after` helpers + 16 tests; (2) retry loop in `llm_call` + `status_code` on `LLMError` + retry/Retry-After/timeout-budget tests; (3) `LLMError.status_code` tests + downstream backward compat verification (nthlayer-respond test suite — no caller changes required). Uses checkbox syntax for tracking.

Files removed as of df80f12:
- `opensrm-v1-full-spec.md`: Consolidated into spec/v1/specification.md
- `opensrm.json`: Consolidated into spec/v1/schema.json
- `judgment-slo-spec.md`: Moved to spec/v1/judgment-slos.md
- `README_current.md`, `README_new.md`: Merged into unified README.md
<!-- END AUTO-MANAGED -->

---

## Status

<!-- MANUAL -->
This is a draft specification under active development. The v1 spec is stabilizing but not yet finalized for production use.
<!-- END MANUAL -->

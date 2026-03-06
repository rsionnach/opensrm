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
- SitRep: pre-correlation agent (architecture phase) — continuously groups signals; snapshot schema; states: WATCHING/ALERT/INCIDENT/DEGRADED
- Mayday: multi-agent incident response (architecture phase) — deterministic orchestrator + Triage/Investigation/Communication/Remediation agents; PagerDuty downstream not upstream
- Arbiter: quality measurement engine + governance (architecture phase) — per-agent tracking, self-calibration, one-way safety ratchet; proven as Guardian in GasTown

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
│   ├── sitrep/                      # Pre-correlation layer
│   └── mayday/                      # Multi-agent incident response
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
│   │   └── scenes/ecosystem.tsx    # Interactive ecosystem visualization (7-phase narrative, ~977 lines)
│   └── output/                      # Rendered animations (GIF/MP4/PNG sequence)
├── articles/                         # Conceptual documentation
├── skills/shift-left-reliability/   # Claude Code skill
├── .beads/                          # Task tracking
└── .claude/                         # Claude configuration
```

Major reorganization complete as of commit df80f12:
- apiVersion standardized to `opensrm/v1` across all files
- README unified with ecosystem diagram
- Conventions and components directories added
- ARCHITECTURE.md created with comprehensive ecosystem documentation with component taxonomy (data sources, tools, agents)
- Diagrams added for ecosystem overview, component flow, and AI reliability stack
- IncidentTown renamed to Mayday across all documentation
- Arbiter agent added for judgment SLO enforcement

Latest updates (commit ab2167a and related):
- ARCHITECTURE.md expanded with detailed component taxonomy, reasoning boundary principle, and system overview diagrams
- STATUS.md added with comprehensive component status table (stable/partial/in-design/architecture)
- REPO-SPEC.md added documenting repository expansion from spec-only to full ecosystem hub
- Components renamed: IncidentTown → Mayday (multi-agent incident response with triage, investigation, communication, remediation agents)
- New component: Mayday (in components/mayday/) replacing IncidentTown namespace
- Diagram export tooling (excalidraw-to-svg.mjs) added for automated SVG generation with light+dark themes

Standalone component repositories (architecture phase, not yet implemented). License: Apache 2.0. Contributing: fork → feature branch from main → PR:
- `arbiter/`: Quality measurement engine — per-agent quality tracking (rolling windows), degradation detection, self-calibration (false accept rate/precision/recall via gen_ai.decision.* + gen_ai.override.* OTel events), cost-per-quality tracking, governance (one-way safety ratchet). Config: arbiter.yaml. CLI: `arbiter start --config arbiter.yaml`. Adapters: GasTown, generic webhook, Devin (planned). Proven as Guardian in GasTown (PR #2263, Steve Yegge). ZFC canonical doc: arbiter/ZFC.md
- `sitrep/`: Pre-correlation agent — continuously groups signals (WATCHING→ALERT→INCIDENT→DEGRADED states). Snapshot schema: id, triggered_by, window, severity, summary, signals, correlations (with confidence scores), topology, recommended_actions. Generation modes: batch (5-min), incident-triggered, refresh (1-min during INCIDENT). Change attribution via OpenSRM change event schema. Self-measured: correlation accuracy + false positive rate as judgment SLOs via Arbiter.
- `mayday/`: Multi-agent incident response — deterministic state machine orchestrator (transport, not agent framework). Alert flow: Alert Source → SitRep Snapshot → Mayday Orchestrator → Agent Pipeline → Notification Channels. PagerDuty is DOWNSTREAM of Mayday. Agents: Triage (<10% severity reversal), Investigation (70% post-incident agreement), Communication (<15% human edit rate), Remediation (80% fix success). Shared incident context YAML. Pre-approved safe actions in OpenSRM manifest enable automated remediation without human approval.
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

### Dependencies
- Use `expects` field to declare required guarantees from dependencies
- Format: `expects.availability` (ratio), `expects.latency.p99` (duration)
- Set `critical: true` if dependency failure causes service failure
- Optional `manifest` URL points to dependency's OpenSRM file

### Design Principles (from ARCHITECTURE.md)
1. **Schemas + Enforcement**: Every component is defined by a specification first. Implementation follows.
2. **Shift-Left Reliability**: Reliability concerns move earlier in the lifecycle (manifests define SLOs before deployment)
3. **Operator-Agnostic**: Stack supports both human and AI operators (Sitrep outputs work for dashboards and LLMs)
4. **Open Standards**: Extend existing standards (OTel) rather than invent new ones
5. **Reasoning Boundary**: Agent capabilities reserved for components requiring interpretation. Deterministic operations (validation, generation, arithmetic) remain as tools that agents invoke.

### Component Taxonomy (from ARCHITECTURE.md)
Three execution models determine how components are built, deployed, tested, and monitored:
- **Data Sources**: Static, queryable, no reasoning (OpenSRM manifests in Git, Prometheus metrics, change event logs)
- **Tools**: Deterministic, invocable, no reasoning (NthLayer compiler, schema validator, dependency math engine)
- **Agents**: Reasoning, adaptive, judgment required (Sitrep, Mayday Triage/Investigation/Communication/Remediation, Arbiter)

Test: Does this component need to reason about ambiguous inputs? If yes, it's an agent. If it does the same thing every time given the same input, it's a tool. If it's queryable state, it's a data source.

Why this matters: Data and tool layers work without any AI. Teams can adopt OpenSRM manifests and NthLayer today with zero agents. The agent layer is additive, not foundational. System degrades gracefully if an agent fails.

### Data Flows (from ARCHITECTURE.md)
- **Manifest → Monitoring**: service.reliability.yaml → NthLayer → Prometheus rules/Grafana dashboards
- **Telemetry → Snapshot → Decision**: Systems telemetry → Sitrep correlation → Consumer decisions → Decision telemetry events
- **Decision → SLO Measurement**: Decision/reversal events → Prometheus metrics → Alerting on judgment SLO breaches

### Integration Points
External systems: Prometheus (remote write, query), Alertmanager (webhook), GitHub/ArgoCD/LaunchDarkly (webhooks for change events), PagerDuty (API, webhook), Grafana (JSON import), OTel Collector (OTLP for logs/traces)
<!-- END AUTO-MANAGED -->

---

## Ecosystem Components

<!-- AUTO-MANAGED: ecosystem-components -->
### Static Layer (Data + Tools)
- **OpenSRM Manifests**: Source of truth in Git for service identity, SLO targets, dependencies, contracts, AI gates. No reasoning, fully deterministic.
- **NthLayer Compiler**: Tool that transforms manifests into operational artifacts. Validates schema, generates Prometheus rules/Grafana dashboards, calculates dependency math, exports topology. Execution: on-demand (CLI) or CI/CD pipeline. No long-running processes.
- **OpenSRM Validator Action**: Official GitHub Action (`rsionnach/opensrm@v1`) for CI/CD validation
- **Shift-Left Reliability Skill**: Claude Code skill for generating manifests, suggesting SLOs, and validating reliability decisions during development

### Agent Layer (Reasoning)
- **SitRep Agent** (repo: `sitrep/`): Long-running pre-correlation agent — continuously groups signals in background so correlated view is ready before anyone asks
  - Signal sources: OTel metrics/traces, Alertmanager, change events (OpenSRM schema), Arbiter quality scores, CI/CD deployment records
  - Generation modes: batch (5-min periodic), incident-triggered (deeper correlation), refresh/on-demand (1-min cycle during incidents)
  - States: WATCHING → ALERT → INCIDENT → DEGRADED (self-aware: reduces confidence when own accuracy drops)
  - Snapshot schema: id, triggered_by, window, severity, summary (model-generated), signals, correlations (with confidence scores), topology, recommended_actions
  - Self-measured via Arbiter: correlation accuracy and false positive rate as judgment SLOs
  - Streaming layer: Kafka (enterprise, partitioned by service/signal type) or NATS (small deployments)

- **Mayday Agents** (repo: `mayday/`): Multi-agent incident response — architecture phase
  - Orchestrator: deterministic state machine (transport), not an agent framework — sequences agents (judgment). Pure ZFC.
  - Alert flow: Alert Source → SitRep Snapshot → Mayday Orchestrator → Agent Pipeline → Notification Channels. PagerDuty is DOWNSTREAM of Mayday, not upstream.
  - Triage Agent: severity, blast radius, team assignment. Judgment SLO: reversal rate on severity <10%
  - Investigation Agent: hypotheses from SitRep snapshots, root cause ranking by confidence. Judgment SLO: post-incident agreement target 70%
  - Communication Agent: audience-appropriate messaging, channel + timing selection. Judgment SLO: human edit rate <15%
  - Remediation Agent: executes pre-approved safe actions from OpenSRM manifest. Judgment SLO: fix success rate 80%
  - Incident context: shared YAML object accumulating findings (triage, investigation, communication, remediation sections)
  - Human-in-the-loop: destructive actions require human approval unless pre-approved in manifest
  - Post-incident learning: findings → manifest updates, NthLayer rule refinements, Arbiter threshold revisions, SitRep correlation improvements

- **Arbiter** (repo: `arbiter/`): Quality measurement engine + governance — architecture phase
  - Core: per-agent quality tracking (rolling windows), degradation detection, self-calibration, cost-per-quality tracking
  - Self-calibration metrics: false accept rate, precision, recall — via `gen_ai.decision.*` and `gen_ai.override.*` OTel events
  - Governance: one-way safety ratchet — can always reduce agent autonomy (safe direction), can never increase it without human approval
  - Config: `arbiter.yaml` (evaluator model, dimensions, per-agent judgment SLOs with reversal_rate targets and windows)
  - CLI: `arbiter start --config arbiter.yaml`
  - Adapters: GasTown, generic webhook, Devin (planned)
  - ZFC canonical document lives at `arbiter/ZFC.md` — applies to entire ecosystem

### Zero Framework Cognition (ZFC)
Core architectural principle for all ecosystem components. Canonical doc: `arbiter/ZFC.md`.
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
- **Tier 2** (+SitRep): Continuous pre-correlated snapshots. Answers "what changed?" before anyone asks.
- **Tier 3+** (+Arbiter, +Mayday): Quality measurement, governance, and coordinated incident response.

Status: Specification and GitHub Action are stable. NthLayer is Alpha (partially complete). SitRep, Mayday, and Arbiter are architecture-only. OTel conventions are drafted.
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
- `ARCHITECTURE.md`: Comprehensive ecosystem architecture with design principles (schemas + enforcement, shift-left reliability, operator-agnostic, open standards, reasoning boundary), component taxonomy diagram (data sources vs tools vs agents with decision test), system overview showing static layer (manifests + NthLayer) and agent layer (Sitrep + Mayday + Arbiter), component details, data flows (manifest → monitoring, telemetry → snapshot → decision), integration points
- `ECOSYSTEM.md`: How components compose — component taxonomy (data sources/tools/agents), integration diagram, data flows (forward/quality/change/learning paths), event volume problem, streaming layer (NATS vs Kafka), deployment tiers (Tier 1–3+), post-incident learning loop, change event ecosystem (traditional + AI-specific change types)
- `IMPLEMENTATIONS.md`: Tools implementing OpenSRM (GitHub Action, NthLayer, Shift-Left Reliability Skill), contribution guidelines for listing new tools
- `STATUS.md`: Comprehensive component status table with legend (stable/partial/drafted/in-design/architecture), sections for specification, tooling, agent layer, and semantic conventions with progress tracking
- `REPO-SPEC.md`: Repository expansion specification documenting evolution from spec-only to ecosystem hub, current directory structure, target expanded structure, and new files being added

### OTel Semantic Conventions (Proposed)
- `conventions/README.md`: Overview of proposed OTel extensions for operational reliability targeting CI/CD SIG and GenAI SIG
- `conventions/change-events/README.md`: Operational change event attributes (change.id, change.type, change.scope.service, change.risk.score) for change-incident correlation
- `conventions/decision-telemetry/README.md`: AI/human decision event attributes (gen_ai.decision.*, gen_ai.reversal.*, gen_ai.outcome.*) for judgment SLO measurement

### Ecosystem Components (Architecture)
- `components/README.md`: Component status table (NthLayer, Sitrep, Mayday) with component flow diagram
- `components/sitrep/sitrep-technical-appendix.md`: Pre-correlation layer v2 spec with hybrid generation model (batch + incident-triggered + refresh), Change Event and Decision Telemetry integration, service identity via OpenSRM catalog
- `components/mayday/README.md`: Multi-agent incident response system (triage, investigation, communication, remediation agents) - architecture only

### Standalone Component Repositories (Architecture Phase)
- `arbiter/README.md`: Quality measurement engine full design — ZFC architecture, self-calibration metrics (false accept rate, precision, recall), governance one-way ratchet, cost tracking, adapter list, OpenSRM manifest integration
- `arbiter/ZFC.md`: Canonical Zero Framework Cognition document — transport vs judgment distinction, practical implications (config as guidance, fail open, self-calibration, model-agnostic), what ZFC is not
- `arbiter/CONTRIBUTING.md`: Contribution guide referencing ZFC.md and Wasteland Wanted Board
- `sitrep/README.md`: SitRep full design — pre-correlation concept, snapshot schema, generation modes, agent states (WATCHING/ALERT/INCIDENT/DEGRADED), change attribution via OpenSRM change event schema, signal sources, self-measurement via Arbiter
- `sitrep/CONTRIBUTING.md`: Contribution guide with ZFC transport/judgment split for SitRep (transport=ingest/group/window/count; judgment=interpret correlations/assess causality)
- `mayday/README.md`: Mayday full design — alert flow (PagerDuty downstream), orchestration model (deterministic state machine), all four agent roles with judgment SLOs, incident context schema, human-in-the-loop design, post-incident learning loop, OpenSRM integration
- `mayday/CONTRIBUTING.md`: Contribution guide with ZFC transport/judgment split for Mayday (transport=receive alerts/sequence agents/route messages/persist context; judgment=triage severity/form hypotheses/assess risk/draft comms)

### Visual Documentation
Diagram source files (Excalidraw JSON format):
- `diagrams/src/ecosystem-overview.excalidraw`: Complete ecosystem flow diagram showing Specification → NthLayer → Sitrep → Consumers → OTel Conventions (referenced in README.md and ARCHITECTURE.md)
- `diagrams/src/manifest-processing-flow.excalidraw`: Manifest validation and deployment flow from service.reliability.yaml through validation and enforcement (referenced in README.md)
- `diagrams/src/manifest-to-monitoring-flow.excalidraw`: Developer to NthLayer to monitoring system integration sequence diagram (referenced in ARCHITECTURE.md)
- `diagrams/src/component-flow.excalidraw`: Component integration flow between ecosystem components (referenced in components/README.md)
- `diagrams/src/ai-reliability-stack.excalidraw`: The AI Reliability Loop showing complete feedback cycle: raw signals (metrics, alerts, changes via OTel, logs) → Sitrep correlation layer (context-rich snapshots) → AI agent/human operator (decision making) → Decision Telemetry OTel (records decisions, reversals, outcomes) → Judgment SLOs OpenSRM (reversal_rate, calibration, audit_accuracy) with feedback loop tuning correlation confidence
- `diagrams/src/sitrep-architecture.excalidraw`: Sitrep pre-correlation layer architecture
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
    - Phase 3: Live incident — 4 signals flow into Sitrep sequentially: Alerts (payment-service latency breach), Deploys (auth-service v2.4.1 deploy 4m ago), Logs (checkout-service connection timeouts), Metrics (p99 latency spiking across 3 services); Sitrep correlates into enriched snapshot
    - Phase 4: Agent response — enriched pulse moves to Mayday; decision: "rollback auth-service — 87% confident the deploy is the cause"
    - Phase 5: Measurement — decision telemetry flows to OTel, then to Judgment SLOs; "96.8% of agent decisions stood — only 3.2% needed human correction"
    - Phase 6: Governance — Arbiter monitors decision quality; feedback loop (dashed) back to Sitrep; autonomy policy to Mayday: "Arbiter can reduce agent authority and autonomy, but never expand it"
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
- `shift-left-reliability-skill.md`: Claude Code skill documentation
- `skills/shift-left-reliability/`: Claude Code skill implementation with templates and examples
- `action/`: GitHub Action for CI/CD validation (rsionnach/opensrm@v1)
- `.github/workflows/pages.yml`: GitHub Actions workflow deploying the `diagrams/` directory to GitHub Pages; triggers on push to main when `diagrams/opensrm-explained*.html` changes, or manually via workflow_dispatch
- `articles/README.md`: Conceptual documentation and drafts
- `CONTRIBUTING.md`: Contribution guidelines
- `GOVERNANCE.md`: RFC process for spec changes

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

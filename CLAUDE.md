# OpenSRM Project Context

This file provides AI assistants with essential context about the OpenSRM project.

---

## Project Description

<!-- AUTO-MANAGED: project-description -->
OpenSRM (Open Service Reliability Manifest) is a specification for declaring service reliability requirements as code. It enables shift-left reliability by defining SLOs, dependencies, contracts, and ownership before deployment rather than after incidents.

Key components:
- YAML/JSON manifest format for service reliability declarations
- JSON Schema validation (spec/v1/schema.json)
- Support for multiple service types: api, worker, stream, ai-gate, batch, database
- SLO types: availability, latency, error_rate, throughput, processing_time, lag, success_rate
- Judgment SLOs for AI-powered decision services (reversal rate, audit compliance, outcome tracking, escalation metrics)
- Contract definitions separate from internal SLOs
- Dependency-aware SLO feasibility calculations
- Template inheritance for organizational defaults

Status: Draft specification (v1.0.0-draft)
<!-- END AUTO-MANAGED -->

---

## Architecture

<!-- AUTO-MANAGED: architecture -->
```
opensrm/
├── spec/v1/                          # Canonical specification location
│   ├── specification.md              # Complete OpenSRM v1 spec
│   ├── schema.json                   # JSON Schema for validation
│   └── judgment-slos.md              # Judgment SLO maturity model (4 levels)
├── conventions/                      # OTel semantic convention proposals
│   ├── change-events/                # Operational change events (deploy, config, flags)
│   └── decision-telemetry/           # AI/human decision telemetry (gen_ai.decision.*)
├── components/                       # Ecosystem components (architecture-only)
│   ├── sitrep/                       # Pre-correlation layer for AI-native snapshots
│   └── incidenttown/                 # Multi-agent incident response system
├── examples/                         # Example manifests by service type
│   ├── api-*.yaml                    # API service examples
│   ├── ai-gate-*.yaml                # AI gate examples (minimal, full, security)
│   ├── batch-*.yaml                  # Batch job examples
│   └── database-*.yaml               # Database examples
├── articles/                         # Drafts and published articles
├── action/                           # GitHub Action for validation
│   ├── src/                          # TypeScript source
│   └── dist/                         # Bundled action
├── skills/shift-left-reliability/    # Claude Code skill
├── CHANGELOG.md                      # Specification version history
├── IMPLEMENTATIONS.md                # Tools implementing OpenSRM
└── .claude/                          # Claude configuration
```
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
- AI Gate extensions: judgment SLOs with 4-level maturity model (see spec/v1/judgment-slos.md)
  - Level 1 (Reactive): reversal.rate, reversal.high_confidence_failure
  - Level 2 (Proactive): audit (enabled, sample_rate, accuracy, coverage, latency)
  - Level 3 (Outcome): outcomes (defect_signals, defect_rate, false_positive_rate, outcome_latency)
  - Level 4 (Behavioral): escalation (rate bounds), segments, stability, calibration (ECE)
- Contracts vs SLOs: external promises (contract) separate from internal targets (slos)
- Dependencies with `expects` field for guaranteed requirements
- Templates for inheritance across services
- Ownership metadata with escalation paths
- Instrumentation requirements for AI gates (event/attribute mappings)
- Duration format: `[0-9]+(ms|s|m|h|d|w)`
- Ratio format: 0.0 to 1.0 (not percentages like 99.9)

### spec/v1/schema.json
JSON Schema (draft-07) definition providing:
- Schema validation for ServiceReliabilityManifest and Template kinds
- Type definitions: Duration (pattern-validated), Ratio (0-1 range), ServiceType enum (6 types), Tier enum
- Standard SLO schemas: AvailabilitySLO, LatencySLO, ErrorRateSLO, ThroughputSLO, ProcessingTimeSLO, LagSLO, SuccessRateSLO
- Batch SLO schemas: DurationSLO, ScheduleAdherenceSLO, DataFreshnessSLO
- Database SLO schemas: QueryLatencySLO, ReplicationLagSLO, ConnectionAvailabilitySLO
- Judgment SLO schemas: ReversalSLO (with rate and high_confidence_failure nested), AuditSLO, OutcomesSLO, EscalationSLO, SegmentsSLO, StabilitySLO, CalibrationSLO
- Contract schemas: Contract (with ContractLatency, ContractThroughput, ContractJudgment)
- Dependency schema with `expects` field (availability, latency.p99)
- Instrumentation schema for AI gates (events: decision/reversal/outcome/audit_result)
- Observability schema (metrics, dashboards, alerts, tracing)
- Deployment schema (environments, gates, rollback)
<!-- END AUTO-MANAGED -->

---

## Conventions

<!-- AUTO-MANAGED: conventions -->
### Specification Format
- API version: `opensrm/v1` (standardized as of CHANGELOG Unreleased - previously `opensrm.io/v1` in spec and `srm/v1` in schema/examples)
- Kinds: `ServiceReliabilityManifest` or `Template`
- Duration values: numeric + unit suffix (ms, s, m, h, d, w) - e.g., "100ms", "30d"
- Ratio values: decimal 0.0-1.0, NOT percentages (0.999 not 99.9%, 0.05 not 5%)
- Field requirements: MUST (required), SHOULD (recommended), MAY (optional)

### Service Type Mappings
- `api`: availability, latency, error_rate
- `worker`: availability, processing_time, success_rate
- `stream`: availability, lag, throughput
- `ai-gate`: extends `api` with judgment SLOs (reversal, audit, outcomes, escalation, segments, stability, calibration)
- `batch`: availability, duration, schedule_adherence, data_freshness
- `database`: availability, query_latency, replication_lag, connection_availability, throughput

### SLO Structure
All SLOs require:
- `target`: ratio (0-1) for compliance
- `window`: measurement duration (default varies by SLO type: 30d for api/database, 7d for worker/stream)

Latency/processing time SLOs require at least one percentile (p50, p90, p95, p99, p999) plus target ratio

### Judgment SLO Structure (ai-gate)
Nested structure for reversal tracking:
- `reversal.rate` (not `reversal_rate` - note the nesting)
- `reversal.high_confidence_failure` with `confidence_threshold`
- `audit.enabled`, `audit.sample_rate`, `audit.accuracy`
- `escalation.rate.min` and `escalation.rate.max` for bounds

### Contracts vs SLOs
- `spec.contract`: External promises to dependents (what you guarantee)
- `spec.slos`: Internal targets (typically tighter than contract)
- Example: contract.availability = 0.999, slos.availability.target = 0.9995

### Dependencies
- Use `expects` field to declare required guarantees from dependencies
- Format: `expects.availability` (ratio), `expects.latency.p99` (duration)
- Set `critical: true` if dependency failure causes service failure
- Optional `manifest` URL points to dependency's OpenSRM file
<!-- END AUTO-MANAGED -->

---

## Ecosystem Components

<!-- AUTO-MANAGED: ecosystem-components -->
### Implementation Tools
- **NthLayer**: Reference implementation for CI/CD enforcement of SRM manifests (validates, generates Prometheus rules and Grafana dashboards)
- **OpenSRM Validator Action**: Official GitHub Action (`rsionnach/opensrm@v1`) for CI/CD validation
- **Shift-Left Reliability Skill**: Claude Code skill for generating manifests, suggesting SLOs, and validating reliability decisions during development

### Pre-Correlation Layer
- **Sitrep**: AI-native observability snapshots layer that pre-correlates telemetry for agent consumption
  - Hybrid generation: batch (5-min), incident-triggered (immediate), refresh (1-min during incidents)
  - Integrates Change Events and Decision Telemetry OTel conventions
  - Service identity via OpenSRM manifest catalog
  - Correlation engine with temporal, topological, and log pattern analysis

### Multi-Agent Systems
- **IncidentTown**: Multi-agent incident response system (architecture-only)
  - Triage agent: initial assessment and severity classification
  - Investigation agent: root cause analysis using Sitrep snapshots
  - Communication agent: stakeholder updates and status page management
  - Remediation agent: suggests and validates fixes

### OTel Semantic Conventions (Proposed)
- **Change Events** (`change.*`): Operational changes (deploy, config, feature flags, infrastructure, database) for change-incident correlation
- **Decision Telemetry** (`gen_ai.decision.*`, `gen_ai.reversal.*`, `gen_ai.outcome.*`): AI/human decision events enabling judgment SLO measurement

Status: Specification and GitHub Action are stable. NthLayer is partially complete. Sitrep and IncidentTown are architecture-only. OTel conventions are drafted.
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
- `spec/v1/schema.json`: JSON Schema for manifest validation
- `spec/v1/judgment-slos.md`: AI gate judgment SLO maturity model (4 levels)
- `CHANGELOG.md`: Specification version history and release notes

### Ecosystem Documentation
- `README.md`: Project overview with ecosystem diagram (OpenSRM → NthLayer → Sitrep → consumers → OTel conventions), component status table, quick start examples
- `IMPLEMENTATIONS.md`: Tools implementing OpenSRM (NthLayer, GitHub Action, Shift-Left Reliability Skill), contribution guidelines for listing new tools

### OTel Semantic Conventions (Proposed)
- `conventions/change-events/`: Operational change event attributes (change.id, change.type, change.scope.service, change.risk.score)
- `conventions/decision-telemetry/`: AI/human decision event attributes (gen_ai.decision.*, gen_ai.reversal.*, gen_ai.outcome.*)

### Ecosystem Components (Architecture-Only)
- `components/sitrep/sitrep-technical-appendix.md`: Pre-correlation layer v2 spec with hybrid generation model (batch + incident-triggered), Change Event and Decision Telemetry integration, service identity via OpenSRM catalog
- `components/incidenttown/`: Multi-agent incident response system (triage, investigation, communication, remediation agents)

### Examples
- `examples/api-*.yaml`: API service examples (minimal, full, internal)
- `examples/ai-gate-*.yaml`: AI gate examples (minimal, full with all judgment SLOs, security scanner)
- `examples/batch-*.yaml`: Batch job examples
- `examples/database-*.yaml`: Database examples

### Development Tools
- `shift-left-reliability-skill.md`: Claude Code skill documentation
- `action/`: GitHub Action for CI/CD validation (rsionnach/opensrm@v1)
- `CONTRIBUTING.md`: Contribution guidelines
- `GOVERNANCE.md`: RFC process for spec changes

Files removed:
- `opensrm-v1-full-spec.md`: Consolidated into spec/v1/specification.md
- `opensrm.json`: Consolidated into spec/v1/schema.json
- `judgment-slo-spec.md`: Moved to spec/v1/judgment-slos.md
<!-- END AUTO-MANAGED -->

---

## Status

<!-- MANUAL -->
This is a draft specification under active development. The v1 spec is stabilizing but not yet finalized for production use.
<!-- END MANUAL -->

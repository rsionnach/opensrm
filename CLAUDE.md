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
├── spec/v1/                          # Versioned specification
│   ├── specification.md              # (planned location)
│   └── schema.json                   # (planned location)
├── judgment-slo-spec.md              # Judgment SLO design document
├── examples/                         # Example manifests
├── action/                           # GitHub Action for validation
│   ├── src/                         # TypeScript source
│   └── dist/                        # Bundled action
├── skills/shift-left-reliability/   # Claude Code skill
├── .beads/                          # Task tracking
└── .claude/                         # Claude configuration
```

Canonical specification files are in spec/v1/ (specification.md and schema.json).
<!-- END AUTO-MANAGED -->

---

## Specification Files

<!-- AUTO-MANAGED: specification-files -->
### spec/v1/specification.md
Complete OpenSRM v1.0.0-draft specification covering:
- Document structure (apiVersion: `opensrm.io/v1`, kind, metadata, spec)
- Service types and their applicable SLOs: api, worker, stream, ai-gate, batch, database
- Standard SLOs: availability (target ratio), latency (percentiles: p50/p90/p95/p99/p999), error_rate, throughput
- Worker-specific: processing_time, success_rate
- Stream-specific: lag (max_seconds), throughput
- Batch-specific: duration, schedule_adherence, data_freshness
- Database-specific: query_latency, replication_lag, connection_availability
- AI Gate extensions: judgment SLOs with 4-level maturity model
  - Level 1 (Reactive): reversal rate, high-confidence failure tracking
  - Level 2 (Proactive): audit sampling with accuracy/coverage/latency targets
  - Level 3 (Outcome): defect signal tracking, false positive rate, outcome latency
  - Level 4 (Behavioral): escalation rate bounds, segments, stability, calibration (ECE)
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
- Judgment SLO schemas: ReversalSLO (with rate and high_confidence_failure), AuditSLO, OutcomesSLO, EscalationSLO, SegmentsSLO, StabilitySLO, CalibrationSLO
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
- API version: `opensrm.io/v1` (spec) / `srm/v1` (JSON schema) - note the discrepancy between the two files
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
- `judgment-slo-spec.md`: Detailed specification for AI gate judgment SLOs with 4-level maturity model
- `shift-left-reliability-skill.md`: Documentation for Claude Code skill integration
- `opensrm-repo-structure.md`: Planned repository organization
- `README.md`: Project overview, branding, quick start examples, GitHub Action documentation
- `IMPLEMENTATIONS.md`: List of tools implementing OpenSRM (NthLayer reference implementation)
- `examples/`: Example manifests for different service types
- `CONTRIBUTING.md`: Contribution guidelines
- `GOVERNANCE.md`: RFC process for spec changes
<!-- END AUTO-MANAGED -->

---

## Status

<!-- MANUAL -->
This is a draft specification under active development. The v1 spec is stabilizing but not yet finalized for production use.
<!-- END MANUAL -->

# Architecture

This document describes the OpenSRM ecosystem architecture — how the specification, implementations, and semantic conventions work together.

---

## Design Principles

### 1. Schemas + Enforcement

Every component is defined by a specification first. Implementation follows. This enables:
- Multiple implementations of the same spec
- Clear contracts between components
- Validation at boundaries

### 2. Shift-Left Reliability

Reliability concerns move earlier in the lifecycle:
- Service manifests define SLOs before deployment
- CI/CD gates enforce contracts
- Decision quality is measured, not assumed

### 3. Operator-Agnostic

The stack supports both human and AI operators:
- Sitrep outputs work for dashboards (human) and LLMs (AI)
- Judgment SLOs measure decision quality regardless of decision-maker
- Decision telemetry captures human and AI decisions equally

### 4. Open Standards

Extend existing standards (OTel) rather than invent new ones. This enables ecosystem adoption.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OPENSRM ECOSYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │                    SPECIFICATION LAYER                              │     │
│  │                         (OpenSRM)                                   │     │
│  │                                                                     │     │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │     │
│  │  │ Service         │  │ ai-gate         │  │ Judgment        │    │     │
│  │  │ Manifests       │  │ Extension       │  │ SLOs            │    │     │
│  │  │                 │  │                 │  │                 │    │     │
│  │  │ • Identity      │  │ • type: ai-gate │  │ • reversal_rate │    │     │
│  │  │ • Dependencies  │  │ • Decision      │  │ • calibration   │    │     │
│  │  │ • SLO targets   │  │   tracking      │  │ • audit layers  │    │     │
│  │  │ • Contracts     │  │ • Instrumentation│ │ • maturity      │    │     │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘    │     │
│  │                                                                     │     │
│  │  Format: YAML | Validation: JSON Schema | Storage: Git             │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                      │                                       │
│              ┌───────────────────────┴───────────────────────┐              │
│              ▼                                               ▼              │
│  ┌─────────────────────────┐                ┌─────────────────────────┐    │
│  │       NTHLAYER          │                │       SITREP          │    │
│  │    (Implementation)     │                │     (Correlation)       │    │
│  │                         │                │                         │    │
│  │  ┌─────────────────┐   │                │  ┌─────────────────┐   │    │
│  │  │ Validation      │   │                │  │ Ingest          │   │    │
│  │  │ • Parse YAML    │   │                │  │ • Metrics       │   │    │
│  │  │ • Schema check  │   │                │  │ • Alerts        │   │    │
│  │  │ • Lint rules    │   │                │  │ • Changes       │   │    │
│  │  └─────────────────┘   │                │  │ • Logs          │   │    │
│  │                         │                │  └─────────────────┘   │    │
│  │  ┌─────────────────┐   │                │                         │    │
│  │  │ Generation      │   │   topology     │  ┌─────────────────┐   │    │
│  │  │ • Prom rules    │───┼───────────────▶│  │ Correlation     │   │    │
│  │  │ • Grafana       │   │                │  │ • Temporal      │   │    │
│  │  │ • PagerDuty     │   │                │  │ • Topological   │   │    │
│  │  │ • Judgment SLOs │   │                │  │ • Log patterns  │   │    │
│  │  └─────────────────┘   │                │  └─────────────────┘   │    │
│  │                         │                │                         │    │
│  │  ┌─────────────────┐   │                │  ┌─────────────────┐   │    │
│  │  │ Enforcement     │   │                │  │ Output          │   │    │
│  │  │ • CI/CD gates   │   │                │  │ • Snapshots     │   │    │
│  │  │ • Drift detect  │   │                │  │ • REST API      │   │    │
│  │  └─────────────────┘   │                │  │ • Streaming     │   │    │
│  │                         │                │  └─────────────────┘   │    │
│  └─────────────────────────┘                └────────────┬────────────┘    │
│                                                          │                  │
│                                                          ▼                  │
│                                             ┌─────────────────────────┐    │
│                                             │      CONSUMERS          │    │
│                                             │                         │    │
│                                             │  ┌───────┐ ┌───────┐   │    │
│                                             │  │  AI   │ │ Human │   │    │
│                                             │  │Agents │ │ Ops   │   │    │
│                                             │  └───┬───┘ └───┬───┘   │    │
│                                             │      │         │       │    │
│                                             │      └────┬────┘       │    │
│                                             │           │            │    │
│                                             │     Decisions          │    │
│                                             └───────────┬────────────┘    │
│                                                         │                  │
│  ┌──────────────────────────────────────────────────────┴────────────────┐│
│  │                    SEMANTIC CONVENTIONS (OTel)                         ││
│  │                                                                        ││
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    ││
│  │  │  Change Events   │  │ Decision         │  │ Outcomes         │    ││
│  │  │                  │  │ Telemetry        │  │                  │    ││
│  │  │  change.id       │  │ gen_ai.decision.*│  │ gen_ai.outcome.* │    ││
│  │  │  change.type     │  │ gen_ai.reversal.*│  │                  │    ││
│  │  │  change.scope.*  │  │                  │  │                  │    ││
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘    ││
│  │                                                                        ││
│  │  Transport: OTel Events | Storage: Any OTel-compatible backend        ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                      │                                      │
│                                      ▼                                      │
│                         ┌─────────────────────────┐                        │
│                         │    FEEDBACK LOOP        │                        │
│                         │                         │                        │
│                         │  • Judgment SLO metrics │                        │
│                         │  • Calibration updates  │                        │
│                         │  • Correlation tuning   │                        │
│                         └─────────────────────────┘                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### Specification Layer (OpenSRM)

**Purpose:** Define what "reliable" means for a service.

**Inputs:** None (source of truth)

**Outputs:** 
- YAML manifests consumed by tooling
- JSON Schema for validation

**Key design decisions:**
- Kubernetes-style structure (apiVersion, kind, metadata, spec)
- Supports inheritance via templates
- Extensible via annotations

### NthLayer (Implementation)

**Purpose:** Turn specifications into operational reality.

**Inputs:**
- OpenSRM manifests
- Prometheus endpoint (for drift detection)
- Optional: Backstage catalog, Istio service mesh

**Outputs:**
- Prometheus recording/alerting rules
- Grafana dashboards
- PagerDuty service configurations
- Topology graph (for Sitrep)
- CI/CD gate exit codes

**Key interfaces:**
```
nthlayer validate <manifest>           # Validate against schema
nthlayer generate <manifest> -o <dir>  # Generate artifacts
nthlayer check-deploy <manifest>       # CI/CD gate
nthlayer topology export <manifest>    # Export for Sitrep
```

### Sitrep (Correlation)

**Purpose:** Pre-correlate telemetry for efficient consumption.

**Inputs:**
- Metrics (Prometheus remote write)
- Alerts (Alertmanager webhook)
- Changes (GitHub, ArgoCD, LaunchDarkly webhooks)
- Logs (OTLP)
- Topology (from NthLayer)

**Outputs:**
- JSON snapshots via REST API
- Streaming updates via SSE/WebSocket
- Stored snapshots in ClickHouse

**Generation modes:**
| Mode | Trigger | Interval | Use case |
|------|---------|----------|----------|
| Batch | Timer | 5 min | Normal operations |
| Incident | Webhook | Immediate | Incident declared |
| Refresh | Timer | 1 min | Active incident |

### Semantic Conventions (OTel)

**Purpose:** Standardize operational signals for interoperability.

**Change Events:**
- Operational changes (deploy, config, feature flag)
- Enables correlation to incidents
- Proposed as OTel semantic convention

**Decision Telemetry:**
- AI/human decisions with confidence
- Reversals (human overrides)
- Outcomes (ground truth)
- Enables judgment SLO measurement

---

## Data Flows

### Flow 1: Manifest → Monitoring

```
Developer              NthLayer              Monitoring
   │                      │                      │
   │  manifest.yaml       │                      │
   ├─────────────────────▶│                      │
   │                      │                      │
   │                      │  prometheus/rules.yaml
   │                      ├─────────────────────▶│
   │                      │                      │
   │                      │  grafana/dashboard.json
   │                      ├─────────────────────▶│
   │                      │                      │
   │                      │  topology.json       │
   │                      ├──────────┐           │
   │                      │          │           │
   │                      │          ▼           │
   │                      │      Sitrep        │
```

### Flow 2: Telemetry → Snapshot → Decision

```
Systems              Sitrep            Consumer           Telemetry
   │                    │                    │                  │
   │ metrics, alerts    │                    │                  │
   ├───────────────────▶│                    │                  │
   │                    │                    │                  │
   │ change events      │                    │                  │
   ├───────────────────▶│                    │                  │
   │                    │                    │                  │
   │                    │  snapshot (JSON)   │                  │
   │                    ├───────────────────▶│                  │
   │                    │                    │                  │
   │                    │                    │  decision event  │
   │                    │                    ├─────────────────▶│
   │                    │                    │                  │
   │                    │                    │  [human reviews] │
   │                    │                    │                  │
   │                    │                    │  reversal event  │
   │                    │                    ├─────────────────▶│
```

### Flow 3: Decision → SLO Measurement

```
Telemetry           Prometheus           Alerting
   │                    │                    │
   │ decision events    │                    │
   ├───────────────────▶│                    │
   │                    │                    │
   │ reversal events    │                    │
   ├───────────────────▶│                    │
   │                    │                    │
   │                    │ reversal_rate      │
   │                    │ = 0.032            │
   │                    │                    │
   │                    │ (target: 0.05)     │
   │                    │ ✓ within budget    │
   │                    │                    │
   │                    │ [if breach]        │
   │                    ├───────────────────▶│ alert
```

---

## Integration Points

### External Systems

| System | Integration | Direction |
|--------|-------------|-----------|
| Prometheus | Remote write, query | Metrics → Sitrep |
| Alertmanager | Webhook | Alerts → Sitrep |
| GitHub | Webhook, API | Deploys → Sitrep |
| ArgoCD | Webhook | Deploys → Sitrep |
| LaunchDarkly | Webhook | Flags → Sitrep |
| PagerDuty | API, webhook | Incidents ↔ Sitrep, Config ← NthLayer |
| Grafana | JSON import | Dashboards ← NthLayer |
| OTel Collector | OTLP | Logs, traces → Sitrep |

### Internal Interfaces

| From | To | Format | Data |
|------|-----|--------|------|
| Git | NthLayer | YAML | ServiceManifests |
| NthLayer | Prometheus | YAML | Alert rules |
| NthLayer | Grafana | JSON | Dashboards |
| NthLayer | Sitrep | JSON | Topology graph |
| Sitrep | Consumers | JSON/SSE | Snapshots |
| Consumers | OTel | Events | Decision telemetry |

---

## Judgment SLO Measurement

### Metrics Computed

```
reversal_rate = 
  sum(rate(gen_ai_reversals_total[30d])) 
  / 
  sum(rate(gen_ai_decisions_total[30d]))

high_confidence_failure_rate = 
  sum(rate(gen_ai_reversals_total{confidence_bucket=">0.9"}[30d])) 
  / 
  sum(rate(gen_ai_decisions_total{confidence_bucket=">0.9"}[30d]))

calibration_ece = 
  sum(abs(accuracy_by_bin - confidence_by_bin) * weight_by_bin)
```

### Maturity Levels

| Level | What's Measured | Effort |
|-------|-----------------|--------|
| 1: Reactive | Reversal rate (when humans forced to engage) | Minimal |
| 2: Proactive | Audit accuracy (spot-check random sample) | Moderate |
| 3: Outcome | Defect rate (actual correctness from consequences) | High |
| 4: Behavioral | Escalation appropriateness, segment gaps | High |

---

## Deployment Considerations

### Minimal Setup

For teams just starting:
1. Write OpenSRM manifests
2. Use GitHub Action for validation
3. Manually configure monitoring

### Standard Setup

For teams with automation:
1. OpenSRM manifests in Git
2. NthLayer in CI/CD pipeline
3. Generated Prometheus/Grafana configs
4. Drift detection alerts

### Full Setup

For AI-augmented operations:
1. All of Standard Setup
2. Sitrep ingesting telemetry
3. AI agents consuming snapshots
4. Decision telemetry flowing
5. Judgment SLO dashboards

---

## Security Model

### Data Classification

| Data | Sensitivity | Handling |
|------|-------------|----------|
| Manifests | Low | Public or internal Git |
| Metrics | Low-Medium | Standard observability controls |
| Logs | Medium-High | PII redaction required |
| Snapshots | Medium | Access control, tenant isolation |
| Decision telemetry | Low-Medium | Anonymize actor IDs if needed |

### Access Control

- **OpenSRM manifests:** Developer write, CI/CD read
- **NthLayer:** CI/CD service accounts
- **Sitrep API:** Service accounts for agents, RBAC for humans
- **Decision telemetry:** Write from agents, read for metrics

<div align="center">
  <h1>OpenSRM</h1>
  <p><strong>The Open Service Reliability Manifest</strong></p>
  <p>A specification and ecosystem for declaring, enforcing, and measuring service reliability as code.</p>

  <br>

  [![Status: Draft](https://img.shields.io/badge/Status-Draft-orange?style=for-the-badge)](https://github.com/rsionnach/opensrm)
  [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-green?style=for-the-badge)](LICENSE)
  [![Spec: v1](https://img.shields.io/badge/Spec-v1-blue?style=for-the-badge)](spec/v1/specification.md)

</div>

---

## TL;DR

```yaml
# service.reliability.yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: payment-api
  team: payments
  tier: critical

spec:
  type: api

  slos:
    availability:
      target: 0.9995
      window: 30d
    latency:
      p99: 200ms
      target: 0.995

  dependencies:
    - service: database
      critical: true
      expects:
        availability: 0.99999
```

---

## The Problem

Reliability requirements are scattered across wikis, runbooks, Slack threads, and tribal knowledge. Services ship to production without defined SLOs, ownership, or operational readiness. Reliability decisions happen in postmortems instead of before deployment.

We have version control for code (Git), infrastructure (Terraform), and policy (OPA). We're missing version control for reliability.

## The Solution

OpenSRM defines reliability requirements in a single manifest that travels with your service:

```
service.reliability.yaml --> validate --> enforce --> deploy
         |                     |          |
         |                     |          +-- Error budget ok? SLO met?
         |                     |
         |                     +-- Schema valid? Metrics exist? Dashboard ready?
         |
         +-- SLOs, dependencies, ownership, observability, deployment gates
```

---

## The Ecosystem

OpenSRM is the foundation for a complete operational reliability stack:

```
+-----------------------------------------------------------------------------+
|                              OPENSRM ECOSYSTEM                              |
+-----------------------------------------------------------------------------+
|                                                                             |
|   +--------------------------------------------------------------------+   |
|   |                         SPECIFICATION                              |   |
|   |                                                                    |   |
|   |   ServiceManifests    |    ai-gate type    |    Judgment SLOs     |   |
|   |   (identity, deps,    |    (AI decision    |    (reversal rate,   |   |
|   |    SLO targets)       |     services)      |     calibration)     |   |
|   +--------------------------------------------------------------------+   |
|                                     |                                      |
|                +--------------------+--------------------+                 |
|                v                                         v                 |
|   +-------------------------+            +-------------------------+      |
|   |        NTHLAYER         |            |        SITREP           |      |
|   |    (Implementation)     |            |      (Correlation)      |      |
|   |                         |            |                         |      |
|   |  * Manifest validation  |            |  * Pre-correlation      |      |
|   |  * Prometheus rules     |----------->|  * Change attribution   |      |
|   |  * Grafana dashboards   |  topology  |  * AI-native snapshots  |      |
|   |  * CI/CD enforcement    |            |                         |      |
|   +-------------------------+            +------------+------------+      |
|                                                       |                    |
|                                                       v                    |
|                                          +-------------------------+      |
|                                          |       CONSUMERS         |      |
|                                          |                         |      |
|                                          |  * AI Agents            |      |
|                                          |  * Human operators      |      |
|                                          |  * Dashboards           |      |
|                                          +------------+------------+      |
|                                                       |                    |
|   +-------------------------------------------------------------------+   |
|   |                    SEMANTIC CONVENTIONS (OTel)                     |   |
|   |                                                                   |   |
|   |   Change Events        |    Decision Telemetry    |    Outcomes   |   |
|   |   (deploy, config,     |    (gen_ai.decision.*,   |    (feedback, |   |
|   |    feature flags)      |     gen_ai.reversal.*)   |  calibration) |   |
|   +-------------------------------------------------------------------+   |
|                                                                             |
+-----------------------------------------------------------------------------+
```

## Components

| Component | Purpose | Status |
|-----------|---------|--------|
| [Specification](spec/v1/specification.md) | Core manifest schema | Stable |
| [ai-gate Extension](spec/v1/specification.md#5-judgment-slos-ai-gates) | AI decision services | Stable |
| [Judgment SLOs](spec/v1/judgment-slos.md) | Decision quality metrics | Documented |
| [GitHub Action](action/) | CI/CD validation | Available |
| [NthLayer](https://github.com/rsionnach/nthlayer) | Reference implementation | Partial |
| [Change Events](conventions/change-events/) | OTel semantic conventions | Drafted |
| [Decision Telemetry](conventions/decision-telemetry/) | OTel semantic conventions | Drafted |
| [Sitrep](components/sitrep/) | Pre-correlation layer | In design |

See [STATUS.md](STATUS.md) for detailed progress.

---

## Core Features

### Contracts & SLOs

OpenSRM separates what you promise externally (contracts) from what you measure internally (SLOs):

```yaml
spec:
  contract:
    availability: 0.999
    latency:
      p99: 300ms

  slos:
    availability:
      target: 0.9995    # Internal target is tighter
      window: 30d
```

### Dependency-Aware SLO Feasibility

Declare dependencies with expected guarantees. Tools can calculate your maximum achievable SLO.

```yaml
dependencies:
  - service: postgresql
    critical: true
    expects:
      availability: 0.9995
  - service: user-service
    critical: true
    manifest: https://github.com/org/user-service/blob/main/service.reliability.yaml
    expects:
      availability: 0.999
      latency:
        p99: 100ms
```

### Ownership & Escalation

Never wonder who owns a service or how to reach them.

```yaml
ownership:
  team: payments
  slack: "#payments-team"
  escalation: payments-oncall
  pagerduty:
    service_id: PXXXXXX
  runbook: https://wiki.example.com/payment-api-runbook
```

### Observability Requirements

Declare what metrics, dashboards, and alerts must exist.

```yaml
observability:
  metrics:
    required:
      - http_server_request_duration_seconds
      - http_server_requests_total
  dashboards:
    required: true
  alerts:
    required: true
```

### Deployment Gates

Block deploys based on error budgets, SLO compliance, or recent incidents.

```yaml
deployment:
  gates:
    error_budget:
      enabled: true
      threshold: 0
    slo_compliance:
      enabled: true
      min_compliance: 0.99
    recent_incidents:
      enabled: true
      lookback: 7d
      max_p1: 0
```

### Templates for Inheritance

Define standard configurations once and inherit across services:

```yaml
# Template definition
apiVersion: opensrm/v1
kind: Template
metadata:
  name: api-critical
spec:
  slos:
    availability:
      target: 0.9999

# Service inherits from template
metadata:
  name: checkout-api
  template: api-critical
```

---

## AI Gate Support

For AI-powered decision systems, OpenSRM supports [judgment SLOs](spec/v1/specification.md#5-judgment-slos-ai-gates) that measure decision quality, not just uptime. A [layered maturity model](spec/v1/judgment-slos.md) supports incremental adoption -- from basic reversal tracking through audit sampling, outcome-based ground truth, and segment-level analysis.

```yaml
spec:
  type: ai-gate
  slos:
    judgment:
      reversal:
        rate:
          target: 0.05
          window: 30d
        high_confidence_failure:
          target: 0.02
          confidence_threshold: 0.9
      audit:
        enabled: true
        sample_rate: 0.10
        accuracy:
          target: 0.95
          window: 30d
      escalation:
        rate:
          min: 0.05
          max: 0.30
```

See [Judgment SLOs](spec/v1/judgment-slos.md) for the full framework.

---

## Semantic Conventions

OpenSRM proposes OTel semantic conventions for operational signals:

### Change Events

Standardized schema for operational changes (deploys, config, feature flags). These enable correlation between changes and incidents.

```yaml
# OTel Event
name: change
attributes:
  change.id: chg-deploy-001
  change.type: deployment
  change.scope.service: payment-service
  change.timestamp: "2026-02-20T14:25:00Z"
```

See [conventions/change-events/](conventions/change-events/).

### Decision Telemetry

Standardized schema for AI/human decisions and their outcomes.

```yaml
# AI makes a decision
gen_ai.decision.id: dec-001
gen_ai.decision.value: approve
gen_ai.decision.confidence: 0.87

# Human overrides
gen_ai.reversal.decision_id: dec-001
gen_ai.reversal.type: human_override
gen_ai.reversal.new_value: request_changes
```

See [conventions/decision-telemetry/](conventions/decision-telemetry/).

---

## Quick Start

### 1. Create an OpenSRM manifest

```yaml
# service.reliability.yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: my-service
  team: my-team
  tier: standard

spec:
  type: api
  slos:
    availability:
      target: 0.999
      window: 30d
```

### 2. Validate it

```bash
# Using the OpenSRM GitHub Action (recommended)
# See GitHub Action section below

# Or using a JSON Schema validator
npx ajv validate -s spec/v1/schema.json -d service.reliability.yaml

# Or using NthLayer (reference implementation)
nthlayer validate service.reliability.yaml
```

### 3. Enforce it

```bash
# Check if the service meets its declared requirements
nthlayer check --manifest service.reliability.yaml

# Gate a deployment
nthlayer check-deploy --manifest service.reliability.yaml --exit-on-failure
```

---

## GitHub Action

Validate OpenSRM manifests in your CI/CD pipeline with the official GitHub Action.

### Basic Usage

```yaml
- uses: rsionnach/opensrm@v1
  with:
    manifest: 'service.reliability.yaml'
```

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `manifest` | Path to manifest file (supports glob patterns) | Yes | - |
| `schema-version` | Schema version to validate against | No | `v1` |
| `strict` | Fail on warnings (missing recommended fields) | No | `false` |

### Outputs

| Output | Description |
|--------|-------------|
| `valid` | Whether all manifests are valid (`true`/`false`) |
| `validated-count` | Number of manifests validated |
| `warnings-count` | Number of warnings generated |

### Full Workflow Example

```yaml
name: Validate OpenSRM

on:
  push:
    paths:
      - '**/*.reliability.yaml'
      - '**/service.reliability.yaml'
  pull_request:
    paths:
      - '**/*.reliability.yaml'
      - '**/service.reliability.yaml'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate OpenSRM manifests
        uses: rsionnach/opensrm@v1
        with:
          manifest: '**/*.reliability.yaml'
          strict: 'false'
```

---

## What You Can Do With OpenSRM

| Use Case | Description |
|----------|-------------|
| **Pre-deployment validation** | Check that metrics, dashboards, and alerts exist before shipping |
| **SLO feasibility checks** | Validate that targets are achievable given dependencies |
| **Drift detection** | Alert when declared vs. actual reliability diverges |
| **Deployment gating** | Block releases when error budgets are exhausted |
| **Service catalog enrichment** | Feed reliability metadata into Backstage, Cortex, etc. |
| **Audit & compliance** | Prove that services meet reliability standards |

---

## How OpenSRM Is Different

| Traditional Approach | OpenSRM |
|---------------------|---------|
| SLOs in wiki pages | SLOs in version-controlled YAML |
| Ownership in tribal knowledge | Ownership declared and discoverable |
| Dependencies undocumented | Dependencies explicit with criticality |
| Observability requirements assumed | Observability requirements enforced |
| "Is this ready?" = opinion | "Is this ready?" = schema validation |

---

## Documentation

| Resource | Description |
|----------|-------------|
| **[Full Specification](spec/v1/specification.md)** | Complete OpenSRM schema reference |
| **[JSON Schema](spec/v1/schema.json)** | For validation tooling |
| **[Judgment SLOs](spec/v1/judgment-slos.md)** | AI decision quality framework |
| **[Examples](examples/)** | Real-world OpenSRM manifest examples |
| **[Architecture](ARCHITECTURE.md)** | Ecosystem architecture and data flows |
| **[Shift-Left Reliability Skill](shift-left-reliability-skill.md)** | Claude Code skill for generating manifests |
| **[Contributing](CONTRIBUTING.md)** | How to contribute |
| **[Governance](GOVERNANCE.md)** | RFC process for spec changes |

---

## Implementations

Tools that implement OpenSRM:

| Tool | Type | Status |
|------|------|--------|
| [NthLayer](https://github.com/rsionnach/nthlayer) | CI/CD enforcement | Reference implementation |

> [Full implementations list](IMPLEMENTATIONS.md)

*Building a tool that implements OpenSRM? [Add it to the list](CONTRIBUTING.md).*

---

## Design Principles

1. **Declare intent, not implementation** -- Specify *what* reliability you need, not *how* to achieve it
2. **Schemas + enforcement** -- Define contracts, then validate them
3. **Tooling-agnostic** -- Works with Prometheus, Datadog, or any backend
4. **Progressive complexity** -- Simple services need simple manifests; complex services can use advanced features
5. **AI-native** -- First-class support for AI decision services

---

## Relationship to Other Standards

| Standard | Relationship |
|----------|--------------|
| **[OpenSLO](https://openslo.com/)** | Complementary -- OpenSRM adds service context around SLO definitions |
| **[OpenTelemetry](https://opentelemetry.io/)** | Extends -- Change events and decision telemetry as OTel conventions |
| **[Kubernetes](https://kubernetes.io/)** | Aligned -- Manifest structure follows K8s conventions |
| **[Backstage](https://backstage.io/)** | Integrates -- Manifests can populate service catalogs |

---

## Contributing

We welcome contributions to OpenSRM. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Major changes go through the RFC process described in [GOVERNANCE.md](GOVERNANCE.md).

---

## License

Apache License 2.0 -- See [LICENSE](LICENSE)

---

## Acknowledgments

OpenSRM builds on ideas from:

- [OpenSLO](https://openslo.com/) -- SLO specification
- [OpenTelemetry](https://opentelemetry.io/docs/specs/semconv/) -- Semantic Conventions
- [Google SRE Handbook](https://sre.google/sre-book/table-of-contents/) -- SLO/SLI concepts
- [Backstage](https://backstage.io/) -- Service catalog patterns

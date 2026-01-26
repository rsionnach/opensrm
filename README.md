<div align="center">
  <h1>Service Reliability Manifest (SRM)</h1>
  <p><strong>Version control for reliability.</strong></p>
  <p>Define reliability requirements as code. Declare SLOs, dependencies, and ownership in a single manifest that travels with your service.</p>

  <br>

  [![Status: Draft](https://img.shields.io/badge/Status-Draft-orange?style=for-the-badge)](https://github.com/rsionnach/opensrm)
  [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-green?style=for-the-badge)](LICENSE)
  [![Spec: v1](https://img.shields.io/badge/Spec-v1-blue?style=for-the-badge)](spec/v1/specification.md)

</div>

---

## TL;DR

```yaml
# service.reliability.yaml
apiVersion: srm/v1
kind: ServiceReliabilityManifest
metadata:
  name: payment-api
  team: payments
  tier: critical

spec:
  slos:
    availability:
      target: 99.95
      window: 30d
```

---

## ⚠️ The Problem

Reliability requirements are scattered across wikis, runbooks, Slack threads, and tribal knowledge. Services ship to production without defined SLOs, ownership, or operational readiness. Reliability decisions happen in postmortems instead of before deployment.

We have version control for code (Git), infrastructure (Terraform), and policy (OPA). We're missing version control for reliability.

## 💡 The Solution

Define reliability requirements in a single manifest that travels with your service:

```
service.reliability.yaml → validate → enforce → deploy
         │                     │          │
         │                     │          └── Error budget ok? SLO met?
         │                     │
         │                     └── Schema valid? Metrics exist? Dashboard ready?
         │
         └── SLOs, dependencies, ownership, observability, deployment gates
```

---

## ⚡ Core Features

### Machine-Readable & Human-Readable

```yaml
spec:
  slos:
    availability:
      target: 99.95
      window: 30d
    latency:
      target: 200
      unit: ms
      percentile: p99

  dependencies:
    - name: postgresql
      critical: true
    - name: redis
      critical: false
```

### Dependency-Aware SLO Feasibility

Declare dependencies with criticality. Tools can calculate your maximum achievable SLO.

```yaml
dependencies:
  - name: postgresql
    critical: true
    slo:
      availability: 99.95
  - name: user-service
    critical: true
    manifest: https://github.com/org/user-service/blob/main/service.reliability.yaml
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

### AI Gate Support

For AI-powered decision systems, declare judgment SLOs that measure decision quality, not just uptime.

```yaml
spec:
  type: ai-gate
  slos:
    judgment:
      reversal_rate:
        target: 0.05
        window: 30d
      high_confidence_failure:
        target: 0.02
        window: 30d
```

---

## 📋 What You Can Do With It

| Use Case | Description |
|----------|-------------|
| **Pre-deployment validation** | Check that metrics, dashboards, and alerts exist before shipping |
| **SLO feasibility checks** | Validate that targets are achievable given dependencies |
| **Drift detection** | Alert when declared vs. actual reliability diverges |
| **Deployment gating** | Block releases when error budgets are exhausted |
| **Service catalog enrichment** | Feed reliability metadata into Backstage, Cortex, etc. |
| **Audit & compliance** | Prove that services meet reliability standards |

---

## 🎯 How It's Different

| Traditional Approach | Service Reliability Manifest |
|---------------------|------------------------------|
| SLOs in wiki pages | SLOs in version-controlled YAML |
| Ownership in tribal knowledge | Ownership declared and discoverable |
| Dependencies undocumented | Dependencies explicit with criticality |
| Observability requirements assumed | Observability requirements enforced |
| "Is this ready?" = opinion | "Is this ready?" = schema validation |

---

## 📚 Documentation

| Resource | Description |
|----------|-------------|
| **[Full Specification](spec/v1/specification.md)** | Complete schema reference |
| **[JSON Schema](spec/v1/schema.json)** | For validation tooling |
| **[Examples](examples/)** | Real-world manifest examples |
| **[Contributing](CONTRIBUTING.md)** | How to contribute |
| **[Governance](GOVERNANCE.md)** | RFC process for spec changes |

---

## 🔧 Implementations

Tools that implement the Service Reliability Manifest:

| Tool | Type | Status |
|------|------|--------|
| [NthLayer](https://github.com/rsionnach/nthlayer) | CI/CD enforcement | Reference implementation |

→ [Full implementations list](IMPLEMENTATIONS.md)

*Building a tool that implements SRM? [Add it to the list](CONTRIBUTING.md).*

---

## 🚀 Quick Start

### 1. Create a manifest

```yaml
# service.reliability.yaml
apiVersion: srm/v1
kind: ServiceReliabilityManifest
metadata:
  name: my-service
  team: my-team
  tier: standard

spec:
  slos:
    availability:
      target: 99.9
      window: 30d
```

### 2. Validate it

```bash
# Using a JSON Schema validator
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

## 🔄 GitHub Action

Validate SRM manifests in your CI/CD pipeline with the official GitHub Action.

### Basic Usage

```yaml
- uses: opensrm/opensrm@v1
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
name: Validate SRM

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

      - name: Validate SRM manifests
        uses: opensrm/opensrm@v1
        with:
          manifest: '**/*.reliability.yaml'
          strict: 'false'
```

---

## 🏗️ Design Principles

1. **Declare intent, not implementation** — Specify *what* reliability you need, not *how* to achieve it
2. **Complement existing standards** — Align with OpenSLO, OpenTelemetry, and Kubernetes conventions
3. **Progressive complexity** — Simple services need simple manifests; complex services can use advanced features
4. **Fail open by default** — Missing optional fields shouldn't block adoption

---

## 🔗 Relationship to Other Standards

| Standard | Relationship |
|----------|--------------|
| **[OpenSLO](https://openslo.com/)** | SRM can reference OpenSLO definitions or embed SLO targets directly |
| **[OpenTelemetry](https://opentelemetry.io/)** | Metric names follow OTel Semantic Conventions |
| **[Kubernetes](https://kubernetes.io/)** | Manifest structure follows K8s conventions (apiVersion, kind, metadata, spec) |
| **[Backstage](https://backstage.io/)** | SRM manifests can be consumed by Backstage catalog plugins |

---

## 🤝 Contributing

We welcome contributions to the specification. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Major changes go through the RFC process described in [GOVERNANCE.md](GOVERNANCE.md).

---

## 📄 License

Apache License 2.0 — See [LICENSE](LICENSE)

---

## 🙏 Acknowledgments

This specification builds on ideas from:

- [OpenSLO](https://openslo.com/) — SLO specification
- [OpenTelemetry](https://opentelemetry.io/docs/specs/semconv/) — Semantic Conventions
- [Google SRE Handbook](https://sre.google/sre-book/table-of-contents/) — SLO/SLI concepts
- [Backstage](https://backstage.io/) — Service catalog patterns

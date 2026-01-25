# Service Reliability Manifest (SRM)

A specification for declaring service reliability requirements as code.

## What Is This?

The Service Reliability Manifest is a declarative schema for defining how reliable a service should be—its SLO targets, ownership, dependencies, and operational requirements. It's designed to be:

- **Machine-readable** — Validate and enforce in CI/CD pipelines
- **Human-readable** — Engineers can understand requirements at a glance
- **Tool-agnostic** — Any platform can implement the spec
- **Composable** — Works alongside existing standards (OpenSLO, OpenTelemetry)

## The Problem

Reliability requirements are scattered across wikis, runbooks, Slack threads, and tribal knowledge. Services ship to production without defined SLOs, ownership, or operational readiness. Reliability decisions happen in postmortems instead of before deployment.

We have version control for code (Git), infrastructure (Terraform), and policy (OPA). We're missing version control for reliability.

## The Solution

Define reliability requirements in a single manifest that travels with your service:

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
    latency:
      target: 200
      unit: ms
      percentile: p99

  dependencies:
    - name: postgresql
      critical: true
    - name: redis
      critical: false
    - name: user-service
      critical: true

  ownership:
    team: payments
    escalation: payments-oncall
    runbook: https://wiki.example.com/payment-api-runbook

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

## What You Can Do With It

| Use Case | How |
|----------|-----|
| **Pre-deployment validation** | Check that metrics, dashboards, and alerts exist before shipping |
| **SLO feasibility checks** | Validate that targets are achievable given dependencies |
| **Drift detection** | Alert when declared vs. actual reliability diverges |
| **Deployment gating** | Block releases when error budgets are exhausted |
| **Service catalog enrichment** | Feed reliability metadata into Backstage, Cortex, etc. |
| **Audit & compliance** | Prove that services meet reliability standards |

## Specification

📄 **[Full Specification](spec/v1/specification.md)** — Complete schema reference

📋 **[JSON Schema](spec/v1/schema.json)** — For validation tooling

📁 **[Examples](examples/)** — Real-world manifest examples

## Implementations

Tools that implement the Service Reliability Manifest:

| Tool | Type | Status |
|------|------|--------|
| [NthLayer](https://github.com/rsionnach/nthlayer) | CI/CD enforcement | Reference implementation |

→ [Full implementations list](IMPLEMENTATIONS.md)

*Building a tool that implements SRM? [Add it to the list](CONTRIBUTING.md).*

## Design Principles

1. **Declare intent, not implementation** — Specify *what* reliability you need, not *how* to achieve it
2. **Complement existing standards** — Align with OpenSLO, OpenTelemetry, and Kubernetes conventions
3. **Progressive complexity** — Simple services need simple manifests; complex services can use advanced features
4. **Fail open by default** — Missing optional fields shouldn't block adoption

## Relationship to Other Standards

| Standard | Relationship |
|----------|--------------|
| **OpenSLO** | SRM can reference OpenSLO definitions or embed SLO targets directly |
| **OpenTelemetry** | Metric names follow OTel Semantic Conventions |
| **Kubernetes** | Manifest structure follows K8s conventions (apiVersion, kind, metadata, spec) |
| **Backstage** | SRM manifests can be consumed by Backstage catalog plugins |

## Quick Start

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

## Contributing

We welcome contributions to the specification. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Major changes go through the RFC process described in [GOVERNANCE.md](GOVERNANCE.md).

## License

Apache License 2.0 — See [LICENSE](LICENSE)

## Acknowledgments

This specification builds on ideas from:

- [OpenSLO](https://openslo.com/) — SLO specification
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/) — Metric naming
- [Google SRE Handbook](https://sre.google/sre-book/table-of-contents/) — SLO/SLI concepts
- [Backstage](https://backstage.io/) — Service catalog patterns

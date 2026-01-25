# Service Reliability Manifest Specification

**Version:** 1.0.0-draft  
**Status:** Draft  
**Last Updated:** 2026-01-23

## Table of Contents

1. [Overview](#overview)
2. [Document Structure](#document-structure)
3. [Metadata](#metadata)
4. [Spec](#spec)
   - [SLOs](#slos)
   - [Dependencies](#dependencies)
   - [Ownership](#ownership)
   - [Observability](#observability)
   - [Deployment](#deployment)
5. [Validation Rules](#validation-rules)
6. [Extension Points](#extension-points)

---

## Overview

A Service Reliability Manifest (SRM) is a YAML document that declares the reliability requirements for a service. It answers:

- **How reliable should this service be?** (SLOs)
- **What does it depend on?** (Dependencies)
- **Who owns it?** (Ownership)
- **How do we observe it?** (Observability)
- **What are the deployment constraints?** (Deployment)

### Filename Convention

Manifests SHOULD be named `service.reliability.yaml` or `<service-name>.reliability.yaml` and placed in the service's repository root.

### Encoding

Manifests MUST be valid YAML 1.2 encoded as UTF-8.

---

## Document Structure

Every manifest has four top-level fields:

```yaml
apiVersion: srm/v1          # Required
kind: ServiceReliabilityManifest  # Required
metadata: {}                # Required
spec: {}                    # Required
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiVersion` | string | Yes | Schema version. Must be `srm/v1` |
| `kind` | string | Yes | Must be `ServiceReliabilityManifest` |
| `metadata` | object | Yes | Service identity and classification |
| `spec` | object | Yes | Reliability requirements |

---

## Metadata

The `metadata` section identifies the service and its classification.

```yaml
metadata:
  name: payment-api
  team: payments
  tier: critical
  description: Handles payment processing for checkout
  labels:
    domain: commerce
    cost-center: engineering
  annotations:
    example.com/custom-field: value
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique service identifier. Must match `[a-z0-9-]+` |
| `team` | string | Yes | Owning team identifier |
| `tier` | enum | Yes | Service criticality: `critical`, `high`, `standard`, `low` |
| `description` | string | No | Human-readable description |
| `labels` | map[string]string | No | Key-value pairs for filtering/grouping |
| `annotations` | map[string]string | No | Arbitrary metadata (not used for selection) |

### Tier Definitions

| Tier | Typical SLO | Characteristics |
|------|-------------|-----------------|
| `critical` | 99.95%+ | Revenue/safety impact, 24/7 on-call, incident commander required |
| `high` | 99.9% | Significant user impact, business-hours on-call |
| `standard` | 99.5% | Moderate impact, next-business-day response acceptable |
| `low` | 99% | Minimal impact, best-effort support |

Implementations MAY enforce tier-specific requirements (e.g., `critical` tier requires runbook URL).

---

## Spec

The `spec` section contains all reliability requirements.

### SLOs

Defines Service Level Objectives.

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
      window: 30d
      
    error_rate:
      target: 0.1
      unit: percent
      window: 7d
      
    throughput:
      target: 1000
      unit: rps
      window: 1h
```

#### Availability

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | number | Yes | Target percentage (e.g., 99.95) |
| `window` | duration | No | Measurement window. Default: `30d` |

#### Latency

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | number | Yes | Target value |
| `unit` | enum | Yes | `ms` or `s` |
| `percentile` | enum | Yes | `p50`, `p90`, `p95`, `p99`, `p999` |
| `window` | duration | No | Measurement window. Default: `30d` |

#### Error Rate

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | number | Yes | Maximum error rate |
| `unit` | enum | Yes | `percent` or `ratio` |
| `window` | duration | No | Measurement window. Default: `30d` |

#### Throughput

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | number | Yes | Minimum throughput |
| `unit` | enum | Yes | `rps`, `rpm`, `rph` |
| `window` | duration | No | Measurement window. Default: `1h` |

#### Duration Format

Durations use a number followed by a unit suffix:

| Suffix | Meaning |
|--------|---------|
| `m` | minutes |
| `h` | hours |
| `d` | days |

Examples: `30d`, `7d`, `24h`, `1h`

#### OpenSLO Reference

Instead of inline definitions, manifests MAY reference external OpenSLO files:

```yaml
spec:
  slos:
    openslo:
      - path: ./slos/availability.yaml
      - path: ./slos/latency.yaml
```

---

### Dependencies

Declares upstream dependencies and their criticality.

```yaml
spec:
  dependencies:
    - name: postgresql
      type: database
      critical: true
      slo:
        availability: 99.95
        
    - name: redis
      type: cache
      critical: false
      
    - name: user-service
      type: service
      critical: true
      manifest: https://github.com/org/user-service/blob/main/service.reliability.yaml
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Dependency identifier |
| `type` | enum | No | `service`, `database`, `cache`, `queue`, `external` |
| `critical` | boolean | No | Whether failure causes service failure. Default: `true` |
| `slo.availability` | number | No | Expected availability of dependency |
| `manifest` | string | No | URL to dependency's SRM manifest |

#### Dependency Impact

When `critical: true`, the dependency's availability is factored into SLO feasibility calculations:

```
max_achievable = dependency_1_slo × dependency_2_slo × ... × dependency_n_slo
```

If `max_achievable < service_target`, implementations SHOULD warn about infeasible SLO targets.

---

### Ownership

Defines who owns the service and how to reach them.

```yaml
spec:
  ownership:
    team: payments
    slack: "#payments-team"
    email: payments@example.com
    escalation: payments-oncall
    pagerduty:
      service_id: PXXXXXX
      escalation_policy_id: PXXXXXX
    runbook: https://wiki.example.com/payment-api-runbook
    documentation: https://docs.example.com/payment-api
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `team` | string | Yes | Team identifier (should match `metadata.team`) |
| `slack` | string | No | Slack channel for the team |
| `email` | string | No | Team email address |
| `escalation` | string | No | On-call rotation or escalation policy name |
| `pagerduty.service_id` | string | No | PagerDuty service ID |
| `pagerduty.escalation_policy_id` | string | No | PagerDuty escalation policy ID |
| `runbook` | string | No | URL to operational runbook |
| `documentation` | string | No | URL to service documentation |

Implementations MAY require certain fields based on tier (e.g., `critical` tier requires `runbook`).

---

### Observability

Declares observability requirements.

```yaml
spec:
  observability:
    metrics:
      required:
        - http_server_request_duration_seconds
        - http_server_requests_total
        - http_server_active_requests
      labels:
        required:
          - service
          - method
          - status_code
      convention: opentelemetry  # or "prometheus"
      
    dashboards:
      required: true
      urls:
        - https://grafana.example.com/d/payment-api
        
    alerts:
      required: true
      definitions:
        - name: HighErrorRate
          severity: critical
          threshold: "error_rate > 1%"
        - name: HighLatency
          severity: warning
          threshold: "p99_latency > 500ms"
          
    tracing:
      required: true
      sampling_rate: 0.1
```

#### Metrics

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `required` | []string | No | Metric names that must exist |
| `labels.required` | []string | No | Labels that must be present on metrics |
| `convention` | enum | No | Naming convention: `opentelemetry`, `prometheus`. Default: `opentelemetry` |

#### Dashboards

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `required` | boolean | No | Whether dashboards must exist |
| `urls` | []string | No | URLs to service dashboards |

#### Alerts

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `required` | boolean | No | Whether alerts must be configured |
| `definitions` | []AlertDef | No | Alert definitions |

AlertDef:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Alert name |
| `severity` | enum | Yes | `critical`, `warning`, `info` |
| `threshold` | string | No | Human-readable threshold description |

#### Tracing

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `required` | boolean | No | Whether distributed tracing must be enabled |
| `sampling_rate` | number | No | Expected sampling rate (0.0 - 1.0) |

---

### Deployment

Declares deployment constraints and requirements.

```yaml
spec:
  deployment:
    environments:
      - production
      - staging
      
    gates:
      error_budget:
        enabled: true
        threshold: 0  # Block when budget exhausted
      slo_compliance:
        enabled: true
        min_compliance: 0.99  # Block if SLO compliance < 99%
      recent_incidents:
        enabled: true
        lookback: 7d
        max_p1: 0
        max_p2: 2
        
    rollback:
      automatic: false
      criteria:
        error_rate_increase: 5%
        latency_increase: 50%
```

#### Environments

List of environments where this service is deployed. Used for scoping validation.

#### Gates

Deployment gates that must pass before a release is allowed.

| Gate | Fields | Description |
|------|--------|-------------|
| `error_budget` | `enabled`, `threshold` | Block when error budget below threshold |
| `slo_compliance` | `enabled`, `min_compliance` | Block when SLO compliance below threshold |
| `recent_incidents` | `enabled`, `lookback`, `max_p1`, `max_p2` | Block based on recent incident count |

#### Rollback

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `automatic` | boolean | No | Whether automatic rollback is enabled |
| `criteria` | object | No | Conditions that trigger rollback |

---

## Validation Rules

Implementations MUST validate:

1. **Schema validity** — Document matches JSON Schema
2. **Required fields** — All required fields present
3. **Value constraints** — Enums, ranges, formats are valid
4. **Internal consistency** — e.g., `metadata.team` matches `spec.ownership.team`

Implementations SHOULD validate:

1. **SLO feasibility** — Targets achievable given dependencies
2. **Metric existence** — Required metrics exist in observability backend
3. **Dashboard existence** — Dashboard URLs are accessible
4. **Runbook existence** — Runbook URLs are accessible

Implementations MAY validate:

1. **Tier requirements** — Tier-specific fields are present
2. **Naming conventions** — Metric names follow conventions
3. **Cross-service consistency** — Dependencies reference valid services

---

## Extension Points

### Custom Fields

Use `annotations` in `metadata` for tool-specific fields:

```yaml
metadata:
  annotations:
    nthlayer.io/auto-generate-dashboard: "true"
    backstage.io/techdocs-ref: "dir:."
```

### Custom Gates

Use the `x-` prefix for custom deployment gates:

```yaml
spec:
  deployment:
    gates:
      x-security-scan:
        enabled: true
        required_score: 80
```

### Custom SLI Types

Use `custom` type for non-standard SLOs:

```yaml
spec:
  slos:
    custom:
      - name: checkout_completion_rate
        target: 95
        unit: percent
        description: Percentage of started checkouts that complete
```

---

## Changelog

### v1.0.0-draft (2026-01-23)

- Initial draft specification

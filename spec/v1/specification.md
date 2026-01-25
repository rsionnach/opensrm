# Service Reliability Manifest Specification

**Version:** 1.0.0-draft
**Status:** Draft
**Last Updated:** 2026-01-25

## Table of Contents

1. [Overview](#overview)
2. [Document Structure](#document-structure)
3. [Metadata](#metadata)
4. [Spec](#spec)
   - [Service Types](#service-types)
   - [SLOs](#slos)
     - [Judgment SLOs](#judgment-slos)
   - [Instrumentation](#instrumentation)
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

### Service Types

The `spec.type` field declares the service's operational pattern. This determines which SLOs are applicable and how metrics are interpreted.

```yaml
spec:
  type: api  # or worker, stream, ai-gate
```

| Type | Description | Applicable SLOs |
|------|-------------|-----------------|
| `api` | Request/response services (REST, gRPC, GraphQL) | availability, latency, error_rate |
| `worker` | Background job processors | job_success_rate, throughput, backlog |
| `stream` | Event stream processors (Kafka consumers, etc.) | throughput, lag, error_rate |
| `ai-gate` | AI-powered decision systems | availability, latency, + judgment SLOs |

**Default behavior**: Manifests without an explicit `type` field are treated as `api` services.

#### Type: `ai-gate`

AI gates are services that make automated decisions using AI/ML models. Examples include:

- AI code reviewers
- Automated security scanners
- AI-powered deployment approvers
- Content moderation systems
- Automated ticket triage

AI gates have a unique failure mode: they can be operationally healthy (available, fast, returning valid responses) while consistently making poor decisions. Traditional SLOs measure system health; judgment SLOs measure decision quality.

When `type: ai-gate` is specified:
- Traditional SLOs (availability, latency) remain applicable
- Judgment SLOs become available under `spec.slos.judgment`
- Instrumentation requirements apply under `spec.instrumentation`

---

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
| `w` | weeks |

Examples: `30d`, `7d`, `24h`, `1h`, `1w`

#### OpenSLO Reference

Instead of inline definitions, manifests MAY reference external OpenSLO files:

```yaml
spec:
  slos:
    openslo:
      - path: ./slos/availability.yaml
      - path: ./slos/latency.yaml
```

#### Judgment SLOs

*Applicable only when `spec.type: ai-gate`*

Judgment SLOs measure the quality of AI-driven decisions. Unlike traditional SLOs that measure system behavior, judgment SLOs measure whether the system is making good decisions.

```yaml
spec:
  type: ai-gate
  slos:
    judgment:
      reversal_rate:
        target: 0.05
        window: 30d
        observation_period: 24h
      high_confidence_failure:
        target: 0.02
        window: 30d
        confidence_threshold: 0.9
      calibration:
        target: 0.15
        window: 30d
      feedback_latency:
        p50: 48h
        p90: 168h
```

##### `reversal_rate`

Measures how often AI decisions are overridden by humans or automated systems.

**Why it matters**: High reversal rates indicate the AI gate is not trusted or is making poor decisions. This metric is measurable without ground truth—you only need to observe downstream behavior.

**Calculation**:
```
reversal_rate = count(reversals within observation_period) / count(decisions)
```

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | float | Yes | Maximum acceptable reversal rate (0.0 - 1.0) |
| `window` | duration | Yes | SLO evaluation window (e.g., `30d`) |
| `observation_period` | duration | No | Time to wait for reversals after a decision. Default: `24h` |

**Measurement**:
1. AI gate emits `decision` event with unique `decision_id`
2. System emits `reversal` event when human overrides, linking to `decision_id`
3. Count reversals that occur within `observation_period` of the decision
4. Calculate rate over the `window`

**Example events**:
```json
// Decision event
{
  "event": "ai_gate.decision",
  "decision_id": "dec_abc123",
  "decision": "approve",
  "confidence": 0.87,
  "timestamp": "2025-01-20T10:00:00Z"
}

// Reversal event (within 24h)
{
  "event": "ai_gate.reversal",
  "decision_id": "dec_abc123",
  "reversal_type": "human_override",
  "timestamp": "2025-01-20T14:30:00Z"
}
```

**Recommended targets**:

| Tier | Target |
|------|--------|
| critical | ≤ 0.03 (3%) |
| standard | ≤ 0.05 (5%) |
| low | ≤ 0.10 (10%) |

##### `high_confidence_failure`

Measures the rate of high-confidence decisions that prove to be wrong.

**Why it matters**: A system that is confidently wrong is more dangerous than one that is uncertain and wrong. High-confidence failures erode trust rapidly and can cause significant downstream damage before being caught.

**Calculation**:
```
hcf_rate = count(decisions WHERE confidence >= threshold AND reversed)
         / count(decisions WHERE confidence >= threshold)
```

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | float | Yes | Maximum acceptable failure rate for high-confidence decisions (0.0 - 1.0) |
| `window` | duration | Yes | SLO evaluation window |
| `confidence_threshold` | float | No | What counts as "high confidence". Default: `0.9` |

**Measurement**:
1. Filter decisions where `confidence >= confidence_threshold`
2. Of those, count how many were reversed (using same reversal logic as `reversal_rate`)
3. Calculate rate over the `window`

**Recommended targets**:

| Tier | Target |
|------|--------|
| critical | ≤ 0.01 (1%) |
| standard | ≤ 0.02 (2%) |
| low | ≤ 0.05 (5%) |

##### `calibration`

Measures whether stated confidence scores predict actual accuracy.

**Why it matters**: A well-calibrated system allows downstream consumers to make informed decisions based on confidence. If a system says it's 90% confident, it should be correct ~90% of the time.

**Calculation** (Expected Calibration Error):
```
ECE = Σ (|accuracy_b - confidence_b| × weight_b) for each bin b

Where:
- Decisions are bucketed by confidence (e.g., 0.0-0.1, 0.1-0.2, ..., 0.9-1.0)
- accuracy_b = correct decisions in bin / total decisions in bin
- confidence_b = average confidence score in bin
- weight_b = decisions in bin / total decisions
```

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | float | Yes | Maximum acceptable ECE (0.0 - 1.0). Lower is better. |
| `window` | duration | Yes | SLO evaluation window |

**Measurement**:
1. Requires ground truth: you must know which decisions were actually correct
2. Collect `(confidence, was_correct)` pairs from sampled decisions
3. Bucket by confidence and calculate ECE

**Ground truth sources**:
- Human review of sampled decisions
- Production outcomes (incidents, rollbacks)
- Automated verification against known-good test cases

**Recommended targets**:

| Quality | ECE |
|---------|-----|
| Excellent | < 0.05 |
| Good | < 0.10 |
| Acceptable | < 0.15 |
| Poor | ≥ 0.20 |

**Note**: Calibration requires ground truth and is typically measured on a sample of decisions (e.g., 10%) rather than all decisions.

##### `feedback_latency`

Measures how long until decision quality can be assessed.

**Why it matters**: If you don't learn about bad decisions for weeks, your other judgment SLOs are meaningless during that period. Fast feedback enables rapid iteration and early problem detection.

**Calculation**:
```
feedback_latency = outcome_timestamp - decision_timestamp
```

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `p50` | duration | No | Target for median feedback latency |
| `p90` | duration | No | Target for 90th percentile feedback latency |

At least one of `p50` or `p90` must be specified.

**Measurement**:
1. AI gate emits `decision` event with timestamp
2. System emits `outcome` event when ground truth is known, linking to `decision_id`
3. Calculate time delta between events
4. Compute percentiles over the `window`

**Outcome sources**:
- Human review completion
- Production incident correlation
- Automated test results
- Implicit signals (PR merged without changes = approval was correct)

**Recommended targets**:

| Signal Type | p50 | p90 |
|-------------|-----|-----|
| Human review | 24-48h | 72-168h |
| Production outcome | 48-168h | 336h (2 weeks) |
| Automated verification | < 1h | < 4h |

---

### Instrumentation

*Required when `spec.type: ai-gate`*

The instrumentation section defines how the AI gate emits telemetry for judgment SLO measurement.

```yaml
spec:
  type: ai-gate
  instrumentation:
    events:
      decision: ai_gate.decision
      reversal: ai_gate.reversal
      outcome: ai_gate.outcome
    attributes:
      decision_id: decision_id
      confidence: confidence
      decision: decision
```

#### Events

Defines the event names emitted by the AI gate and related systems.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `events.decision` | string | Yes | Event name emitted when AI makes a decision |
| `events.reversal` | string | Yes | Event name emitted when a decision is overridden |
| `events.outcome` | string | No | Event name emitted when ground truth is known |

**Event schemas**:

**Decision event** (emitted by AI gate):
```json
{
  "event": "<events.decision>",
  "decision_id": "string",      // Unique identifier for correlation
  "decision": "string",         // The decision value (e.g., "approve", "reject")
  "confidence": 0.0-1.0,        // Model confidence score
  "timestamp": "ISO8601",
  "metadata": {}                // Optional: additional context
}
```

**Reversal event** (emitted by orchestration layer):
```json
{
  "event": "<events.reversal>",
  "decision_id": "string",      // Links to original decision
  "reversal_type": "string",    // e.g., "human_override", "rollback", "auto_revert"
  "actor": "string",            // Who/what initiated the reversal
  "reason": "string",           // Optional: why
  "timestamp": "ISO8601"
}
```

**Outcome event** (emitted when ground truth known):
```json
{
  "event": "<events.outcome>",
  "decision_id": "string",      // Links to original decision
  "outcome": "string",          // e.g., "validated", "incorrect", "incident"
  "outcome_source": "string",   // e.g., "human_review", "production", "automated_test"
  "timestamp": "ISO8601"
}
```

#### Attributes

Maps logical attribute names to actual field names in events.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `attributes.decision_id` | string | No | `decision_id` | Field name for decision identifier |
| `attributes.confidence` | string | No | `confidence` | Field name for confidence score |
| `attributes.decision` | string | No | `decision` | Field name for decision value |

This allows flexibility when integrating with existing event schemas.

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

### v1.0.0-draft (2026-01-25)

- Add Service Types (`api`, `worker`, `stream`, `ai-gate`)
- Add Judgment SLOs for AI gates (`reversal_rate`, `high_confidence_failure`, `calibration`, `feedback_latency`)
- Add Instrumentation section for AI gate telemetry
- Add `w` (weeks) to duration format

### v1.0.0-draft (2026-01-23)

- Initial draft specification

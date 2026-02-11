# OpenSRM v1 Specification

**Open Service Reliability Manifest**

Version: 1.0.0-draft  
Status: Draft  
Authors: Rob Sionnach

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Document Structure](#2-document-structure)
3. [Service Types](#3-service-types)
4. [SLOs](#4-slos)
5. [Judgment SLOs (AI Gates)](#5-judgment-slos-ai-gates)
6. [Contracts](#6-contracts)
7. [Dependencies](#7-dependencies)
8. [Templates](#8-templates)
9. [Ownership](#9-ownership)
10. [Instrumentation](#10-instrumentation)
11. [Tooling Requirements](#11-tooling-requirements)
12. [JSON Schema](#12-json-schema)
13. [Examples](#13-examples)

---

## 1. Introduction

OpenSRM (Open Service Reliability Manifest) is a specification for declaring service reliability requirements as code. It enables:

- **Shift-left reliability**: Define SLOs before deployment, not after incidents
- **Consistency**: Standard format across all services in an organization
- **Automation**: Generate monitoring rules, validate deployments, gate releases
- **Accountability**: Clear contracts between services and their dependents

### 1.1 Design Principles

1. **Declarative**: Describe desired state, not how to achieve it
2. **Tooling-agnostic**: Works with Prometheus, Datadog, or any backend
3. **Minimal but complete**: Only what's needed, nothing more
4. **Human-readable**: YAML-first, JSON-compatible

### 1.2 Conformance Levels

- **MUST**: Required for conformance
- **SHOULD**: Recommended for production use
- **MAY**: Optional enhancement

---

## 2. Document Structure

### 2.1 Manifest Structure

```yaml
apiVersion: opensrm.io/v1          # MUST: API version
kind: ServiceReliabilityManifest   # MUST: Document type
metadata:                          # MUST: Service metadata
  name: service-name
  tier: standard
spec:                              # MUST: Reliability specification
  type: api
  slos: {}
```

### 2.2 Supported Kinds

| Kind | Description |
|------|-------------|
| `ServiceReliabilityManifest` | Primary document defining service reliability |
| `Template` | Reusable defaults for inheritance |

### 2.3 API Version

Current version: `opensrm.io/v1`

Tooling MUST reject documents with unknown API versions.

---

## 3. Service Types

The `spec.type` field defines the service category, which determines applicable SLO types.

### 3.1 Supported Types

| Type | Description | Applicable SLOs |
|------|-------------|-----------------|
| `api` | Synchronous request/response services | availability, latency, error_rate |
| `worker` | Async job processors | availability, processing_time, success_rate |
| `stream` | Event streaming services | availability, lag, throughput |
| `ai-gate` | AI-powered decision services | availability, latency + judgment SLOs |

### 3.2 Type Definition

```yaml
spec:
  type: api                        # MUST: One of the supported types
```

### 3.3 AI Gate Type

The `ai-gate` type extends `api` with judgment SLOs for measuring decision quality:

```yaml
spec:
  type: ai-gate
  slos:
    availability: {}               # Standard SLOs still apply
    latency: {}
    judgment:                      # Additional: AI-specific SLOs
      reversal:
        rate: {}
        high_confidence_failure: {}
      audit: {}
      outcomes: {}
      escalation: {}
```

---

## 4. SLOs

Service Level Objectives define reliability targets.

### 4.1 Availability

Measures the proportion of successful requests.

```yaml
spec:
  slos:
    availability:
      target: 0.999                # MUST: Target ratio (0-1)
      window: 30d                  # SHOULD: Measurement window
      
      # Optional: Custom success criteria
      success_criteria:
        - status_code: "2xx"
        - status_code: "3xx"
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `target` | number | MUST | - | Target availability (0-1) |
| `window` | duration | SHOULD | `30d` | Rolling window for measurement |
| `success_criteria` | array | MAY | `2xx, 3xx` | What counts as success |

### 4.2 Latency

Measures response time at specified percentiles.

```yaml
spec:
  slos:
    latency:
      p50: 100ms                   # MAY: Median latency
      p99: 500ms                   # SHOULD: 99th percentile
      p999: 2s                     # MAY: 99.9th percentile
      target: 0.99                 # MUST: Target ratio meeting threshold
      window: 30d                  # SHOULD: Measurement window
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `p50` | duration | MAY | - | Target median latency |
| `p99` | duration | SHOULD | - | Target 99th percentile |
| `p999` | duration | MAY | - | Target 99.9th percentile |
| `target` | number | MUST | - | Ratio of requests meeting threshold |
| `window` | duration | SHOULD | `30d` | Rolling window |

### 4.3 Error Rate

Measures the proportion of failed requests (inverse of availability).

```yaml
spec:
  slos:
    error_rate:
      target: 0.001                # MUST: Maximum error ratio (0-1)
      window: 30d
      
      # Optional: Error classification
      error_criteria:
        - status_code: "5xx"
        - exception: "TimeoutException"
```

### 4.4 Processing Time (Workers)

For async workers, measures job completion time.

```yaml
spec:
  type: worker
  slos:
    processing_time:
      p99: 5m                      # 99% of jobs complete in 5 minutes
      target: 0.99
      window: 7d
```

### 4.5 Lag (Streams)

For streaming services, measures consumer lag.

```yaml
spec:
  type: stream
  slos:
    lag:
      max_seconds: 30              # Maximum acceptable lag
      target: 0.99                 # 99% of time within threshold
      window: 7d
```

### 4.6 Duration Format

Durations use Go-style format:

| Unit | Suffix | Example |
|------|--------|---------|
| Milliseconds | `ms` | `100ms` |
| Seconds | `s` | `30s` |
| Minutes | `m` | `5m` |
| Hours | `h` | `1h` |
| Days | `d` | `30d` |

---

## 5. Judgment SLOs (AI Gates)

For `ai-gate` type services, judgment SLOs measure decision quality rather than operational metrics.

### 5.1 Overview

Traditional SLOs answer: "Is the system healthy?"
Judgment SLOs answer: "Are the AI's decisions good?"

#### Decision Types

An AI gate produces one of three outputs for any input:

| Decision | Meaning | Counted in reversal rate? |
|----------|---------|---------------------------|
| `approve` | AI commits to allowing/accepting | Yes |
| `reject` | AI commits to denying/blocking | Yes |
| `escalate` | AI declines to decide; requests human judgment | No |

**Escalation is abstention, not a flagged decision.** When an AI escalates, it has not made a decision — a human must decide. This keeps metrics clean:
- Reversal rate measures: "When the AI decides, how often is it wrong?"
- Escalation rate measures: "How often does the AI decline to decide?"

#### Measurement Layers

Judgment quality is measured through complementary layers:

| Layer | What it measures | Data source | Effort required |
|-------|------------------|-------------|-----------------|
| **Reactive** | Human disagreement when forced to engage | Reversal events | Zero (natural workflow) |
| **Proactive** | Decision quality on random sample | Human audit of samples | Dedicated review time |
| **Outcome** | Actual correctness via downstream results | Incident/defect correlation | Tracing infrastructure |
| **Behavioral** | Whether AI escalates appropriately | Decision distribution | Zero (event counting) |

Each layer catches different failure modes. Reactive catches problems humans notice organically. Proactive catches problems nobody would otherwise find. Outcome provides ground truth. Behavioral ensures the AI isn't over- or under-confident.

### 5.2 Maturity Levels

Teams should adopt judgment SLOs incrementally. Each level builds on the previous.

| Level | Name | What you learn | Effort |
|-------|------|----------------|--------|
| 1 | **Reactive** | Are humans frequently disagreeing with the AI? | Minimal — days to implement |
| 2 | **Proactive** | True decision quality on unbiased sample | Moderate — weeks (process setup) |
| 3 | **Outcome** | Actual decision correctness from downstream consequences | High — months (tracing infra) |
| 4 | **Behavioral & Segmented** | Escalation behavior and category-specific quality | High — ongoing refinement |

### 5.3 Reversal (Level 1 — Reactive)

Reversal metrics are the foundation of judgment SLOs. They require minimal effort — just instrument decision and reversal events.

#### 5.3.1 Reversal Rate

Measures how often humans override AI decisions.

```yaml
spec:
  type: ai-gate
  slos:
    judgment:
      reversal:
        rate:
          target: 0.05             # MUST: Maximum reversal ratio (0-1)
          window: 30d              # SHOULD: Measurement window
          observation_period: 7d   # MAY: Time to wait for reversals
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `target` | ratio | MUST | - | Maximum reversal ratio (0-1) |
| `window` | duration | SHOULD | `30d` | Rolling window for measurement |
| `observation_period` | duration | MAY | `24h` | Time to wait for reversals after a decision |

**Recommended targets by tier:**

| Tier | Target | Rationale |
|------|--------|-----------|
| Critical | ≤ 0.03 | High-stakes decisions need low reversal |
| Standard | ≤ 0.05 | Acceptable for most use cases |
| Low | ≤ 0.10 | Exploratory or advisory systems |

#### 5.3.2 High-Confidence Failure Rate

Measures how often the AI is confidently wrong — the most dangerous failure mode.

```yaml
spec:
  slos:
    judgment:
      reversal:
        high_confidence_failure:
          target: 0.02             # MUST: Maximum HCF ratio
          confidence_threshold: 0.8  # SHOULD: What counts as "high confidence"
          window: 30d
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `target` | ratio | MUST | - | Maximum HCF ratio (0-1) |
| `confidence_threshold` | ratio | SHOULD | `0.8` | Minimum confidence to count as "high confidence" |
| `window` | duration | SHOULD | `30d` | Rolling window for measurement |

**Recommended targets:**

| Tier | Target | Confidence Threshold |
|------|--------|---------------------|
| Critical | ≤ 0.01 | 0.9 |
| Standard | ≤ 0.02 | 0.8 |
| Low | ≤ 0.05 | 0.8 |

### 5.4 Audit (Level 2 — Proactive)

Audit sampling provides an unbiased quality signal by randomly selecting decisions for human review. This catches failures that reactive reversal tracking misses — if AI approves everything and nobody checks, reversal rate is zero while quality could be terrible.

```yaml
spec:
  slos:
    judgment:
      audit:
        enabled: true
        sample_rate: 0.10            # SHOULD: Proportion of decisions to sample
        sample_method: random        # MAY: random | stratified | confidence_weighted

        accuracy:
          target: 0.95              # MUST (if enabled): Proportion of correct decisions
          window: 30d

        coverage:
          target: 0.90              # MAY: Proportion of planned samples actually reviewed
          window: 7d

        latency:
          p90: 48h                  # MAY: Time to complete reviews
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | MUST | `false` | Whether audit sampling is active |
| `sample_rate` | ratio | SHOULD | - | Proportion of decisions to sample for review |
| `sample_method` | string | MAY | `random` | Sampling strategy: `random`, `stratified`, `confidence_weighted` |
| `accuracy.target` | ratio | MUST (if enabled) | - | Minimum proportion of sampled decisions found correct |
| `accuracy.window` | duration | SHOULD | `30d` | Rolling window for accuracy measurement |
| `coverage.target` | ratio | MAY | - | Minimum proportion of planned samples actually reviewed |
| `coverage.window` | duration | MAY | `7d` | Rolling window for coverage measurement |
| `latency.p90` | duration | MAY | - | 90th percentile time to complete reviews |

**Key insight**: `audit.accuracy` is your unbiased quality signal. If reversal rate is 3% but audit accuracy is 85%, you have a 12% hidden failure rate — problems nobody's catching organically.

### 5.5 Outcomes (Level 3 — Ground Truth)

Outcome-based measurement uses downstream consequences (incidents, rollbacks, chargebacks) as ground truth for decision quality.

```yaml
spec:
  slos:
    judgment:
      outcomes:
        enabled: true

        defect_signals:
          - event: incident.created
            correlation_key: pr_id
            decision_filter: "decision='approve'"
          - event: rollback.executed
            correlation_key: deployment_id
            decision_filter: "decision='approve'"

        defect_rate:
          target: 0.01              # MUST (if enabled): Max ratio of decisions leading to defects
          window: 90d               # Longer window — outcomes are delayed

        outcome_latency:
          p90: 30d                  # MAY: Time until outcomes are observable

        false_positive_rate:
          target: 0.02              # MAY: Max ratio of incorrect rejections
          window: 90d
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | MUST | `false` | Whether outcome tracking is active |
| `defect_signals` | array | SHOULD | - | Events that indicate a bad decision |
| `defect_signals[].event` | string | MUST | - | Event name to correlate |
| `defect_signals[].correlation_key` | string | MUST | - | Field linking outcome to decision |
| `defect_signals[].decision_filter` | string | MAY | - | Which decisions this signal applies to |
| `defect_rate.target` | ratio | MUST (if enabled) | - | Maximum ratio of decisions leading to defects |
| `defect_rate.window` | duration | SHOULD | `90d` | Rolling window (longer for delayed outcomes) |
| `outcome_latency.p90` | duration | MAY | - | 90th percentile time until outcome is observable |
| `false_positive_rate.target` | ratio | MAY | - | Maximum ratio of incorrect rejections |
| `false_positive_rate.window` | duration | MAY | `90d` | Rolling window for false positive measurement |

**Key insight**: Outcomes are ground truth. Human audit tells you "a reviewer thought this was wrong." Outcomes tell you "this actually caused a problem."

### 5.6 Escalation (Level 4 — Behavioral)

Escalation metrics ensure the AI appropriately handles uncertainty. An AI that never escalates is overconfident. An AI that always escalates provides no value.

```yaml
spec:
  slos:
    judgment:
      escalation:
        rate:
          min: 0.05                 # SHOULD: Minimum escalation rate
          max: 0.30                 # SHOULD: Maximum escalation rate
          window: 30d

        autonomous_accuracy:
          target: 0.97              # MAY: Higher bar for non-escalated decisions
          source: audit             # MAY: Where accuracy is measured
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `rate.min` | ratio | SHOULD | - | Minimum escalation rate |
| `rate.max` | ratio | SHOULD | - | Maximum escalation rate |
| `rate.window` | duration | SHOULD | `30d` | Rolling window |
| `autonomous_accuracy.target` | ratio | MAY | - | Accuracy target for non-escalated decisions |
| `autonomous_accuracy.source` | string | MAY | `audit` | How accuracy is measured: `audit` or `outcome` |

### 5.7 Segments (Level 4 — Segmented)

Aggregate metrics hide category-specific failures. An AI might be 95% accurate overall but 60% accurate on security decisions. Segment-level targets catch this.

```yaml
spec:
  slos:
    judgment:
      segments:
        enabled: true

        definitions:
          - name: security
            filter: "category='security' OR labels contains 'auth'"
          - name: infrastructure
            filter: "category='infrastructure'"
          - name: documentation
            filter: "category='docs'"

        targets:
          - segment: security
            reversal_rate: 0.03       # Tighter than default
            audit_accuracy: 0.98
          - segment: infrastructure
            reversal_rate: 0.05
          - segment: documentation
            reversal_rate: 0.10       # More tolerant
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | MUST | `false` | Whether segment analysis is active |
| `definitions` | array | MUST (if enabled) | - | Segment definitions |
| `definitions[].name` | string | MUST | - | Unique segment name |
| `definitions[].filter` | string | MUST | - | Filter expression for matching decisions |
| `targets` | array | SHOULD | - | Per-segment SLO overrides |
| `targets[].segment` | string | MUST | - | Segment name (must match a definition) |
| `targets[].reversal_rate` | ratio | MAY | - | Reversal rate target for this segment |
| `targets[].audit_accuracy` | ratio | MAY | - | Audit accuracy target for this segment |

### 5.8 Stability (Level 4)

Stability monitoring detects quality degradation and volatility. Sudden changes or high variance indicate something has changed (model update, data drift, new input patterns).

```yaml
spec:
  slos:
    judgment:
      stability:
        trend:
          metric: reversal_rate       # MUST: Which metric to track
          max_increase: 0.02          # MUST: Alert if metric increases by more than this
          lookback: 14d               # SHOULD: Recent window
          comparison: 30d             # SHOULD: Baseline comparison window

        volatility:
          metric: reversal_rate       # MUST: Which metric to track
          max_stddev: 0.03            # MUST: Maximum standard deviation
          window: 7d                  # SHOULD: Measurement window
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `trend.metric` | string | MUST | - | Metric to monitor for trend changes |
| `trend.max_increase` | number | MUST | - | Maximum allowed increase between windows |
| `trend.lookback` | duration | SHOULD | `14d` | Recent measurement window |
| `trend.comparison` | duration | SHOULD | `30d` | Baseline comparison window |
| `volatility.metric` | string | MUST | - | Metric to monitor for volatility |
| `volatility.max_stddev` | number | MUST | - | Maximum allowed standard deviation |
| `volatility.window` | duration | SHOULD | `7d` | Volatility measurement window |

### 5.9 Calibration

Measures whether stated confidence matches actual accuracy. A well-calibrated model saying "80% confident" should be correct ~80% of the time.

```yaml
spec:
  slos:
    judgment:
      calibration:
        enabled: true
        source: audit                  # MAY: Where accuracy is determined
        ece:
          target: 0.15                 # MUST: Maximum ECE score
          window: 30d
          bins: 10                     # MAY: Number of calibration bins
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | MUST | `false` | Whether calibration tracking is active |
| `source` | string | MAY | `audit` | How correctness is determined: `audit` or `outcome` |
| `ece.target` | number | MUST (if enabled) | - | Maximum Expected Calibration Error (0-1) |
| `ece.window` | duration | SHOULD | `30d` | Rolling window for measurement |
| `ece.bins` | integer | MAY | `10` | Number of calibration bins |

**Interpretation:**
- ECE = 0: Perfect calibration
- ECE < 0.10: Well-calibrated
- ECE < 0.15: Acceptable
- ECE > 0.20: Needs attention

### 5.10 Metric Definitions

#### Reversal Rate
```
reversal_rate =
  count(reversals where decision_age < observation_period)
  / count(decisions where decision ∈ [approve, reject])
```
Escalations are excluded from both numerator and denominator.

#### High-Confidence Failure Rate
```
hcf_rate =
  count(reversals where original_confidence >= threshold)
  / count(decisions where confidence >= threshold)
```

#### Audit Accuracy
```
audit_accuracy =
  count(audits where verdict = 'correct')
  / count(audits completed)
```

#### Audit Coverage
```
audit_coverage =
  count(audits completed within window)
  / count(audits scheduled within window)
```

#### Escalation Rate
```
escalation_rate =
  count(decisions where decision = 'escalate')
  / count(all decisions)
```

#### Autonomous Accuracy
```
autonomous_accuracy =
  count(audits where verdict = 'correct' AND original_decision != 'escalate')
  / count(audits where original_decision != 'escalate')
```

#### Defect Rate
```
defect_rate =
  count(decisions with linked defect_signal)
  / count(decisions matching decision_filter)
```

#### Expected Calibration Error (ECE)
```
ECE = Σ (|bucket_accuracy - bucket_confidence| × bucket_weight)
```
Where buckets partition decisions by confidence (e.g., 0.0-0.1, 0.1-0.2, ... 0.9-1.0).

### 5.11 Judgment SLO Instrumentation

Judgment SLOs require specific telemetry events. See [Section 10: Instrumentation](#10-instrumentation).

---

## 6. Contracts

A contract declares the reliability guarantees a service promises to its dependents.

### 6.1 Purpose

- **Internal SLOs** = what you measure and alert on (often tighter)
- **Contract** = what you promise externally (your SLA to internal consumers)

This decouples teams: providers commit to contracts, consumers code against them.

### 6.2 Contract Definition

```yaml
spec:
  contract:
    availability: 0.999            # Promised availability
    latency:
      p50: 50ms                    # Promised median latency
      p99: 200ms                   # Promised 99th percentile
    throughput:
      max_rps: 10000               # Maximum supported RPS
      burst: 15000                 # Maximum burst capacity
```

### 6.3 Contract Fields

| Field | Type | Description |
|-------|------|-------------|
| `availability` | number (0-1) | Promised uptime ratio |
| `latency.p50` | duration | Promised median latency |
| `latency.p99` | duration | Promised 99th percentile |
| `latency.p999` | duration | Promised 99.9th percentile |
| `throughput.max_rps` | integer | Maximum sustained requests/second |
| `throughput.burst` | integer | Maximum burst above steady-state |

### 6.4 AI Gate Contracts

AI gate services may include judgment guarantees:

```yaml
spec:
  type: ai-gate
  contract:
    availability: 0.999
    latency:
      p99: 30s
    judgment:
      max_reversal_rate: 0.05      # ≤5% decisions reversed
      max_hcf_rate: 0.02           # ≤2% high-confidence failures
      max_audit_accuracy: 0.95     # ≥95% audit accuracy
      max_defect_rate: 0.01        # ≤1% defect rate
      max_escalation_rate: 0.25    # ≤25% escalation rate
```

### 6.5 Contract vs SLO

Internal SLOs SHOULD be tighter than contracts to provide margin:

```yaml
spec:
  contract:
    availability: 0.999            # Promise to others
    
  slos:
    availability:
      target: 0.9995               # Internal target (tighter)
```

> **TOOLING REQUIREMENT**: Validators SHOULD warn when `slos.*.target` is looser than `contract.*`

---

## 7. Dependencies

Dependencies declare upstream services and expected guarantees.

### 7.1 Explicit Dependencies

```yaml
spec:
  dependencies:
    - service: payment-gateway     # MUST: Service name
      critical: true               # SHOULD: Is this critical path?
      expects:                     # MAY: Expected guarantees
        availability: 0.999
        latency:
          p99: 200ms
          
    - service: notification-service
      critical: false              # Can degrade gracefully
```

### 7.2 Dependency Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | string | MUST | Name of upstream service |
| `critical` | boolean | SHOULD | Whether failure blocks this service |
| `expects` | object | MAY | Expected contract from upstream |
| `expects.availability` | number | MAY | Expected availability |
| `expects.latency` | object | MAY | Expected latency guarantees |

### 7.3 Auto-Discovery Hint

For tooling that can discover dependencies automatically:

```yaml
spec:
  dependencies:
    discovery: auto                # Hint to tooling
    explicit:                      # Override/augment discovered deps
      - service: payment-gateway
        critical: true
        expects:
          availability: 0.9999
```

| Value | Meaning |
|-------|---------|
| `auto` | Tooling should discover from service mesh/traces |
| `manual` | Only use explicitly listed dependencies |

> **TOOLING REQUIREMENT**: Discovery implementation requires integration with:
> - Service mesh (Istio, Linkerd)
> - Distributed tracing (OpenTelemetry, Jaeger)
> - Service catalog (Backstage)

### 7.4 Contract Validation

> **TOOLING REQUIREMENT**: Validators SHOULD check:
> 
> 1. **Expectations ≤ Promises**: Warn if `expects.availability > provider.contract.availability`
> 2. **Transitive feasibility**: Warn if service promises better than critical deps can deliver
> 3. **Missing contracts**: Warn if depending on service without published contract

---

## 8. Templates

Templates enable inheritance of common configurations.

### 8.1 Template Definition

```yaml
apiVersion: opensrm.io/v1
kind: Template
metadata:
  name: api-standard               # MUST: Unique template name
  description: Standard API defaults
spec:
  type: api
  slos:
    availability:
      target: 0.999
      window: 30d
    latency:
      p99: 500ms
      target: 0.99
  ownership:
    oncall_required: true
```

### 8.2 Template Usage

Services reference templates in metadata:

```yaml
apiVersion: opensrm.io/v1
kind: ServiceReliabilityManifest
metadata:
  name: checkout-service
  template: api-standard           # Inherit from template
spec:
  slos:
    latency:
      p99: 200ms                   # Override: tighter than template
```

### 8.3 Inheritance Rules

1. **Shallow merge at top level**: `spec.slos`, `spec.ownership`, etc. merge independently
2. **Deep replace at leaf level**: `spec.slos.latency` replaces entirely if specified
3. **Service wins**: Any value in service manifest overrides template
4. **No chaining**: Templates cannot inherit from other templates
5. **Required fields**: Templates may omit required fields if services provide them

### 8.4 Merge Examples

| Template | Service | Result |
|----------|---------|--------|
| `slos.availability.target: 0.999` | (not set) | `0.999` |
| `slos.availability.target: 0.999` | `slos.availability.target: 0.9999` | `0.9999` |
| `slos.latency: {p99: 500ms}` | `slos.latency: {p99: 200ms}` | `{p99: 200ms}` |
| (not set) | `slos.judgment: {...}` | `{...}` |

> **TOOLING REQUIREMENT**: Template resolution requires:
> 
> 1. **Location strategy**: Local files, registry URL, or Git path
> 2. **Merge implementation**: Deep merge with service-wins semantics
> 3. **Validation**: Validate merged result, not template or service alone

### 8.5 Common Templates

Organizations SHOULD define standard templates:

| Template | Use Case |
|----------|----------|
| `api-critical` | High-availability APIs (0.9999) |
| `api-standard` | Standard APIs (0.999) |
| `api-internal` | Internal-only APIs (0.99) |
| `worker-standard` | Background job processors |
| `ai-gate-standard` | AI decision services |

---

## 9. Ownership

Ownership metadata for routing alerts and establishing accountability.

### 9.1 Fields

```yaml
spec:
  ownership:
    team: platform-payments        # MUST: Owning team
    slack: "#payments-oncall"      # SHOULD: Alert channel
    email: payments@example.com    # MAY: Email contact
    pagerduty: PAYMENTS_SVC        # MAY: PagerDuty service
    runbook: https://wiki/runbooks/payments  # SHOULD for critical
    oncall_required: true          # MAY: Require on-call rotation
```

### 9.2 Tier-Based Requirements

| Tier | Team | Slack | Runbook | On-call |
|------|------|-------|---------|---------|
| Critical | MUST | MUST | MUST | MUST |
| Standard | MUST | SHOULD | SHOULD | MAY |
| Low | MUST | MAY | MAY | MAY |

---

## 10. Instrumentation

Instrumentation requirements define telemetry contracts for SLO measurement.

### 10.1 Standard Instrumentation

```yaml
spec:
  instrumentation:
    metrics:
      requests_total: http_requests_total
      request_duration: http_request_duration_seconds
      errors_total: http_requests_total{status=~"5.."}
    labels:
      service: checkout-service
      environment: production
```

### 10.2 AI Gate Instrumentation

AI gate services require specific events for judgment SLOs:

```yaml
spec:
  type: ai-gate
  instrumentation:
    events:
      decision: ai_gate.decision
      reversal: ai_gate.reversal
      outcome: ai_gate.outcome
      audit_result: ai_gate.audit
    attributes:
      decision_id: ai_gate.decision_id
      confidence: ai_gate.confidence
      decision_value: ai_gate.decision
```

### 10.3 Required Events for Judgment SLOs

#### Decision Event

Emitted when AI makes a decision.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `decision_id` | string | MUST | Unique identifier |
| `decision` | string | MUST | The decision made: `approve`, `reject`, or `escalate` |
| `confidence` | float | SHOULD | Confidence score (0-1) |
| `timestamp` | datetime | MUST | When decision was made |
| `context` | object | MAY | Additional context |

#### Reversal Event

Emitted when a human overrides an AI decision.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `decision_id` | string | MUST | Links to original decision |
| `reversal_type` | string | MUST | Type: `human_override`, `automated`, `appeal` |
| `actor` | string | SHOULD | Who reversed (anonymized) |
| `reason` | string | MAY | Why reversed |
| `timestamp` | datetime | MUST | When reversed |

#### Audit Result Event

Emitted when a sampled decision is reviewed by a human auditor (Level 2+).

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `decision_id` | string | MUST | Links to original decision |
| `verdict` | string | MUST | Audit result: `correct` or `incorrect` |
| `reviewer` | string | SHOULD | Who reviewed (anonymized) |
| `notes` | string | MAY | Reviewer notes |
| `timestamp` | datetime | MUST | When audit was completed |

#### Outcome Event

Emitted when ground truth is known from downstream consequences (Level 3+).

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `decision_id` | string | MUST | Links to original decision |
| `outcome` | string | MUST | Actual outcome: `correct`, `incorrect`, `unknown` |
| `outcome_type` | string | SHOULD | Category: `incident`, `rollback`, `chargeback`, `defect` |
| `outcome_source` | string | SHOULD | How determined: `human_review`, `automated`, `implicit` |
| `severity` | string | MAY | Outcome severity level |
| `timestamp` | datetime | MUST | When outcome was determined |

### 10.4 OpenTelemetry Alignment

Events SHOULD be emitted as OpenTelemetry spans or events:

```python
from opentelemetry import trace

tracer = trace.get_tracer("ai-gate")

with tracer.start_as_current_span("ai_gate.decision") as span:
    span.set_attribute("ai_gate.decision_id", decision_id)
    span.set_attribute("ai_gate.decision", "approve")
    span.set_attribute("ai_gate.confidence", 0.87)
```

---

## 11. Tooling Requirements

This section summarizes what tooling (e.g., NthLayer) must implement to fully support OpenSRM.

### 11.1 Validation (Minimum Viable)

| Requirement | Priority | Description |
|-------------|----------|-------------|
| Schema validation | MUST | Validate against JSON Schema |
| Type-specific validation | MUST | Judgment SLOs only valid for `ai-gate` type |
| Required field validation | MUST | Enforce MUST fields per tier |

### 11.2 Template Resolution

| Requirement | Priority | Description |
|-------------|----------|-------------|
| Local file resolution | MUST | Load templates from relative paths |
| Merge implementation | MUST | Deep merge with service-wins semantics |
| Circular detection | SHOULD | Detect if template references itself |
| Registry resolution | MAY | Load templates from HTTP registry |
| Git resolution | MAY | Load templates from Git repo paths |

**Implementation sketch:**
```python
def resolve_template(manifest: dict, template_dir: Path) -> dict:
    template_name = manifest.get("metadata", {}).get("template")
    if not template_name:
        return manifest
    
    template_path = template_dir / f"{template_name}.yaml"
    template = yaml.safe_load(template_path.read_text())
    
    # Deep merge: template as base, manifest overrides
    merged_spec = deep_merge(template.get("spec", {}), manifest.get("spec", {}))
    
    result = manifest.copy()
    result["spec"] = merged_spec
    return result
```

### 11.3 Contract Validation

| Requirement | Priority | Description |
|-------------|----------|-------------|
| Internal ≥ External check | SHOULD | Warn if SLO targets looser than contract |
| Dependency expectation check | SHOULD | Warn if expects > provider promises |
| Transitive feasibility check | MAY | Warn if promising better than deps allow |
| Contract registry | MAY | Central registry of all service contracts |

**Implementation sketch:**
```python
def validate_contracts(manifest: dict, registry: ContractRegistry) -> list[Warning]:
    warnings = []
    contract = manifest.get("spec", {}).get("contract", {})
    slos = manifest.get("spec", {}).get("slos", {})
    
    # Check internal >= external
    if contract.get("availability") and slos.get("availability", {}).get("target"):
        if slos["availability"]["target"] < contract["availability"]:
            warnings.append(Warning(
                path="/spec/slos/availability/target",
                message=f"SLO target {slos['availability']['target']} is looser than contract {contract['availability']}"
            ))
    
    # Check dependency expectations
    for dep in manifest.get("spec", {}).get("dependencies", []):
        if isinstance(dep, dict) and dep.get("expects"):
            provider = registry.get_contract(dep["service"])
            if provider and dep["expects"].get("availability", 0) > provider.get("availability", 1):
                warnings.append(Warning(
                    path=f"/spec/dependencies/{dep['service']}",
                    message=f"Expects {dep['expects']['availability']} but {dep['service']} only promises {provider['availability']}"
                ))
    
    return warnings
```

### 11.4 Dependency Discovery

| Requirement | Priority | Description |
|-------------|----------|-------------|
| Manual mode | MUST | Use only explicit dependencies |
| Istio integration | MAY | Query Kiali API for service graph |
| OpenTelemetry integration | MAY | Query trace backend for service deps |
| Backstage integration | MAY | Query catalog API for relations |
| Merge strategy | MAY | Merge discovered + explicit deps |

**Implementation sketch:**
```python
def discover_dependencies(service: str, source: str) -> list[str]:
    if source == "istio":
        # Query Kiali API
        resp = requests.get(f"{KIALI_URL}/api/namespaces/default/graph?service={service}")
        return parse_kiali_dependencies(resp.json())
    
    elif source == "opentelemetry":
        # Query Tempo/Jaeger service graph
        resp = requests.get(f"{TEMPO_URL}/api/services/{service}/dependencies")
        return parse_tempo_dependencies(resp.json())
    
    elif source == "backstage":
        # Query Backstage catalog
        resp = requests.get(f"{BACKSTAGE_URL}/api/catalog/entities/by-name/component/default/{service}")
        entity = resp.json()
        return [r["target"] for r in entity.get("relations", []) if r["type"] == "dependsOn"]
```

### 11.5 Monitoring Generation

| Requirement | Priority | Description |
|-------------|----------|-------------|
| Prometheus rules | SHOULD | Generate recording rules for SLOs |
| Prometheus alerts | SHOULD | Generate burn-rate alerts |
| Grafana dashboards | MAY | Generate SLO dashboards |
| Datadog monitors | MAY | Generate Datadog SLO monitors |
| AI gate metrics | SHOULD | Generate judgment SLO recording rules |

**Prometheus recording rules for judgment SLOs:**
```yaml
groups:
  - name: ai_gate_slos
    rules:
      # Reversal rate
      - record: ai_gate:reversal_rate:ratio
        expr: |
          sum(rate(ai_gate_reversals_total{service="code-review-bot"}[7d]))
          /
          sum(rate(ai_gate_decisions_total{service="code-review-bot"}[7d]))
        labels:
          service: code-review-bot
          slo: reversal_rate
          
      # High-confidence failure rate
      - record: ai_gate:high_confidence_failure:ratio
        expr: |
          sum(rate(ai_gate_reversals_total{service="code-review-bot", confidence_bucket="high"}[7d]))
          /
          sum(rate(ai_gate_decisions_total{service="code-review-bot", confidence_bucket="high"}[7d]))
        labels:
          service: code-review-bot
          slo: high_confidence_failure
```

### 11.6 Deployment Gating

| Requirement | Priority | Description |
|-------------|----------|-------------|
| Error budget check | SHOULD | Block deploy if budget exhausted |
| Threshold configuration | SHOULD | Configurable budget threshold |
| Override mechanism | MAY | Allow emergency deploys with audit |
| Exit codes | SHOULD | Distinguish "blocked" (2) from "error" (1) |

### 11.7 Policy Enforcement

| Requirement | Priority | Description |
|-------------|----------|-------------|
| Policy definition | MAY | Define org-wide requirements |
| Policy validation | MAY | Validate manifests against policies |
| Tier-based rules | MAY | Different requirements per tier |
| Custom rules | MAY | Organization-specific validations |

**Policy example:**
```yaml
# org-policy.yaml (NOT part of OpenSRM spec, tooling-specific)
rules:
  - match:
      tier: critical
    require:
      slos:
        availability:
          min_target: 0.9999
      ownership:
        runbook: required
        slack: required
        oncall_required: true
        
  - match:
      type: ai-gate
    require:
      slos:
        judgment:
          reversal_rate: required
```

### 11.8 UI/Visualization

| Requirement | Priority | Description |
|-------------|----------|-------------|
| CLI output | SHOULD | Human-readable validation output |
| JSON output | SHOULD | Machine-readable for CI integration |
| Backstage plugin | MAY | Catalog integration with SLO cards |
| Dashboard generation | MAY | Auto-generate Grafana dashboards |

### 11.9 Summary: Implementation Phases

**Phase 1: MVP**
- Schema validation
- Template resolution (local files)
- Prometheus rule generation
- CLI with validate/generate commands

**Phase 2: Contracts**
- Contract validation
- Dependency expectation checking
- Contract registry (file-based)

**Phase 3: Integration**
- Backstage plugin
- GitHub Action
- Deployment gating

**Phase 4: Discovery**
- Istio integration
- OpenTelemetry integration
- Backstage catalog integration

**Phase 5: Enterprise**
- Policy enforcement
- Federation
- Multi-cluster support

---

## 12. JSON Schema

Complete JSON Schema for validation.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://opensrm.io/schema/v1",
  "title": "OpenSRM v1 Schema",
  "description": "Schema for Open Service Reliability Manifests",
  
  "oneOf": [
    { "$ref": "#/definitions/ServiceReliabilityManifest" },
    { "$ref": "#/definitions/Template" }
  ],
  
  "definitions": {
    "Duration": {
      "type": "string",
      "pattern": "^[0-9]+(ms|s|m|h|d)$",
      "examples": ["100ms", "30s", "5m", "1h", "30d"]
    },
    
    "Ratio": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    },
    
    "ServiceType": {
      "type": "string",
      "enum": ["api", "worker", "stream", "ai-gate"]
    },
    
    "Tier": {
      "type": "string",
      "enum": ["critical", "standard", "low"]
    },
    
    "AvailabilitySLO": {
      "type": "object",
      "required": ["target"],
      "properties": {
        "target": { "$ref": "#/definitions/Ratio" },
        "window": { "$ref": "#/definitions/Duration" },
        "success_criteria": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "status_code": { "type": "string" }
            }
          }
        }
      }
    },
    
    "LatencySLO": {
      "type": "object",
      "required": ["target"],
      "properties": {
        "p50": { "$ref": "#/definitions/Duration" },
        "p99": { "$ref": "#/definitions/Duration" },
        "p999": { "$ref": "#/definitions/Duration" },
        "target": { "$ref": "#/definitions/Ratio" },
        "window": { "$ref": "#/definitions/Duration" }
      }
    },
    
    "ErrorRateSLO": {
      "type": "object",
      "required": ["target"],
      "properties": {
        "target": { "$ref": "#/definitions/Ratio" },
        "window": { "$ref": "#/definitions/Duration" }
      }
    },
    
    "ReversalRateSLO": {
      "type": "object",
      "required": ["target"],
      "properties": {
        "target": { "$ref": "#/definitions/Ratio" },
        "window": { "$ref": "#/definitions/Duration" },
        "observation_period": { "$ref": "#/definitions/Duration" }
      }
    },

    "HighConfidenceFailureSLO": {
      "type": "object",
      "required": ["target"],
      "properties": {
        "target": { "$ref": "#/definitions/Ratio" },
        "confidence_threshold": {
          "$ref": "#/definitions/Ratio",
          "default": 0.8
        },
        "window": { "$ref": "#/definitions/Duration" }
      }
    },

    "ReversalSLO": {
      "type": "object",
      "properties": {
        "rate": { "$ref": "#/definitions/ReversalRateSLO" },
        "high_confidence_failure": { "$ref": "#/definitions/HighConfidenceFailureSLO" }
      }
    },

    "AuditSLO": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean", "default": false },
        "sample_rate": { "$ref": "#/definitions/Ratio" },
        "sample_method": {
          "type": "string",
          "enum": ["random", "stratified", "confidence_weighted"],
          "default": "random"
        },
        "accuracy": {
          "type": "object",
          "properties": {
            "target": { "$ref": "#/definitions/Ratio" },
            "window": { "$ref": "#/definitions/Duration" }
          }
        },
        "coverage": {
          "type": "object",
          "properties": {
            "target": { "$ref": "#/definitions/Ratio" },
            "window": { "$ref": "#/definitions/Duration" }
          }
        },
        "latency": {
          "type": "object",
          "properties": {
            "p90": { "$ref": "#/definitions/Duration" }
          }
        }
      }
    },

    "OutcomesSLO": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean", "default": false },
        "defect_signals": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["event", "correlation_key"],
            "properties": {
              "event": { "type": "string" },
              "correlation_key": { "type": "string" },
              "decision_filter": { "type": "string" }
            }
          }
        },
        "defect_rate": {
          "type": "object",
          "properties": {
            "target": { "$ref": "#/definitions/Ratio" },
            "window": { "$ref": "#/definitions/Duration" }
          }
        },
        "outcome_latency": {
          "type": "object",
          "properties": {
            "p90": { "$ref": "#/definitions/Duration" }
          }
        },
        "false_positive_rate": {
          "type": "object",
          "properties": {
            "target": { "$ref": "#/definitions/Ratio" },
            "window": { "$ref": "#/definitions/Duration" }
          }
        }
      }
    },

    "EscalationSLO": {
      "type": "object",
      "properties": {
        "rate": {
          "type": "object",
          "properties": {
            "min": { "$ref": "#/definitions/Ratio" },
            "max": { "$ref": "#/definitions/Ratio" },
            "window": { "$ref": "#/definitions/Duration" }
          }
        },
        "autonomous_accuracy": {
          "type": "object",
          "properties": {
            "target": { "$ref": "#/definitions/Ratio" },
            "source": {
              "type": "string",
              "enum": ["audit", "outcome"],
              "default": "audit"
            }
          }
        }
      }
    },

    "SegmentDefinition": {
      "type": "object",
      "required": ["name", "filter"],
      "properties": {
        "name": { "type": "string" },
        "filter": { "type": "string" }
      }
    },

    "SegmentTarget": {
      "type": "object",
      "required": ["segment"],
      "properties": {
        "segment": { "type": "string" },
        "reversal_rate": { "$ref": "#/definitions/Ratio" },
        "audit_accuracy": { "$ref": "#/definitions/Ratio" }
      }
    },

    "SegmentsSLO": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean", "default": false },
        "definitions": {
          "type": "array",
          "items": { "$ref": "#/definitions/SegmentDefinition" }
        },
        "targets": {
          "type": "array",
          "items": { "$ref": "#/definitions/SegmentTarget" }
        }
      }
    },

    "StabilitySLO": {
      "type": "object",
      "properties": {
        "trend": {
          "type": "object",
          "properties": {
            "metric": { "type": "string" },
            "max_increase": { "type": "number" },
            "lookback": { "$ref": "#/definitions/Duration" },
            "comparison": { "$ref": "#/definitions/Duration" }
          }
        },
        "volatility": {
          "type": "object",
          "properties": {
            "metric": { "type": "string" },
            "max_stddev": { "type": "number" },
            "window": { "$ref": "#/definitions/Duration" }
          }
        }
      }
    },

    "CalibrationSLO": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean", "default": false },
        "source": {
          "type": "string",
          "enum": ["audit", "outcome"],
          "default": "audit"
        },
        "ece": {
          "type": "object",
          "properties": {
            "target": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "window": { "$ref": "#/definitions/Duration" },
            "bins": {
              "type": "integer",
              "minimum": 2,
              "default": 10
            }
          }
        }
      }
    },

    "JudgmentSLOs": {
      "type": "object",
      "properties": {
        "reversal": { "$ref": "#/definitions/ReversalSLO" },
        "audit": { "$ref": "#/definitions/AuditSLO" },
        "outcomes": { "$ref": "#/definitions/OutcomesSLO" },
        "escalation": { "$ref": "#/definitions/EscalationSLO" },
        "segments": { "$ref": "#/definitions/SegmentsSLO" },
        "stability": { "$ref": "#/definitions/StabilitySLO" },
        "calibration": { "$ref": "#/definitions/CalibrationSLO" }
      }
    },
    
    "SLOs": {
      "type": "object",
      "properties": {
        "availability": { "$ref": "#/definitions/AvailabilitySLO" },
        "latency": { "$ref": "#/definitions/LatencySLO" },
        "error_rate": { "$ref": "#/definitions/ErrorRateSLO" },
        "judgment": { "$ref": "#/definitions/JudgmentSLOs" }
      }
    },
    
    "ContractLatency": {
      "type": "object",
      "properties": {
        "p50": { "$ref": "#/definitions/Duration" },
        "p99": { "$ref": "#/definitions/Duration" },
        "p999": { "$ref": "#/definitions/Duration" }
      }
    },
    
    "ContractThroughput": {
      "type": "object",
      "properties": {
        "max_rps": { "type": "integer", "minimum": 1 },
        "burst": { "type": "integer", "minimum": 1 }
      }
    },
    
    "ContractJudgment": {
      "type": "object",
      "properties": {
        "max_reversal_rate": { "$ref": "#/definitions/Ratio" },
        "max_hcf_rate": { "$ref": "#/definitions/Ratio" },
        "max_audit_accuracy": { "$ref": "#/definitions/Ratio" },
        "max_defect_rate": { "$ref": "#/definitions/Ratio" },
        "max_escalation_rate": { "$ref": "#/definitions/Ratio" }
      }
    },
    
    "Contract": {
      "type": "object",
      "properties": {
        "availability": { "$ref": "#/definitions/Ratio" },
        "latency": { "$ref": "#/definitions/ContractLatency" },
        "throughput": { "$ref": "#/definitions/ContractThroughput" },
        "judgment": { "$ref": "#/definitions/ContractJudgment" }
      }
    },
    
    "DependencyExpectation": {
      "type": "object",
      "required": ["service"],
      "properties": {
        "service": { "type": "string" },
        "critical": { "type": "boolean", "default": false },
        "expects": {
          "type": "object",
          "properties": {
            "availability": { "$ref": "#/definitions/Ratio" },
            "latency": { "$ref": "#/definitions/ContractLatency" }
          }
        }
      }
    },
    
    "Dependencies": {
      "oneOf": [
        {
          "type": "array",
          "items": { "$ref": "#/definitions/DependencyExpectation" }
        },
        {
          "type": "object",
          "properties": {
            "discovery": {
              "type": "string",
              "enum": ["auto", "manual"],
              "default": "manual"
            },
            "explicit": {
              "type": "array",
              "items": { "$ref": "#/definitions/DependencyExpectation" }
            }
          }
        }
      ]
    },
    
    "Ownership": {
      "type": "object",
      "required": ["team"],
      "properties": {
        "team": { "type": "string" },
        "slack": { "type": "string" },
        "email": { "type": "string", "format": "email" },
        "pagerduty": { "type": "string" },
        "runbook": { "type": "string", "format": "uri" },
        "oncall_required": { "type": "boolean" }
      }
    },
    
    "Instrumentation": {
      "type": "object",
      "properties": {
        "metrics": {
          "type": "object",
          "properties": {
            "requests_total": { "type": "string" },
            "request_duration": { "type": "string" },
            "errors_total": { "type": "string" }
          }
        },
        "events": {
          "type": "object",
          "properties": {
            "decision": { "type": "string" },
            "reversal": { "type": "string" },
            "outcome": { "type": "string" },
            "audit_result": { "type": "string" }
          }
        },
        "labels": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        },
        "attributes": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        }
      }
    },
    
    "Spec": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": { "$ref": "#/definitions/ServiceType" },
        "slos": { "$ref": "#/definitions/SLOs" },
        "contract": { "$ref": "#/definitions/Contract" },
        "dependencies": { "$ref": "#/definitions/Dependencies" },
        "ownership": { "$ref": "#/definitions/Ownership" },
        "instrumentation": { "$ref": "#/definitions/Instrumentation" }
      },
      "allOf": [
        {
          "if": {
            "properties": { "type": { "const": "ai-gate" } }
          },
          "then": {
            "properties": {
              "slos": {
                "properties": {
                  "judgment": { "$ref": "#/definitions/JudgmentSLOs" }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": { "type": { "not": { "const": "ai-gate" } } }
          },
          "then": {
            "properties": {
              "slos": {
                "not": {
                  "required": ["judgment"]
                }
              }
            }
          }
        }
      ]
    },
    
    "Metadata": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$"
        },
        "tier": { "$ref": "#/definitions/Tier" },
        "template": { "type": "string" },
        "labels": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        },
        "annotations": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        }
      }
    },
    
    "ServiceReliabilityManifest": {
      "type": "object",
      "required": ["apiVersion", "kind", "metadata", "spec"],
      "properties": {
        "apiVersion": { "const": "opensrm.io/v1" },
        "kind": { "const": "ServiceReliabilityManifest" },
        "metadata": { "$ref": "#/definitions/Metadata" },
        "spec": { "$ref": "#/definitions/Spec" }
      }
    },
    
    "TemplateMetadata": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[a-z0-9-]+$"
        },
        "description": { "type": "string" }
      }
    },
    
    "Template": {
      "type": "object",
      "required": ["apiVersion", "kind", "metadata", "spec"],
      "properties": {
        "apiVersion": { "const": "opensrm.io/v1" },
        "kind": { "const": "Template" },
        "metadata": { "$ref": "#/definitions/TemplateMetadata" },
        "spec": {
          "type": "object",
          "description": "Partial spec to inherit from",
          "properties": {
            "type": { "$ref": "#/definitions/ServiceType" },
            "slos": { "$ref": "#/definitions/SLOs" },
            "ownership": { "$ref": "#/definitions/Ownership" },
            "instrumentation": { "$ref": "#/definitions/Instrumentation" }
          }
        }
      }
    }
  }
}
```

---

## 13. Examples

### 13.1 Minimal API Service

```yaml
apiVersion: opensrm.io/v1
kind: ServiceReliabilityManifest
metadata:
  name: user-service
  tier: standard
spec:
  type: api
  slos:
    availability:
      target: 0.999
  ownership:
    team: platform-users
```

### 13.2 Full API Service with Contract

```yaml
apiVersion: opensrm.io/v1
kind: ServiceReliabilityManifest
metadata:
  name: payment-gateway
  tier: critical
spec:
  type: api
  
  contract:
    availability: 0.9999
    latency:
      p99: 200ms
    throughput:
      max_rps: 10000
      
  slos:
    availability:
      target: 0.99995
      window: 30d
    latency:
      p99: 150ms
      target: 0.995
      window: 30d
    error_rate:
      target: 0.0001
      window: 30d
      
  dependencies:
    - service: stripe-adapter
      critical: true
      expects:
        availability: 0.9999
        latency:
          p99: 100ms
    - service: fraud-detection
      critical: true
      expects:
        availability: 0.999
        
  ownership:
    team: platform-payments
    slack: "#payments-oncall"
    pagerduty: PAYMENTS_CRITICAL
    runbook: https://wiki.example.com/runbooks/payment-gateway
    oncall_required: true
    
  instrumentation:
    metrics:
      requests_total: payment_gateway_requests_total
      request_duration: payment_gateway_request_duration_seconds
    labels:
      service: payment-gateway
      environment: production
```

### 13.3 AI Gate Service

```yaml
apiVersion: opensrm.io/v1
kind: ServiceReliabilityManifest
metadata:
  name: code-review-bot
  tier: standard
spec:
  type: ai-gate

  contract:
    availability: 0.999
    latency:
      p99: 30s
    judgment:
      max_reversal_rate: 0.05
      max_hcf_rate: 0.02
      max_audit_accuracy: 0.95
      max_escalation_rate: 0.25

  slos:
    availability:
      target: 0.9995
      window: 30d
    latency:
      p99: 20s
      target: 0.99
      window: 30d
    judgment:
      reversal:
        rate:
          target: 0.03
          window: 30d
          observation_period: 7d
        high_confidence_failure:
          target: 0.01
          confidence_threshold: 0.8
          window: 30d
      audit:
        enabled: true
        sample_rate: 0.10
        accuracy:
          target: 0.95
          window: 30d
      escalation:
        rate:
          min: 0.10
          max: 0.25
      calibration:
        enabled: true
        ece:
          target: 0.15
          window: 30d

  ownership:
    team: developer-experience
    slack: "#dx-oncall"
    runbook: https://wiki.example.com/runbooks/code-review-bot

  instrumentation:
    events:
      decision: ai_gate.decision
      reversal: ai_gate.reversal
      outcome: ai_gate.outcome
      audit_result: ai_gate.audit
    attributes:
      decision_id: ai_gate.decision_id
      confidence: ai_gate.confidence
```

### 13.4 Service Using Template

```yaml
# templates/api-critical.yaml
apiVersion: opensrm.io/v1
kind: Template
metadata:
  name: api-critical
  description: Critical API service defaults
spec:
  type: api
  slos:
    availability:
      target: 0.9999
      window: 30d
    latency:
      p99: 200ms
      target: 0.99
  ownership:
    oncall_required: true
---
# services/checkout-service.yaml
apiVersion: opensrm.io/v1
kind: ServiceReliabilityManifest
metadata:
  name: checkout-service
  tier: critical
  template: api-critical
spec:
  slos:
    latency:
      p99: 300ms                   # Override: relaxed for checkout
      
  contract:
    availability: 0.9999
    latency:
      p99: 500ms
      
  dependencies:
    discovery: auto
    explicit:
      - service: payment-gateway
        critical: true
        expects:
          availability: 0.9999
          
  ownership:
    team: platform-checkout
    slack: "#checkout-oncall"
    runbook: https://wiki.example.com/runbooks/checkout
```

### 13.5 Worker Service

```yaml
apiVersion: opensrm.io/v1
kind: ServiceReliabilityManifest
metadata:
  name: invoice-generator
  tier: standard
spec:
  type: worker
  
  slos:
    availability:
      target: 0.999
      window: 7d
    processing_time:
      p99: 5m
      target: 0.99
      window: 7d
      
  ownership:
    team: billing
    slack: "#billing-alerts"
```

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **SLO** | Service Level Objective - target reliability metric |
| **SLI** | Service Level Indicator - the measured metric |
| **Error Budget** | Allowed unreliability: `1 - SLO target` |
| **Contract** | External reliability promise to dependents |
| **Judgment SLO** | SLO measuring AI decision quality |
| **Reversal** | Human override of an AI decision |
| **HCF** | High-Confidence Failure - confident but wrong |
| **ECE** | Expected Calibration Error - confidence vs accuracy |
| **Escalation** | AI declining to decide, requesting human judgment |
| **Audit** | Proactive human review of a sampled AI decision |
| **Defect Signal** | Downstream event indicating a decision was incorrect |
| **Autonomous Accuracy** | Accuracy of decisions made without escalation |
| **Segment** | A category of decisions with distinct quality targets |
| **Stability** | Consistency of decision quality metrics over time |
| **Outcome** | Ground truth about decision correctness from downstream consequences |

---

## Appendix B: Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0-draft | 2025-01 | Initial draft |

# Service Reliability Manifest Specification

**Version:** 1.0.0-draft
**Status:** Draft
**Last Updated:** 2026-01-26

## Table of Contents

1. [Overview](#overview)
2. [Conformance Language](#conformance-language)
3. [Document Structure](#document-structure)
4. [Metadata](#metadata)
5. [Spec](#spec)
   - [Service Types](#service-types)
   - [SLOs](#slos)
     - [Judgment SLOs](#judgment-slos)
   - [Contracts](#contracts)
   - [Dependencies](#dependencies)
   - [Instrumentation](#instrumentation)
   - [Ownership](#ownership)
   - [Observability](#observability)
   - [Deployment](#deployment)
6. [Templates](#templates)
7. [Validation Rules](#validation-rules)
8. [Extension Points](#extension-points)

---

## Overview

A Service Reliability Manifest (SRM) is a YAML document that declares the reliability requirements for a service. It answers:

- **How reliable should this service be?** (SLOs)
- **What does it promise to consumers?** (Contracts)
- **What does it depend on?** (Dependencies)
- **Who owns it?** (Ownership)
- **How do we observe it?** (Observability)
- **What are the deployment constraints?** (Deployment)

### Filename Convention

Manifests SHOULD be named `service.reliability.yaml` or `<service-name>.reliability.yaml` and placed in the service's repository root.

### Encoding

Manifests MUST be valid YAML 1.2 encoded as UTF-8.

---

## Conformance Language

This specification uses the following conformance keywords:

| Keyword | Meaning |
|---------|---------|
| **REQUIRED** | The feature MUST be implemented for conformance |
| **RECOMMENDED** | The feature SHOULD be implemented for production use |
| **OPTIONAL** | The feature MAY be implemented as an enhancement |

---

## Document Structure

Every manifest has four top-level fields:

```yaml
apiVersion: srm/v1          # REQUIRED
kind: ServiceReliabilityManifest  # REQUIRED
metadata: {}                # REQUIRED
spec: {}                    # REQUIRED
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiVersion` | string | REQUIRED | Schema version. Must be `srm/v1` |
| `kind` | string | REQUIRED | Must be `ServiceReliabilityManifest` or `Template` |
| `metadata` | object | REQUIRED | Service identity and classification |
| `spec` | object | REQUIRED | Reliability requirements |

---

## Metadata

The `metadata` section identifies the service and its classification.

```yaml
metadata:
  name: payment-api
  team: payments
  tier: critical
  template: api-critical            # OPTIONAL: inherit from template
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
| `name` | string | REQUIRED | Unique service identifier. Must match `[a-z0-9-]+` |
| `team` | string | REQUIRED | Owning team identifier |
| `tier` | enum | REQUIRED | Service criticality: `critical`, `high`, `standard`, `low` |
| `template` | string | OPTIONAL | Name of template to inherit from |
| `description` | string | RECOMMENDED | Human-readable description |
| `labels` | map[string]string | OPTIONAL | Key-value pairs for filtering/grouping |
| `annotations` | map[string]string | OPTIONAL | Arbitrary metadata (not used for selection) |

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
  type: api  # or worker, stream, ai-gate, batch, database
```

| Type | Description | Applicable SLOs |
|------|-------------|-----------------|
| `api` | Request/response services (REST, gRPC, GraphQL) | availability, latency, error_rate |
| `worker` | Background job processors | availability, processing_time, throughput, backlog |
| `stream` | Event stream processors (Kafka consumers, etc.) | availability, lag, throughput, error_rate |
| `ai-gate` | AI-powered decision systems | availability, latency, + judgment SLOs |
| `batch` | Scheduled/triggered batch jobs (ETL, reports, etc.) | success_rate, duration, schedule_adherence, data_freshness |
| `database` | Database services (managed internally) | availability, query_latency, replication_lag, connection_availability |

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

#### Type: `worker`

Worker services are background job processors that run continuously. Examples include:

- Queue consumers (SQS, RabbitMQ workers)
- Background task processors (Celery, Sidekiq)
- Async event handlers

When `type: worker` is specified:
- Worker-specific SLOs become applicable: `processing_time`, `backlog`
- The `throughput` SLO measures jobs processed per time unit
- Traditional `latency` SLOs are typically not applicable (use `processing_time` instead)

#### Type: `stream`

Stream services are event stream processors that consume from message brokers. Examples include:

- Kafka consumers
- Kinesis stream processors
- Event-driven microservices

When `type: stream` is specified:
- Stream-specific SLOs become applicable: `lag`
- The `throughput` SLO measures events processed per time unit
- `lag` measures consumer offset lag from the stream head

#### Type: `batch`

Batch services are scheduled or triggered jobs that run to completion, as opposed to continuously running services. Examples include:

- ETL pipelines (dbt, Airflow tasks)
- Data exports and reports
- Scheduled cleanup jobs
- Periodic aggregations
- ML training pipelines

Batch services have distinct characteristics that differentiate them from `worker` services:
- **Finite execution**: Jobs start, run, and complete (vs. workers which run continuously)
- **Scheduled/triggered**: Runs are initiated on a schedule or by an event
- **Measured by completion**: Success is defined by job completion, not throughput

When `type: batch` is specified:
- Batch-specific SLOs become applicable: `success_rate`, `duration`, `schedule_adherence`, `data_freshness`
- The existing `throughput` SLO can be used for records processed per run
- Traditional SLOs like `latency` are typically not applicable (use `duration` instead)

#### Type: `database`

Database services are internally-managed database instances or clusters provided as a service to other teams. Examples include:

- Managed MySQL/PostgreSQL clusters
- Internal database-as-a-service platforms
- Shared analytical databases (ClickHouse, TimescaleDB)
- Managed Redis or MongoDB clusters

Database services are distinct from databases listed as dependencies:
- **As a service type**: Used by teams that *operate* databases and define reliability contracts for consumers
- **As a dependency type**: Used by teams that *consume* databases and reference the provider's SLOs

When `type: database` is specified:
- Database-specific SLOs become applicable: `query_latency`, `replication_lag`, `connection_availability`
- The `availability` SLO measures overall database availability
- Consuming services can reference this manifest via `dependencies[].manifest`

**Linking providers and consumers**:
```yaml
# Provider: database-platform team's manifest
metadata:
  name: mysql-shared
spec:
  type: database
  slos:
    availability:
      target: 0.9999
    query_latency:
      p99: 10ms
      target: 0.99

# Consumer: application team's manifest
spec:
  dependencies:
    - service: mysql-shared
      type: database
      manifest: https://github.com/org/mysql-shared/blob/main/service.reliability.yaml
```

---

### SLOs

Defines Service Level Objectives. All ratio-based targets use decimal format (0.0 - 1.0) where 0.999 represents 99.9%.

```yaml
spec:
  slos:
    availability:
      target: 0.9995
      window: 30d

    latency:
      p50: 50ms
      p99: 200ms
      p999: 1s
      target: 0.99
      window: 30d

    error_rate:
      target: 0.001
      window: 7d

    throughput:
      target: 1000
      unit: rps
      window: 1h
```

#### Availability

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | number | REQUIRED | Target ratio (0.0 - 1.0). E.g., `0.9995` for 99.95% |
| `window` | duration | RECOMMENDED | Measurement window. Default: `30d` |

#### Latency

Latency supports multiple percentiles in a single block:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `p50` | duration | OPTIONAL | Target median latency (e.g., `50ms`, `200ms`) |
| `p90` | duration | OPTIONAL | Target 90th percentile |
| `p95` | duration | OPTIONAL | Target 95th percentile |
| `p99` | duration | RECOMMENDED | Target 99th percentile |
| `p999` | duration | OPTIONAL | Target 99.9th percentile |
| `target` | number | REQUIRED | Ratio of requests meeting threshold (0.0 - 1.0) |
| `window` | duration | RECOMMENDED | Measurement window. Default: `30d` |

At least one percentile (`p50`, `p90`, `p95`, `p99`, or `p999`) MUST be specified.

**Example**:
```yaml
latency:
  p50: 50ms      # Median should be under 50ms
  p99: 200ms     # 99th percentile under 200ms
  target: 0.99   # 99% of requests meet thresholds
  window: 30d
```

#### Error Rate

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | number | REQUIRED | Maximum error ratio (0.0 - 1.0). E.g., `0.001` for 0.1% |
| `window` | duration | RECOMMENDED | Measurement window. Default: `30d` |

#### Throughput

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | number | REQUIRED | Minimum throughput |
| `unit` | enum | REQUIRED | `rps`, `rpm`, `rph` |
| `window` | duration | RECOMMENDED | Measurement window. Default: `1h` |

#### Processing Time (Workers)

*Applicable when `spec.type: worker`*

Measures job completion time for background workers.

```yaml
spec:
  type: worker
  slos:
    processing_time:
      p50: 30s
      p99: 5m
      target: 0.99
      window: 7d
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `p50` | duration | OPTIONAL | Target median processing time |
| `p90` | duration | OPTIONAL | Target 90th percentile |
| `p95` | duration | OPTIONAL | Target 95th percentile |
| `p99` | duration | RECOMMENDED | Target 99th percentile |
| `target` | number | REQUIRED | Ratio of jobs meeting threshold (0.0 - 1.0) |
| `window` | duration | RECOMMENDED | Measurement window. Default: `7d` |

#### Lag (Streams)

*Applicable when `spec.type: stream`*

Measures consumer lag from stream head.

```yaml
spec:
  type: stream
  slos:
    lag:
      max_seconds: 30
      target: 0.99
      window: 7d
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `max_seconds` | number | REQUIRED | Maximum acceptable lag in seconds |
| `target` | number | REQUIRED | Ratio of time within threshold (0.0 - 1.0) |
| `window` | duration | RECOMMENDED | Measurement window. Default: `7d` |

#### Duration Format

Durations use a number followed by a unit suffix:

| Suffix | Meaning |
|--------|---------|
| `ms` | milliseconds |
| `s` | seconds |
| `m` | minutes |
| `h` | hours |
| `d` | days |
| `w` | weeks |

Examples: `100ms`, `30s`, `5m`, `30d`, `7d`, `24h`, `1h`, `1w`

#### OpenSLO Reference

Instead of inline definitions, manifests MAY reference external OpenSLO files:

```yaml
spec:
  slos:
    openslo:
      - path: ./slos/availability.yaml
      - path: ./slos/latency.yaml
```

#### Batch SLOs

*Applicable when `spec.type: batch`*

Batch SLOs measure the reliability characteristics of scheduled or triggered jobs.

```yaml
spec:
  type: batch
  slos:
    success_rate:
      target: 0.995
      window: 7d

    duration:
      p95: 30m
      target: 0.95
      window: 30d

    schedule_adherence:
      max_delay: 5m
      window: 7d

    data_freshness:
      max_age: 1h
      window: 7d
```

##### `success_rate`

Measures the ratio of job runs that complete successfully.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | number | REQUIRED | Target success ratio (0.0 - 1.0). E.g., `0.995` for 99.5% |
| `window` | duration | RECOMMENDED | Measurement window. Default: `7d` |

**Calculation**:
```
success_rate = count(successful_runs) / count(total_runs)
```

**Recommended targets**:

| Tier | Target |
|------|--------|
| critical | >= 0.999 |
| standard | >= 0.995 |
| low | >= 0.99 |

##### `duration`

Measures job execution time at given percentiles.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `p50` | duration | OPTIONAL | Target median duration |
| `p90` | duration | OPTIONAL | Target 90th percentile |
| `p95` | duration | RECOMMENDED | Target 95th percentile |
| `p99` | duration | OPTIONAL | Target 99th percentile |
| `target` | number | REQUIRED | Ratio of jobs meeting threshold (0.0 - 1.0) |
| `window` | duration | RECOMMENDED | Measurement window. Default: `30d` |

**Measurement**:
1. Record `start_time` and `end_time` for each job run
2. Calculate `duration = end_time - start_time`
3. Compute percentiles over the window

**Example**: A target of `30m` at `p95` with `target: 0.95` means 95% of jobs should complete within 30 minutes.

##### `schedule_adherence`

Measures whether jobs start within an acceptable window of their scheduled time.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `max_delay` | duration | REQUIRED | Maximum acceptable delay from scheduled start time |
| `window` | duration | RECOMMENDED | Measurement window. Default: `7d` |

**Calculation**:
```
adherence = count(runs WHERE actual_start - scheduled_start <= max_delay) / count(total_runs)
```

**Use cases**:
- Jobs that feed downstream dependencies with time constraints
- Reports that must be ready by a certain time
- Jobs with SLA commitments on delivery time

##### `data_freshness`

Measures how recent the output data is, ensuring downstream consumers have up-to-date information.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `max_age` | duration | REQUIRED | Maximum acceptable age of output data |
| `window` | duration | RECOMMENDED | Measurement window. Default: `7d` |

**Calculation**:
```
freshness = now - last_successful_output_timestamp
SLO met when freshness <= max_age
```

**Use cases**:
- Data pipelines where downstream systems depend on recent data
- Reporting systems with freshness requirements
- ML feature pipelines that need current data

**Example**: `max_age: 1h` means output data should never be more than 1 hour old.

#### Database SLOs

*Applicable when `spec.type: database`*

Database SLOs measure the reliability characteristics of internally-managed database services.

```yaml
spec:
  type: database
  slos:
    availability:
      target: 0.9999
      window: 30d

    query_latency:
      p50: 5ms
      p99: 10ms
      target: 0.99
      window: 30d

    replication_lag:
      max_lag: 1s
      window: 30d

    connection_availability:
      target: 0.9999
      window: 30d
```

##### `query_latency`

Measures query response time at given percentiles.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `p50` | duration | OPTIONAL | Target median query latency |
| `p90` | duration | OPTIONAL | Target 90th percentile |
| `p95` | duration | OPTIONAL | Target 95th percentile |
| `p99` | duration | RECOMMENDED | Target 99th percentile |
| `p999` | duration | OPTIONAL | Target 99.9th percentile |
| `target` | number | REQUIRED | Ratio of queries meeting threshold (0.0 - 1.0) |
| `window` | duration | RECOMMENDED | Measurement window. Default: `30d` |

**Measurement**:
- Track query execution time from connection receipt to response sent
- Exclude client-side latency (network round-trip)
- Consider separating read vs. write latency if significantly different

**Recommended targets**:

| Use Case | p99 Target |
|----------|------------|
| OLTP (transactional) | 10-50ms |
| OLAP (analytical) | 1-10s |
| Key-value lookups | 1-5ms |

##### `replication_lag`

Measures the delay between primary and replica databases.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `max_lag` | string | REQUIRED | Maximum acceptable lag (e.g., `1s`, `500ms`, `5m`) |
| `window` | duration | RECOMMENDED | Measurement window. Default: `30d` |

**Calculation**:
```
replication_lag = replica_position - primary_position (in time)
SLO met when lag <= max_lag for target percentage of time
```

**Use cases**:
- Read replicas serving real-time data
- Disaster recovery with RPO requirements
- Cross-region replication monitoring

**Recommended targets**:

| Scenario | Max Lag |
|----------|---------|
| Real-time reads | < 1s |
| Near real-time | < 10s |
| Async replication | < 1m |

##### `connection_availability`

Measures the availability of database connections.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | number | REQUIRED | Target connection availability ratio (0.0 - 1.0). E.g., `0.9999` for 99.99% |
| `window` | duration | RECOMMENDED | Measurement window. Default: `30d` |

**Calculation**:
```
connection_availability = successful_connections / attempted_connections
```

**Measurement**:
- Track connection attempts and failures
- Include connection pool exhaustion as failures
- Monitor both initial connections and connection health checks

**Note**: This SLO is separate from `availability` because a database can be "up" but unable to accept new connections due to pool exhaustion or max connection limits.

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

**Why it matters**: High reversal rates indicate the AI gate is not trusted or is making poor decisions. This metric is measurable without ground truth - you only need to observe downstream behavior.

**Calculation**:
```
reversal_rate = count(reversals within observation_period) / count(decisions)
```

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | float | REQUIRED | Maximum acceptable reversal rate (0.0 - 1.0) |
| `window` | duration | REQUIRED | SLO evaluation window (e.g., `30d`) |
| `observation_period` | duration | RECOMMENDED | Time to wait for reversals after a decision. Default: `24h` |

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
  "timestamp": "2026-01-20T10:00:00Z"
}

// Reversal event (within 24h)
{
  "event": "ai_gate.reversal",
  "decision_id": "dec_abc123",
  "reversal_type": "human_override",
  "timestamp": "2026-01-20T14:30:00Z"
}
```

**Recommended targets**:

| Tier | Target |
|------|--------|
| critical | <= 0.03 (3%) |
| standard | <= 0.05 (5%) |
| low | <= 0.10 (10%) |

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
| `target` | float | REQUIRED | Maximum acceptable failure rate for high-confidence decisions (0.0 - 1.0) |
| `window` | duration | REQUIRED | SLO evaluation window |
| `confidence_threshold` | float | RECOMMENDED | What counts as "high confidence". Default: `0.9` |

**Measurement**:
1. Filter decisions where `confidence >= confidence_threshold`
2. Of those, count how many were reversed (using same reversal logic as `reversal_rate`)
3. Calculate rate over the `window`

**Recommended targets**:

| Tier | Target |
|------|--------|
| critical | <= 0.01 (1%) |
| standard | <= 0.02 (2%) |
| low | <= 0.05 (5%) |

##### `calibration`

Measures whether stated confidence scores predict actual accuracy.

**Why it matters**: A well-calibrated system allows downstream consumers to make informed decisions based on confidence. If a system says it's 90% confident, it should be correct ~90% of the time.

**Calculation** (Expected Calibration Error):
```
ECE = sum (|accuracy_b - confidence_b| x weight_b) for each bin b

Where:
- Decisions are bucketed by confidence (e.g., 0.0-0.1, 0.1-0.2, ..., 0.9-1.0)
- accuracy_b = correct decisions in bin / total decisions in bin
- confidence_b = average confidence score in bin
- weight_b = decisions in bin / total decisions
```

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | float | REQUIRED | Maximum acceptable ECE (0.0 - 1.0). Lower is better. |
| `window` | duration | REQUIRED | SLO evaluation window |

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
| Poor | >= 0.20 |

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
| `p50` | duration | OPTIONAL | Target for median feedback latency |
| `p90` | duration | OPTIONAL | Target for 90th percentile feedback latency |

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

### Contracts

A contract declares the reliability guarantees a service promises to its dependents.

**Purpose**:
- **Internal SLOs** = what you measure and alert on (often tighter)
- **Contract** = what you promise externally (your SLA to internal consumers)

This decouples teams: providers commit to contracts, consumers code against them.

```yaml
spec:
  contract:
    availability: 0.999
    latency:
      p50: 50ms
      p99: 200ms
    throughput:
      max_rps: 10000
      burst: 15000
```

#### Contract Fields

| Field | Type | Description |
|-------|------|-------------|
| `availability` | number (0-1) | Promised uptime ratio |
| `latency.p50` | duration | Promised median latency |
| `latency.p99` | duration | Promised 99th percentile |
| `latency.p999` | duration | Promised 99.9th percentile |
| `throughput.max_rps` | integer | Maximum sustained requests/second |
| `throughput.burst` | integer | Maximum burst above steady-state |

#### AI Gate Contracts

AI gate services may include judgment guarantees:

```yaml
spec:
  type: ai-gate
  contract:
    availability: 0.999
    latency:
      p99: 30s
    judgment:
      max_reversal_rate: 0.05
      max_hcf_rate: 0.02
      max_feedback_latency: 7d
```

#### Contract vs SLO

Internal SLOs SHOULD be tighter than contracts to provide margin:

```yaml
spec:
  contract:
    availability: 0.999            # Promise to others

  slos:
    availability:
      target: 0.9995               # Internal target (tighter)
```

Implementations SHOULD warn when `slos.*.target` is looser than `contract.*`.

---

### Dependencies

Declares upstream dependencies and their expected guarantees.

```yaml
spec:
  dependencies:
    - service: postgresql
      type: database
      critical: true
      expects:
        availability: 0.9995

    - service: redis
      type: cache
      critical: false

    - service: user-service
      type: service
      critical: true
      manifest: https://github.com/org/user-service/blob/main/service.reliability.yaml
      expects:
        availability: 0.999
        latency:
          p99: 100ms
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | string | REQUIRED | Dependency identifier (service name) |
| `type` | enum | RECOMMENDED | `service`, `database`, `cache`, `queue`, `external` |
| `critical` | boolean | RECOMMENDED | Whether failure causes service failure. Default: `true` |
| `expects` | object | OPTIONAL | Expected guarantees from dependency |
| `expects.availability` | number | OPTIONAL | Expected availability ratio (0.0 - 1.0) |
| `expects.latency` | object | OPTIONAL | Expected latency guarantees |
| `expects.latency.p99` | duration | OPTIONAL | Expected 99th percentile latency |
| `manifest` | string | OPTIONAL | URL to dependency's SRM manifest |

#### Dependency Impact

When `critical: true`, the dependency's availability is factored into SLO feasibility calculations:

```
max_achievable = dependency_1_slo x dependency_2_slo x ... x dependency_n_slo
```

If `max_achievable < service_target`, implementations SHOULD warn about infeasible SLO targets.

#### Contract Validation

Implementations SHOULD check:
1. **Expectations <= Promises**: Warn if `expects.availability > provider.contract.availability`
2. **Transitive feasibility**: Warn if service promises better than critical deps can deliver
3. **Missing contracts**: Warn if depending on service without published contract

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
| `events.decision` | string | REQUIRED | Event name emitted when AI makes a decision |
| `events.reversal` | string | REQUIRED | Event name emitted when a decision is overridden |
| `events.outcome` | string | OPTIONAL | Event name emitted when ground truth is known |

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
| `attributes.decision_id` | string | OPTIONAL | `decision_id` | Field name for decision identifier |
| `attributes.confidence` | string | OPTIONAL | `confidence` | Field name for confidence score |
| `attributes.decision` | string | OPTIONAL | `decision` | Field name for decision value |

This allows flexibility when integrating with existing event schemas.

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
| `team` | string | REQUIRED | Team identifier (should match `metadata.team`) |
| `slack` | string | RECOMMENDED | Slack channel for the team |
| `email` | string | OPTIONAL | Team email address |
| `escalation` | string | OPTIONAL | On-call rotation or escalation policy name |
| `pagerduty.service_id` | string | OPTIONAL | PagerDuty service ID |
| `pagerduty.escalation_policy_id` | string | OPTIONAL | PagerDuty escalation policy ID |
| `runbook` | string | RECOMMENDED | URL to operational runbook |
| `documentation` | string | OPTIONAL | URL to service documentation |

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
| `required` | []string | OPTIONAL | Metric names that must exist |
| `labels.required` | []string | OPTIONAL | Labels that must be present on metrics |
| `convention` | enum | OPTIONAL | Naming convention: `opentelemetry`, `prometheus`. Default: `opentelemetry` |

#### Dashboards

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `required` | boolean | OPTIONAL | Whether dashboards must exist |
| `urls` | []string | OPTIONAL | URLs to service dashboards |

#### Alerts

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `required` | boolean | OPTIONAL | Whether alerts must be configured |
| `definitions` | []AlertDef | OPTIONAL | Alert definitions |

AlertDef:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | REQUIRED | Alert name |
| `severity` | enum | REQUIRED | `critical`, `warning`, `info` |
| `threshold` | string | OPTIONAL | Human-readable threshold description |

#### Tracing

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `required` | boolean | OPTIONAL | Whether distributed tracing must be enabled |
| `sampling_rate` | number | OPTIONAL | Expected sampling rate (0.0 - 1.0) |

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
| `automatic` | boolean | OPTIONAL | Whether automatic rollback is enabled |
| `criteria` | object | OPTIONAL | Conditions that trigger rollback |

---

## Templates

Templates enable inheritance of common configurations across services.

### Template Definition

```yaml
apiVersion: srm/v1
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
```

### Template Usage

Services reference templates in metadata:

```yaml
apiVersion: srm/v1
kind: ServiceReliabilityManifest
metadata:
  name: checkout-service
  team: checkout
  tier: critical
  template: api-critical          # Inherit from template
spec:
  slos:
    latency:
      p99: 300ms                  # Override: relaxed for checkout
      target: 0.99
```

### Inheritance Rules

1. **Shallow merge at top level**: `spec.slos`, `spec.ownership`, etc. merge independently
2. **Deep replace at leaf level**: `spec.slos.latency` replaces entirely if specified
3. **Service wins**: Any value in service manifest overrides template
4. **No chaining**: Templates cannot inherit from other templates
5. **Required fields**: Templates may omit required fields if services provide them

### Merge Examples

| Template | Service | Result |
|----------|---------|--------|
| `slos.availability.target: 0.999` | (not set) | `0.999` |
| `slos.availability.target: 0.999` | `slos.availability.target: 0.9999` | `0.9999` |
| `slos.latency: {p99: 500ms}` | `slos.latency: {p99: 200ms}` | `{p99: 200ms}` |
| (not set) | `slos.judgment: {...}` | `{...}` |

### Common Templates

Organizations SHOULD define standard templates:

| Template | Use Case |
|----------|----------|
| `api-critical` | High-availability APIs (0.9999) |
| `api-standard` | Standard APIs (0.999) |
| `api-internal` | Internal-only APIs (0.99) |
| `worker-standard` | Background job processors |
| `ai-gate-standard` | AI decision services |

---

## Validation Rules

Implementations MUST validate:

1. **Schema validity** - Document matches JSON Schema
2. **Required fields** - All required fields present
3. **Value constraints** - Enums, ranges, formats are valid
4. **Internal consistency** - e.g., `metadata.team` matches `spec.ownership.team`

Implementations SHOULD validate:

1. **SLO feasibility** - Targets achievable given dependencies
2. **Metric existence** - Required metrics exist in observability backend
3. **Dashboard existence** - Dashboard URLs are accessible
4. **Runbook existence** - Runbook URLs are accessible
5. **Contract consistency** - SLOs are tighter than contracts

Implementations MAY validate:

1. **Tier requirements** - Tier-specific fields are present
2. **Naming conventions** - Metric names follow conventions
3. **Cross-service consistency** - Dependencies reference valid services

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
        target: 0.95
        description: Ratio of started checkouts that complete
```

---

## Changelog

### v1.0.0-draft (2026-01-26)

- Add conformance language (REQUIRED/RECOMMENDED/OPTIONAL)
- Change SLO targets from percentage to ratio format (0.999 instead of 99.9)
- Add multi-percentile latency format (p50, p99, p999 in single block)
- Add Contracts section for external promises
- Add Templates (`kind: Template`) for inheritance
- Update Dependencies: `name` -> `service`, `slo` -> `expects`
- Add `processing_time` SLO for worker services
- Add `lag` SLO for stream services

### v1.0.0-draft (2026-01-25)

- Add `database` service type for internally-managed database services
- Add database-specific SLOs: `query_latency`, `replication_lag`, `connection_availability`
- Add `batch` service type for ETL/batch processing workloads
- Add batch-specific SLOs: `success_rate`, `duration`, `schedule_adherence`, `data_freshness`
- Add Service Types (`api`, `worker`, `stream`, `ai-gate`)
- Add Judgment SLOs for AI gates (`reversal_rate`, `high_confidence_failure`, `calibration`, `feedback_latency`)
- Add Instrumentation section for AI gate telemetry
- Add `w` (weeks) to duration format

### v1.0.0-draft (2026-01-23)

- Initial draft specification

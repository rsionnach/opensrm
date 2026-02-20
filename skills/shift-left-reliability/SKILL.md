---
name: shift-left-reliability
description: Embeds reliability thinking into the development workflow. Generates OpenSRM manifests, suggests appropriate SLOs, and validates reliability decisions while code is being written.
---

# Shift-Left Reliability

This skill helps you define service reliability requirements as code using the OpenSRM (Open Service Reliability Manifest) specification. It generates reliability manifests, suggests appropriate SLOs, validates dependency contracts, and ensures reliability decisions happen during development—not after incidents.

## When to Use This Skill

Use this skill when:
- Creating a new service or microservice
- Adding reliability requirements to an existing service
- Building AI-powered features that make decisions (AI gates)
- Reviewing code for reliability implications
- Planning deployments and wanting to check error budget
- Defining contracts between services

## Core Concepts

### OpenSRM Manifest

Every service should have a `service.reliability.yaml` file that declares:
- **Service type**: api, worker, stream, ai-gate, batch, or database
- **Tier**: critical, high, standard, or low
- **SLOs**: availability, latency, error rate targets
- **Contract**: what you promise to dependents
- **Dependencies**: what you need from upstream services
- **Observability**: required metrics, dashboards, alerts, tracing
- **Deployment**: deployment gates and rollback criteria

### Service Types

| Type | Use For | Key SLOs |
|------|---------|----------|
| `api` | Synchronous request/response | availability, latency, error_rate |
| `worker` | Async job processors | availability, processing_time, throughput |
| `stream` | Event streaming | availability, lag, throughput |
| `ai-gate` | AI decision services | availability, latency + judgment SLOs |
| `batch` | Scheduled/triggered jobs (ETL, reports) | success_rate, duration, schedule_adherence, data_freshness |
| `database` | Internally-managed databases | availability, query_latency, replication_lag, connection_availability |

### Judgment SLOs (AI Gates)

For services that make AI-powered decisions, track decision quality:
- **reversal_rate**: How often humans override AI decisions
- **high_confidence_failure**: When AI is confident AND wrong
- **calibration**: Does stated confidence match actual accuracy
- **feedback_latency**: Time until decision quality is known

## Generating a Manifest

### For a New Service

When creating a new service, generate a reliability manifest:

```yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: {service-name}
  team: {team-name}
  tier: standard                    # Adjust based on business criticality
  template: api-standard            # Use appropriate template
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
    team: {team-name}
    slack: "#{oncall-channel}"
```

### For an AI-Powered Service

When the service makes decisions (approvals, reviews, classifications):

```yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: {service-name}
  team: {team-name}
  tier: standard
spec:
  type: ai-gate                     # Enables judgment SLOs

  slos:
    availability:
      target: 0.999
    latency:
      p99: 30s
      target: 0.99
    judgment:
      reversal_rate:
        target: 0.05                # ≤5% human overrides
        observation_period: 7d
      high_confidence_failure:
        target: 0.02                # ≤2% confident and wrong
        confidence_threshold: 0.8

  ownership:
    team: {team-name}
    slack: "#{oncall-channel}"

  instrumentation:
    events:
      decision: ai_gate.decision
      reversal: ai_gate.reversal
      outcome: ai_gate.outcome
```

## Recommended Targets by Tier

### Critical Tier
- Availability: ≥ 99.95% (0.9995)
- Latency p99: ≤ 200ms
- Error rate: ≤ 0.01%
- Reversal rate (AI): ≤ 3%
- High-confidence failure (AI): ≤ 1%

### High Tier
- Availability: ≥ 99.9% (0.999)
- Latency p99: ≤ 300ms
- Error rate: ≤ 0.05%
- Reversal rate (AI): ≤ 4%
- High-confidence failure (AI): ≤ 1.5%

### Standard Tier
- Availability: ≥ 99.5% (0.995)
- Latency p99: ≤ 500ms
- Error rate: ≤ 0.1%
- Reversal rate (AI): ≤ 5%
- High-confidence failure (AI): ≤ 2%

### Low Tier
- Availability: ≥ 99% (0.99)
- Latency p99: ≤ 2s
- Error rate: ≤ 1%
- Reversal rate (AI): ≤ 10%
- High-confidence failure (AI): ≤ 5%

## Contracts and Dependencies

### Defining a Contract

A contract declares what you promise to services that depend on you:

```yaml
spec:
  contract:
    availability: 0.999             # What you promise externally
    latency:
      p99: 200ms

  slos:
    availability:
      target: 0.9995                # Internal target (should be tighter)
```

**Rule**: Internal SLO targets should always be tighter than contract promises.

### Declaring Dependencies

```yaml
spec:
  dependencies:
    - service: payment-gateway
      type: service
      critical: true                # On critical path
      expects:
        availability: 0.999
        latency:
          p99: 100ms

    - service: notification-service
      type: service
      critical: false               # Can degrade gracefully
```

**Dependency types**: `service`, `database`, `cache`, `queue`, `external`

### Dependency Math

Your achievable availability is limited by your dependencies:

```
Chain: A → B → C
Combined: 0.999 × 0.999 × 0.999 = 0.997

You cannot promise 99.99% if your dependencies only deliver 99.7% combined.
```

When setting SLO targets, verify they're achievable given dependency contracts.

## AI Gate Instrumentation

For judgment SLOs to work, emit these events:

### Decision Event
```python
# When AI makes a decision
span.set_attribute("ai_gate.decision_id", decision_id)
span.set_attribute("ai_gate.decision", "approve")  # or "reject"
span.set_attribute("ai_gate.confidence", 0.87)
```

### Reversal Event
```python
# When human overrides AI
span.set_attribute("ai_gate.decision_id", original_decision_id)
span.set_attribute("ai_gate.reversal_type", "override")
span.set_attribute("ai_gate.actor", "reviewer")
```

### Outcome Event
```python
# When ground truth is known
span.set_attribute("ai_gate.decision_id", decision_id)
span.set_attribute("ai_gate.outcome", "correct")  # or "incorrect"
span.set_attribute("ai_gate.outcome_source", "human_review")
```

## Validation Checklist

Before committing a reliability manifest, verify:

- [ ] Service type matches actual behavior (api/worker/stream/ai-gate/batch/database)
- [ ] Tier reflects business criticality (critical/high/standard/low)
- [ ] `metadata.team` is set and matches `spec.ownership.team`
- [ ] SLO targets are achievable given dependencies
- [ ] Contract promises are looser than internal targets
- [ ] Dependencies have `type` field set
- [ ] Ownership has team and contact channel
- [ ] Critical tier has runbook URL
- [ ] AI gates have judgment SLOs defined
- [ ] AI gates have instrumentation events mapped
- [ ] Observability requirements declared (metrics, dashboards, alerts)
- [ ] Deployment gates configured for production services

## Integration with NthLayer

The manifest can be validated and enforced with NthLayer:

```bash
# Validate manifest
nthlayer validate service.reliability.yaml

# Generate Prometheus rules
nthlayer generate service.reliability.yaml

# Check if deployment is safe
nthlayer check-deploy --prometheus-url http://prometheus:9090 service.reliability.yaml
```

## Common Patterns

### Pattern: New Microservice
1. Determine service type (api/worker/stream/ai-gate/batch/database)
2. Assess tier based on blast radius (critical/high/standard/low)
3. Start with template, customize targets
4. List critical dependencies with types
5. Define observability requirements (metrics, dashboards, alerts)
6. Set deployment gates if applicable
7. Place `service.reliability.yaml` in repo root

### Pattern: Adding AI Decision Logic
1. Change type to `ai-gate`
2. Add judgment SLOs (start with reversal_rate)
3. Add instrumentation events
4. Consider feedback latency (how soon will you know if decisions are good?)

### Pattern: Service Receiving More Traffic
1. Review if tier should increase
2. Tighten SLO targets if needed
3. Update contract if dependents rely on you more heavily
4. Verify dependencies can support new load

### Pattern: Defining Cross-Team Contract
1. Discuss realistic targets with dependent teams
2. Set contract to what you can reliably deliver
3. Set internal SLOs tighter for margin
4. Document in manifest for visibility

### Pattern: Observability Requirements
Declare what observability tooling must exist for the service:

```yaml
spec:
  observability:
    metrics:
      required:
        - http_server_request_duration_seconds
        - http_server_requests_total
      labels:
        required:
          - service
          - method
          - status_code
      convention: opentelemetry
    dashboards:
      required: true
      urls:
        - https://grafana.example.com/d/my-service
    alerts:
      required: true
      definitions:
        - name: HighErrorRate
          severity: critical
          threshold: "error_rate > 1%"
    tracing:
      required: true
      sampling_rate: 0.1
```

### Pattern: Deployment Gates
Block deployments when reliability conditions aren't met:

```yaml
spec:
  deployment:
    environments:
      - production
      - staging
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
        max_p2: 2
    rollback:
      automatic: false
      criteria:
        error_rate_increase: 5%
        latency_increase: 50%
```

## Templates

Use templates to inherit standard configurations:

```yaml
metadata:
  template: api-critical            # Inherit from template
spec:
  slos:
    latency:
      p99: 100ms                    # Override specific values
```

Available templates:
- `api-critical`: High-availability APIs (99.95%+)
- `api-standard`: Standard APIs (99.5%)
- `worker-standard`: Background processors
- `stream-standard`: Event streaming services
- `ai-gate-standard`: AI decision services with judgment SLOs
- `batch-standard`: Scheduled/triggered batch jobs
- `database-standard`: Internally-managed database services

## References

- OpenSRM Specification: https://github.com/rsionnach/opensrm
- NthLayer CLI: https://github.com/rsionnach/nthlayer
- SLO best practices: See reference/slo-targets.md
- Judgment SLO details: See reference/judgment-slos.md

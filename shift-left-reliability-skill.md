# Shift-Left Reliability Skill

A Claude Code skill that embeds reliability thinking into the development workflow. Generates OpenSRM manifests, suggests appropriate SLOs, and validates reliability decisions while code is being written.

---

## Skill Structure

```
skills/
└── shift-left-reliability/
    ├── SKILL.md                    # Main skill file
    ├── templates/
    │   ├── api-critical.yaml
    │   ├── api-standard.yaml
    │   ├── worker-standard.yaml
    │   ├── stream-standard.yaml
    │   ├── ai-gate-standard.yaml
    │   ├── batch-standard.yaml
    │   └── database-standard.yaml
    ├── examples/
    │   ├── payment-service.yaml
    │   ├── notification-worker.yaml
    │   └── code-review-bot.yaml
    └── reference/
        ├── slo-targets.md
        ├── judgment-slos.md
        └── dependency-math.md
```

---

## SKILL.md

```markdown
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
```

---

## Supporting Files

### templates/api-standard.yaml

```yaml
apiVersion: opensrm/v1
kind: Template
metadata:
  name: api-standard
  description: Standard API service defaults (99.5% availability)
spec:
  type: api
  slos:
    availability:
      target: 0.995
      window: 30d
    latency:
      p99: 500ms
      target: 0.99
    error_rate:
      target: 0.001
      window: 30d
  ownership:
    oncall_required: false
```

### templates/api-critical.yaml

```yaml
apiVersion: opensrm/v1
kind: Template
metadata:
  name: api-critical
  description: Critical API service defaults (99.95%+ availability)
spec:
  type: api
  slos:
    availability:
      target: 0.9995
      window: 30d
    latency:
      p99: 200ms
      target: 0.995
    error_rate:
      target: 0.0001
      window: 30d
  ownership:
    oncall_required: true
```

### templates/ai-gate-standard.yaml

```yaml
apiVersion: opensrm/v1
kind: Template
metadata:
  name: ai-gate-standard
  description: Standard AI gate service with judgment SLOs
spec:
  type: ai-gate
  slos:
    availability:
      target: 0.995
      window: 30d
    latency:
      p99: 30s
      target: 0.99
    judgment:
      reversal_rate:
        target: 0.05
        window: 30d
        observation_period: 7d
      high_confidence_failure:
        target: 0.02
        confidence_threshold: 0.8
        window: 30d
  ownership:
    oncall_required: false
  instrumentation:
    events:
      decision: ai_gate.decision
      reversal: ai_gate.reversal
      outcome: ai_gate.outcome
```

### templates/worker-standard.yaml

```yaml
apiVersion: opensrm/v1
kind: Template
metadata:
  name: worker-standard
  description: Standard background worker defaults
spec:
  type: worker
  slos:
    availability:
      target: 0.995
      window: 7d
    processing_time:
      p99: 5m
      target: 0.99
      window: 7d
  ownership:
    oncall_required: false
```

### templates/stream-standard.yaml

```yaml
apiVersion: opensrm/v1
kind: Template
metadata:
  name: stream-standard
  description: Standard streaming service defaults
spec:
  type: stream
  slos:
    availability:
      target: 0.995
      window: 7d
    lag:
      max_seconds: 30
      target: 0.99
      window: 7d
  ownership:
    oncall_required: false
```

### templates/batch-standard.yaml

```yaml
apiVersion: opensrm/v1
kind: Template
metadata:
  name: batch-standard
  description: Standard batch job defaults
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
  ownership:
    oncall_required: false
```

### templates/database-standard.yaml

```yaml
apiVersion: opensrm/v1
kind: Template
metadata:
  name: database-standard
  description: Standard managed database defaults
spec:
  type: database
  slos:
    availability:
      target: 0.9999
      window: 30d
    query_latency:
      p99: 10ms
      target: 0.99
      window: 30d
    replication_lag:
      max_lag: 1s
      window: 30d
    connection_availability:
      target: 0.9999
      window: 30d
  ownership:
    oncall_required: true
```

### reference/slo-targets.md

```markdown
# SLO Target Guidelines

## Availability Targets

| Target | Monthly Downtime | Tier | Use For |
|--------|------------------|------|---------|
| 99.95%+ | 21.6 minutes | critical | Revenue/safety impact, payment processing, auth |
| 99.9%  | 43.2 minutes | high | Significant user impact, core features |
| 99.5%  | 3.6 hours | standard | Moderate impact, standard services |
| 99%    | 7.2 hours | low | Minimal impact, batch processing, internal tools |

## Latency Targets

| Percentile | Typical Target | Notes |
|------------|----------------|-------|
| p50 | 50-100ms | User-perceived "snappy" |
| p99 | 200-500ms | Catches outliers |
| p999 | 1-2s | Extreme tail |

## Setting Targets

1. **Start conservative**: Easier to tighten than loosen
2. **Measure first**: Set targets based on actual performance
3. **Consider dependencies**: You can't exceed your weakest link
4. **Budget for change**: Leave headroom for deployments
```

### reference/judgment-slos.md

```markdown
# Judgment SLOs for AI Gates

## Why Judgment SLOs?

Traditional SLOs measure system health: "Is it up? Is it fast?"

Judgment SLOs measure decision quality: "Are the AI's decisions good?"

## The Four Judgment SLOs

### 1. Reversal Rate

**What**: Percentage of AI decisions overridden by humans

**Formula**: `reversals / decisions`

**Why it matters**: High reversal rate means humans don't trust the AI

**Target guidance**:
- Critical: ≤ 3%
- Standard: ≤ 5%
- Low: ≤ 10%

**No ground truth needed**: Just track overrides

### 2. High-Confidence Failure (HCF)

**What**: Rate of confident decisions that were wrong

**Formula**: `(confident AND reversed) / confident_decisions`

**Why it matters**: Confident but wrong is the most dangerous failure mode

**Target guidance**:
- Critical: ≤ 1%
- Standard: ≤ 2%
- Low: ≤ 5%

### 3. Calibration (ECE)

**What**: Does stated confidence match actual accuracy?

**Formula**: Expected Calibration Error across confidence bins

**Why it matters**: An 80% confident decision should be right ~80% of the time

**Target guidance**:
- Well-calibrated: ECE < 0.10
- Acceptable: ECE < 0.15
- Needs work: ECE > 0.20

### 4. Feedback Latency

**What**: Time until decision quality is known

**Formula**: `outcome_timestamp - decision_timestamp`

**Why it matters**: If feedback takes 6 months, SLOs are meaningless

**Target guidance**:
- Ideal: < 24 hours
- Acceptable: < 7 days
- Problematic: > 30 days

## Starting Simple

Don't implement all four at once:

1. **Start with reversal_rate**: No ground truth needed, just track overrides
2. **Add HCF**: Once you have confidence scores
3. **Add calibration**: When you have enough data for statistical significance
4. **Track feedback_latency**: To understand your measurement window

## Instrumentation Requirements

You need three events:
- **Decision**: When AI makes a choice
- **Reversal**: When human overrides
- **Outcome**: When ground truth is known (if ever)

See SKILL.md for attribute schemas.
```

### reference/dependency-math.md

```markdown
# Dependency Math

## Serial Availability

When requests flow through multiple services in sequence:

```
User → A → B → C → Database

Combined availability = A × B × C × DB
```

Example:
- A: 99.9%
- B: 99.9%  
- C: 99.9%
- DB: 99.95%

Combined: 0.999 × 0.999 × 0.999 × 0.9995 = **99.65%**

You cannot promise 99.9% if your chain only delivers 99.65%.

## Parallel Availability

When any one of multiple services can handle the request:

```
Combined = 1 - (failure_A × failure_B)
```

Example with two redundant services at 99%:
```
Combined = 1 - (0.01 × 0.01) = 99.99%
```

## Critical vs Non-Critical Dependencies

**Critical**: Failure blocks your service
- Include in availability math
- Set `critical: true` in manifest

**Non-critical**: Service degrades gracefully
- Don't include in availability ceiling
- Set `critical: false` in manifest

## Practical Implications

1. **Audit your critical path**: What must succeed for you to succeed?
2. **Calculate your ceiling**: Multiply critical dependency availabilities
3. **Set achievable targets**: Your SLO ≤ calculated ceiling
4. **Identify bottlenecks**: Which dependency limits you most?

## Example Validation

```yaml
# Your manifest
spec:
  slos:
    availability:
      target: 0.9999              # Promising 99.99%
      
  dependencies:
    - service: auth-service
      type: service
      critical: true
      expects:
        availability: 0.999       # They promise 99.9%
    - service: database
      type: database
      critical: true
      expects:
        availability: 0.9999      # They promise 99.99%
```

**Problem**: 0.999 × 0.9999 = 0.9989 (99.89%)

You're promising 99.99% but can only achieve 99.89%.

**Solution**: Either:
- Lower your target to 99.89%
- Get auth-service to improve their contract
- Make auth-service non-critical (can you cache/degrade?)
```

### examples/payment-service.yaml

```yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: payment-service
  team: payments
  tier: critical
  template: api-critical
spec:
  type: api
  
  contract:
    availability: 0.9999
    latency:
      p99: 500ms
    throughput:
      max_rps: 5000
  
  slos:
    availability:
      target: 0.99995
      window: 30d
    latency:
      p99: 300ms
      target: 0.995
      window: 30d
    error_rate:
      target: 0.0001
      window: 30d
  
  dependencies:
    - service: stripe-adapter
      type: external
      critical: true
      expects:
        availability: 0.9999
        latency:
          p99: 200ms
    - service: fraud-detection
      type: service
      critical: true
      expects:
        availability: 0.999
    - service: notification-service
      type: service
      critical: false
  
  ownership:
    team: payments
    slack: "#payments-oncall"
    pagerduty:
      service_id: PAYMENTS_CRITICAL
      escalation_policy_id: PAYMENTS_ESCALATION
    runbook: https://wiki.example.com/runbooks/payment-service
    oncall_required: true
  
  observability:
    metrics:
      required:
        - payment_service_requests_total
        - payment_service_duration_seconds
      labels:
        required:
          - service
          - environment
```

### examples/code-review-bot.yaml

```yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: code-review-bot
  team: developer-experience
  tier: standard
  template: ai-gate-standard
spec:
  type: ai-gate
  
  contract:
    availability: 0.999
    latency:
      p99: 60s
    judgment:
      max_reversal_rate: 0.05
      max_hcf_rate: 0.02
  
  slos:
    availability:
      target: 0.9995
      window: 30d
    latency:
      p99: 45s
      target: 0.99
      window: 30d
    judgment:
      reversal_rate:
        target: 0.03
        window: 30d
        observation_period: 7d
      high_confidence_failure:
        target: 0.01
        confidence_threshold: 0.85
        window: 30d
      calibration:
        target: 0.12
        window: 30d
      feedback_latency:
        p50: 4h
        p90: 48h
  
  dependencies:
    - service: llm-gateway
      type: service
      critical: true
      expects:
        availability: 0.999
        latency:
          p99: 30s
    - service: github-api
      type: external
      critical: true
      expects:
        availability: 0.999
  
  ownership:
    team: developer-experience
    slack: "#dx-oncall"
    runbook: https://wiki.example.com/runbooks/code-review-bot
  
  instrumentation:
    events:
      decision: ai_gate.decision
      reversal: ai_gate.reversal
      outcome: ai_gate.outcome
    attributes:
      decision_id: ai_gate.decision_id
      confidence: ai_gate.confidence
      decision_value: ai_gate.decision
```

### examples/notification-worker.yaml

```yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: notification-worker
  team: notifications
  tier: standard
  template: worker-standard
spec:
  type: worker
  
  contract:
    availability: 0.999
    processing_time:
      p99: 2m
  
  slos:
    availability:
      target: 0.9995
      window: 7d
    processing_time:
      p99: 1m
      target: 0.99
      window: 7d
  
  dependencies:
    - service: email-provider
      type: external
      critical: false
    - service: sms-provider
      type: external
      critical: false
    - service: push-service
      type: service
      critical: false
  
  ownership:
    team: notifications
    slack: "#notifications-alerts"
```

---

## Trigger Patterns

The skill should activate when Claude Code detects:

| Pattern | Action |
|---------|--------|
| "create a new service" | Prompt for type/tier, generate manifest |
| "create an API/microservice" | Generate api-type manifest |
| "build a worker/job processor" | Generate worker-type manifest |
| "build an AI agent/bot/reviewer" | Generate ai-gate manifest with judgment SLOs |
| "add reliability to this service" | Analyze code, suggest manifest |
| "what SLOs should I use" | Explain targets based on tier |
| "check my dependencies" | Analyze and calculate availability ceiling |
| "review this for reliability" | Check manifest completeness, dependency math |
| "deploy this" / "is this safe to deploy" | Suggest nthlayer check-deploy |
| References to SLOs, error budgets, availability | Offer to generate/review manifest |
| Creating OpenTelemetry instrumentation | Suggest judgment SLO events for AI services |

---

## Installation

Place the skill folder in the Claude Code skills directory:

```
~/.claude/skills/shift-left-reliability/
├── SKILL.md
├── templates/
├── examples/
└── reference/
```

Or for project-specific installation:

```
your-project/
├── .claude/
│   └── skills/
│       └── shift-left-reliability/
├── src/
└── service.reliability.yaml
```

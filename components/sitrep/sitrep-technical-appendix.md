# Sitrep Technical Appendix v2

## Overview

This technical appendix provides implementation details for Sitrep (Observability Snapshots), an AI-native correlation layer that bridges raw telemetry and AI agent consumption. 

**Key updates in v2:**
- Hybrid generation model (batch + incident-triggered)
- Integration with Change Event Semantic Conventions
- Integration with Decision Telemetry (gen_ai.decision.*)
- Integration with Judgment SLOs (OpenSRM ai-gate)
- Service identity via OpenSRM service catalog (resolver as fallback only)

---

## The Full AI Reliability Stack

Sitrep is one layer in a complete observability-to-decision loop:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../diagrams/svg/ai-reliability-stack-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="../../diagrams/svg/ai-reliability-stack-light.svg">
  <img alt="The Full AI Reliability Stack: Change Events, Sitrep, AI Agent, Decision Telemetry, Judgment SLOs, and Feedback loop" src="../../diagrams/svg/ai-reliability-stack-light.svg">
</picture>

---

## Architecture Diagram

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../diagrams/svg/sitrep-architecture-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="../../diagrams/svg/sitrep-architecture-light.svg">
  <img alt="Sitrep architecture: Data Sources, Ingest Gateway, Message Queue, Snapshot Generator, Storage, and Consumers" src="../../diagrams/svg/sitrep-architecture-light.svg">
</picture>

---

## Hybrid Generation Model

Sitrep uses a hybrid approach to balance efficiency (batch) with responsiveness (event-triggered):

### Generation Modes

| Mode | Trigger | Interval | Use Case |
|------|---------|----------|----------|
| **Batch** | Timer | 5 minutes | Normal operations, baseline monitoring |
| **Incident** | Webhook | Immediate | Incident declared, generate fresh context |
| **Refresh** | Timer (during incident) | 1 minute | Active incident, keep context current |
| **Manual** | API call | On demand | Investigation, debugging |

### Implementation

```go
type SnapshotGenerator struct {
    batchInterval           time.Duration  // 5 minutes
    incidentRefreshInterval time.Duration  // 1 minute
    
    // Active incident tracking
    activeIncidents map[string]*IncidentContext
    
    // Components
    windowManager    *WindowManager
    stateStore       *StateStore
    correlationEngine *CorrelationEngine
    logSummarizer    *LogSummarizer
}

type IncidentContext struct {
    Incident      Incident
    LastRefresh   time.Time
    RefreshTicker *time.Ticker
    Snapshots     []string  // IDs of generated snapshots
    Done          chan struct{}
}

// Batch generation (normal operations)
func (g *SnapshotGenerator) runBatchLoop() {
    ticker := time.NewTicker(g.batchInterval)
    for range ticker.C {
        windows := g.windowManager.CloseExpiredWindows()
        for _, w := range windows {
            if snapshot := g.generateFromWindow(w); snapshot != nil {
                g.store(snapshot)
            }
        }
    }
}

// Incident-triggered generation
func (g *SnapshotGenerator) OnIncidentDeclared(incident Incident) {
    // 1. Generate immediate snapshot covering lookback window
    snapshot := g.GenerateSnapshot(GenerateOptions{
        WindowEnd:   time.Now(),
        WindowStart: time.Now().Add(-g.batchInterval),
        Scope:       incident.AffectedServices,
        Trigger:     "incident",
        IncidentID:  incident.ID,
    })
    
    g.store(snapshot)
    g.attachToIncident(incident.ID, snapshot)
    
    // 2. Start continuous refresh loop
    ctx := &IncidentContext{
        Incident:      incident,
        LastRefresh:   time.Now(),
        RefreshTicker: time.NewTicker(g.incidentRefreshInterval),
        Done:          make(chan struct{}),
    }
    g.activeIncidents[incident.ID] = ctx
    
    go g.runIncidentRefreshLoop(incident.ID)
}

func (g *SnapshotGenerator) runIncidentRefreshLoop(incidentID string) {
    ctx := g.activeIncidents[incidentID]
    
    for {
        select {
        case <-ctx.RefreshTicker.C:
            delta := g.GenerateSnapshot(GenerateOptions{
                WindowStart: ctx.LastRefresh,
                WindowEnd:   time.Now(),
                Scope:       ctx.Incident.AffectedServices,
                Trigger:     "incident_refresh",
                IncidentID:  incidentID,
                DeltaMode:   true,
            })
            
            if delta.HasSignificantChanges() {
                g.store(delta)
                g.appendToIncident(incidentID, delta)
                ctx.LastRefresh = time.Now()
            }
            
        case <-ctx.Done:
            return
        }
    }
}

func (g *SnapshotGenerator) OnIncidentResolved(incidentID string) {
    if ctx, ok := g.activeIncidents[incidentID]; ok {
        ctx.RefreshTicker.Stop()
        close(ctx.Done)
        
        // Generate final summary snapshot
        final := g.GenerateSnapshot(GenerateOptions{
            WindowStart:  ctx.Incident.DeclaredAt,
            WindowEnd:    time.Now(),
            Scope:        ctx.Incident.AffectedServices,
            Trigger:      "incident_resolved",
            IncidentID:   incidentID,
            FullSummary:  true,
        })
        g.store(final)
        g.attachToIncident(incidentID, final)
        
        delete(g.activeIncidents, incidentID)
    }
}
```

---

## Service Identity Resolution

### Ideal: OpenSRM Service Catalog

Service identity should come from the source, not be resolved at correlation time. OpenSRM ServiceManifests provide canonical identifiers:

```yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: payment-service
  
spec:
  identifiers:
    service_id: svc-payment-prod
    prometheus_job: payment
    datadog_service: payment-service-prod
    pagerduty_service_id: P1234567
    github_repo: acme/payment-service
    argocd_app: payment-prod
    
  dependencies:
    - service_id: svc-database-prod
      type: downstream
      criticality: critical
    - service_id: svc-checkout-prod
      type: upstream
      criticality: high
```

### Enforcement at Source

```yaml
# Prometheus relabel config (generated from ServiceManifest)
relabel_configs:
  - source_labels: [job]
    regex: payment
    target_label: service_id
    replacement: svc-payment-prod

# GitHub webhook enrichment (CI/CD injects service_id)
# ArgoCD annotations (include service_id)
# All systems emit canonical service_id
```

### Resolver as Fallback Only

```go
type ServiceResolver struct {
    catalog map[string]*ServiceManifest  // Loaded from OpenSRM
}

func (r *ServiceResolver) GetServiceID(labels map[string]string) (string, error) {
    // Ideal path: service_id already present
    if id := labels["service_id"]; id != "" {
        return id, nil
    }
    
    // Fallback: resolve from other labels (log warning)
    log.Warn("event missing service_id, falling back to resolver",
        "labels", labels)
    
    // Try prometheus job
    if job := labels["job"]; job != "" {
        for _, svc := range r.catalog {
            if svc.Spec.Identifiers.PrometheusJob == job {
                return svc.Spec.Identifiers.ServiceID, nil
            }
        }
    }
    
    // Try other identifiers...
    
    return "", ErrUnknownService
}
```

---

## Correlation Algorithms

### Temporal Correlation

**Principle:** Causes precede effects. Changes close in time to anomalies are more likely causal.

```go
func TemporalCorrelation(anomaly Anomaly, change Change, config Config) float64 {
    lag := anomaly.StartedAt.Sub(change.Timestamp)
    
    // Rule 1: Change must precede anomaly
    if lag < 0 {
        return 0.0
    }
    
    // Rule 2: Must be within lookback window
    if lag > config.MaxLookback {  // e.g., 30 minutes
        return 0.0
    }
    
    // Rule 3: Exponential decay
    // halfLife of 10 minutes means:
    //   - 0 minutes lag  → score = 1.0
    //   - 10 minutes lag → score = 0.5
    //   - 20 minutes lag → score = 0.25
    halfLife := config.HalfLife.Seconds()
    lambda := math.Ln2 / halfLife
    confidence := math.Exp(-lambda * lag.Seconds())
    
    return confidence
}
```

### Topological Correlation

**Principle:** Changes to upstream services can cause downstream anomalies. Dependency distance affects confidence.

```go
func TopologicalCorrelation(
    changeService, anomalyService string,
    topology *DependencyGraph,
    config Config,
) float64 {
    // Same service = highest relevance
    if changeService == anomalyService {
        return 1.0
    }
    
    // Find path in dependency graph
    path := topology.ShortestPath(changeService, anomalyService)
    if path == nil {
        return 0.1  // No relationship, but could still be coincidence
    }
    
    distance := len(path) - 1
    isUpstream := topology.IsUpstream(changeService, anomalyService)
    
    if !isUpstream {
        // Downstream change affecting upstream = less likely causal
        return 0.2 / float64(distance)
    }
    
    // Upstream change affecting downstream
    baseScore := 1.0 / float64(distance)
    
    // Boost if on critical path
    if topology.IsCriticalPath(changeService, anomalyService) {
        baseScore *= config.CriticalPathBoost  // e.g., 1.5
    }
    
    return math.Min(baseScore, 1.0)
}
```

### Combined Scoring

```go
func (e *CorrelationEngine) Correlate(anomaly Anomaly, change Change) Correlation {
    temporal := TemporalCorrelation(anomaly, change, e.config)
    topological := TopologicalCorrelation(
        change.ServiceID, anomaly.ServiceID,
        e.stateStore.Topology, e.config,
    )
    
    // Geometric mean: both factors must be non-trivial
    confidence := 0.0
    if temporal > 0 && topological > 0 {
        confidence = math.Sqrt(temporal * topological)
    }
    
    return Correlation{
        Source: CorrelationEndpoint{
            Type: "change",
            ID:   change.ID,
        },
        Target: CorrelationEndpoint{
            Type: "anomaly",
            ID:   anomaly.ID,
        },
        Confidence: confidence,
        Evidence: Evidence{
            TemporalLag:         anomaly.StartedAt.Sub(change.Timestamp),
            TemporalScore:       temporal,
            TopologicalDistance: e.stateStore.Topology.Distance(change.ServiceID, anomaly.ServiceID),
            TopologicalScore:    topological,
            IsUpstream:          e.stateStore.Topology.IsUpstream(change.ServiceID, anomaly.ServiceID),
        },
    }
}
```

---

## Snapshot Schema v2

```yaml
apiVersion: o11y.dev/v1
kind: Snapshot
metadata:
  id: snap-abc123
  
  # Time window covered
  window:
    start: "2026-02-20T14:25:00Z"
    end: "2026-02-20T14:30:00Z"
    
  # Generation metadata
  generation:
    trigger: batch | incident | incident_refresh | manual
    timestamp: "2026-02-20T14:30:05Z"
    generator_version: "1.0.0"
    
    # If incident-triggered
    incident_id: inc-xyz789
    
    # If delta update
    delta_of: snap-prev123
    
  # Severity assessment
  severity: info | low | medium | high | critical
  
spec:
  # Scope: what services/infrastructure this covers
  scope:
    services:
      - service_id: svc-payment-prod
        name: payment-service
      - service_id: svc-checkout-prod
        name: checkout-service
    cluster: prod-us-east-1
    environment: production
    
    # Topology snapshot (for blast radius)
    topology:
      nodes:
        - id: svc-payment-prod
          type: service
        - id: svc-checkout-prod
          type: service
        - id: svc-database-prod
          type: database
      edges:
        - from: svc-checkout-prod
          to: svc-payment-prod
          type: calls
        - from: svc-payment-prod
          to: svc-database-prod
          type: queries

  # Detected anomalies
  anomalies:
    - id: anom-001
      service_id: svc-payment-prod
      metric: error_rate
      started_at: "2026-02-20T14:27:30Z"
      baseline:
        mean: 0.001
        stddev: 0.0005
        window: 7d
      current:
        value: 0.052
        deviation_sigma: 102.0
      severity: critical

  # Fired alerts
  alerts:
    - id: alert-001
      service_id: svc-payment-prod
      alertname: PaymentHighErrorRate
      severity: critical
      fired_at: "2026-02-20T14:28:30Z"
      labels:
        job: payment
        cluster: prod-us-east-1
      annotations:
        summary: "Error rate is 5.2%"

  # Recent changes (within lookback window)
  changes:
    - id: chg-deploy-001
      type: deployment
      service_id: svc-payment-prod
      timestamp: "2026-02-20T14:25:00Z"
      
      # Change event attributes (OTel semantic conventions)
      change.version: v2.3.1
      change.previous_version: v2.3.0
      change.actor.type: automation
      change.actor.id: argocd
      change.risk.level: low
      
      details:
        commit: abc123def
        author: alice@example.com
        message: "Fix connection timeout handling"
        
    - id: chg-config-001
      type: configuration
      service_id: svc-payment-prod
      timestamp: "2026-02-20T14:24:30Z"
      
      change.key: db.pool.timeout_ms
      change.old_value: "5000"
      change.new_value: "1000"
      change.actor.type: human
      change.actor.id: bob@example.com

  # Log summary (not raw logs)
  logs_summary:
    svc-payment-prod:
      window:
        start: "2026-02-20T14:25:00Z"
        end: "2026-02-20T14:30:00Z"
      total_count: 45000
      error_count: 3241
      unique_patterns: 12
      top_patterns:
        - pattern: "Connection timeout after {timeout_ms}ms"
          count: 2847
          severity: error
          first_seen: "2026-02-20T14:27:32Z"
          last_seen: "2026-02-20T14:29:58Z"
          sample_values:
            timeout_ms: ["1000"]
        - pattern: "Database pool exhausted, {active}/{max} connections"
          count: 394
          severity: error
          sample_values:
            active: ["50"]
            max: ["50"]

  # Pre-computed correlations
  correlations:
    - id: corr-001
      type: change_to_anomaly
      
      source:
        type: change
        id: chg-config-001
        description: "Config change db.pool.timeout_ms: 5000 → 1000"
        
      target:
        type: anomaly
        id: anom-001
        description: "payment-service error_rate 102σ deviation"
        
      confidence: 0.89
      
      evidence:
        temporal:
          lag: 3m0s
          score: 0.81
        topological:
          distance: 0
          is_upstream: true
          score: 1.0
        textual:
          log_pattern_match: true
          pattern: "Connection timeout after 1000ms"
          boost: 0.1
          
    - id: corr-002
      type: change_to_anomaly
      
      source:
        type: change
        id: chg-deploy-001
        description: "Deploy payment-service v2.3.0 → v2.3.1"
        
      target:
        type: anomaly
        id: anom-001
        
      confidence: 0.72
      
      evidence:
        temporal:
          lag: 2m30s
          score: 0.84
        topological:
          distance: 0
          is_upstream: true
          score: 1.0

  # Context for AI agent
  context:
    # Similar past situations
    similar_snapshots:
      - id: snap-hist-001
        timestamp: "2026-01-15T09:00:00Z"
        similarity: 0.87
        outcome: "Resolved by rolling back config change"
        resolution_time: 12m
        
    # Relevant runbooks
    runbook_refs:
      - id: rb-payment-errors
        title: "Payment Service Error Runbook"
        url: "https://wiki.example.com/runbooks/payment-errors"
        
    # On-call context
    on_call:
      service_id: svc-payment-prod
      current:
        name: "Alice Smith"
        contact: "#payment-oncall"
```

---

## Integration: Change Event Semantic Conventions

Sitrep consumes change events following the proposed OTel semantic conventions:

### Change Event Schema (Input)

```yaml
# OTel Change Event (as received by Sitrep)
name: change
timestamp: "2026-02-20T14:25:00Z"
attributes:
  # Required
  change.id: chg-deploy-001
  change.type: deployment
  change.timestamp: "2026-02-20T14:25:00Z"
  
  # Scope (for correlation)
  change.scope.service: svc-payment-prod
  change.scope.environment: production
  change.scope.cluster: prod-us-east-1
  
  # Actor
  change.actor.type: automation
  change.actor.id: argocd
  
  # Risk
  change.risk.level: low
  change.reversible: true
  
  # Type-specific
  deployment.version: v2.3.1
  deployment.previous_version: v2.3.0
  deployment.commit: abc123def
```

### Ingestion

```go
func (i *ChangeIngester) ProcessChangeEvent(event OTelEvent) (*Change, error) {
    // Extract standard attributes
    change := &Change{
        ID:        event.Attributes["change.id"],
        Type:      event.Attributes["change.type"],
        Timestamp: event.Timestamp,
        ServiceID: event.Attributes["change.scope.service"],
        
        Actor: Actor{
            Type: event.Attributes["change.actor.type"],
            ID:   event.Attributes["change.actor.id"],
        },
        
        Risk: Risk{
            Level:      event.Attributes["change.risk.level"],
            Reversible: event.Attributes["change.reversible"] == "true",
        },
    }
    
    // Extract type-specific details
    switch change.Type {
    case "deployment":
        change.Details = extractDeploymentDetails(event.Attributes)
    case "configuration":
        change.Details = extractConfigDetails(event.Attributes)
    case "feature_flag":
        change.Details = extractFeatureFlagDetails(event.Attributes)
    }
    
    return change, nil
}
```

---

## Integration: Decision Telemetry

Sitrep snapshots are linked to AI agent decisions for quality tracking:

### Decision Event (Output from AI Agent)

```yaml
# OTel Decision Event (emitted by AI agent after consuming snapshot)
name: gen_ai.decision
timestamp: "2026-02-20T14:35:00Z"
attributes:
  # Decision identity
  gen_ai.decision.id: dec-resp-001
  gen_ai.decision.value: rollback
  gen_ai.decision.confidence: 0.82
  gen_ai.decision.gate_type: incident_response
  
  # Link to snapshot that informed this decision
  o11y.snapshot.id: snap-abc123
  o11y.snapshot.correlation_id: corr-001  # Which correlation was acted on
  
  # Agent context
  gen_ai.request.model: claude-3-opus
  gen_ai.agent.id: incident-commander
```

### Reversal Event (Human Override)

```yaml
name: gen_ai.reversal
timestamp: "2026-02-20T14:40:00Z"
attributes:
  gen_ai.decision.id: dec-resp-001
  gen_ai.reversal.type: human_override
  gen_ai.reversal.actor_type: human
  gen_ai.reversal.actor: alice@example.com
  gen_ai.reversal.new_value: increase_pool_size
  gen_ai.reversal.reason: "Rollback too disruptive during peak hours"
```

### Outcome Event (Ground Truth)

```yaml
name: gen_ai.outcome
timestamp: "2026-02-20T14:55:00Z"
attributes:
  gen_ai.decision.id: dec-resp-001
  gen_ai.outcome.value: incorrect  # Human override was correct
  gen_ai.outcome.source: incident_resolution
  
  # Link back to correlation
  o11y.snapshot.id: snap-abc123
  o11y.correlation.id: corr-001
  o11y.correlation.was_causal: true  # Confirmed causal
```

### Feedback Loop

```go
// When outcome is known, update correlation confidence calibration
func (e *CorrelationEngine) ProcessOutcome(outcome OutcomeEvent) {
    snapshot := e.store.GetSnapshot(outcome.SnapshotID)
    correlation := snapshot.GetCorrelation(outcome.CorrelationID)
    
    // Track calibration: was confidence accurate?
    e.calibration.Record(CalibrationSample{
        CorrelationType: correlation.Type,
        PredictedConfidence: correlation.Confidence,
        ActualOutcome:       outcome.WasCorrect,
    })
    
    // Adjust weights if systematic miscalibration detected
    if e.calibration.ECE() > 0.15 {
        e.recalibrateWeights()
    }
}
```

---

## Integration: Judgment SLOs

Sitrep enables judgment SLO measurement for AI agents:

### OpenSRM ai-gate Spec

```yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: incident-commander-agent

spec:
  type: ai-gate
  
  slos:
    # Traditional operational SLOs
    availability:
      target: 0.999
      window: 30d
    latency:
      p99: 30s
      target: 0.99
      
    # Judgment SLOs
    judgment:
      reversal_rate:
        target: 0.05  # <5% of decisions reversed by humans
        window: 30d
        observation_period: 24h
        
      high_confidence_failure:
        target: 0.02  # <2% of high-confidence decisions wrong
        window: 30d
        confidence_threshold: 0.9
        
      calibration:
        target: 0.15  # ECE < 0.15
        window: 30d
        
      # Proactive audit (not just reactive reversal)
      audit:
        sample_rate: 0.10
        accuracy:
          target: 0.95
          window: 30d
        coverage:
          target: 0.90
          window: 7d
          
  instrumentation:
    events:
      decision: gen_ai.decision
      reversal: gen_ai.reversal
      outcome: gen_ai.outcome
      snapshot: o11y.snapshot
```

### Metrics Derivation

```promql
# Reversal rate
sum(rate(gen_ai_reversals_total{gate_type="incident_response"}[30d])) 
/ 
sum(rate(gen_ai_decisions_total{gate_type="incident_response"}[30d]))

# High-confidence failure rate
sum(rate(gen_ai_reversals_total{confidence_bucket=">0.9"}[30d])) 
/ 
sum(rate(gen_ai_decisions_total{confidence_bucket=">0.9"}[30d]))

# Correlation accuracy (requires outcome events)
sum(rate(o11y_correlations_confirmed_total[30d])) 
/ 
sum(rate(o11y_correlations_acted_on_total[30d]))
```

---

## ClickHouse Schema

```sql
-- Snapshots table
CREATE TABLE snapshots (
    id String,
    window_start DateTime64(3),
    window_end DateTime64(3),
    generation_trigger Enum8('batch'=0, 'incident'=1, 'incident_refresh'=2, 'manual'=3),
    generation_timestamp DateTime64(3),
    incident_id Nullable(String),
    delta_of Nullable(String),
    severity Enum8('info'=0, 'low'=1, 'medium'=2, 'high'=3, 'critical'=4),
    services Array(String),
    cluster String,
    environment String,
    anomaly_count UInt32,
    alert_count UInt32,
    change_count UInt32,
    correlation_count UInt32,
    top_correlation_confidence Float32,
    snapshot_json String,  -- Full JSON for AI consumption
    
    INDEX idx_services services TYPE bloom_filter GRANULARITY 4,
    INDEX idx_incident incident_id TYPE bloom_filter GRANULARITY 4
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(window_start)
ORDER BY (cluster, window_start, id)
TTL window_start + INTERVAL 90 DAY;

-- Correlations table (for analysis)
CREATE TABLE correlations (
    snapshot_id String,
    correlation_id String,
    window_start DateTime64(3),
    source_type String,
    source_id String,
    target_type String,
    target_id String,
    confidence Float32,
    temporal_lag_seconds Float32,
    temporal_score Float32,
    topological_distance Int32,
    topological_score Float32,
    
    -- Outcome tracking (populated later)
    decision_id Nullable(String),
    was_acted_on Bool DEFAULT false,
    was_correct Nullable(Bool),
    outcome_source Nullable(String),
    
    INDEX idx_snapshot snapshot_id TYPE bloom_filter GRANULARITY 4
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(window_start)
ORDER BY (snapshot_id, correlation_id);

-- Embeddings for similarity search
CREATE TABLE snapshot_embeddings (
    snapshot_id String,
    embedding Array(Float32),
    cluster String,
    services Array(String),
    primary_anomaly_type String,
    
    INDEX idx_embedding embedding TYPE annoy GRANULARITY 100
) ENGINE = MergeTree()
ORDER BY (cluster, snapshot_id);
```

---

## API Design

### REST API

```
GET  /api/v1/snapshots
     ?severity=critical
     &services=svc-payment-prod,svc-checkout-prod
     &from=2026-02-20T14:00:00Z
     &to=2026-02-20T15:00:00Z
     &trigger=incident
     &incident_id=inc-xyz789

GET  /api/v1/snapshots/{id}

GET  /api/v1/snapshots/{id}/correlations
     ?min_confidence=0.7
     &type=change_to_anomaly

POST /api/v1/snapshots/{id}/feedback
     {
       "correlation_id": "corr-001",
       "was_correct": true,
       "feedback_source": "incident_resolution"
     }

GET  /api/v1/snapshots/similar
     ?snapshot_id=snap-abc123
     &limit=5

POST /api/v1/snapshots/generate
     {
       "window_start": "2026-02-20T14:00:00Z",
       "window_end": "2026-02-20T14:30:00Z",
       "scope": {
         "services": ["svc-payment-prod"],
         "cluster": "prod-us-east-1"
       },
       "trigger": "manual"
     }
```

### Streaming API

```
# Server-Sent Events for real-time snapshots
GET /api/v1/snapshots/stream
    ?severity=high,critical
    &services=svc-payment-prod

# WebSocket for bidirectional
WS /api/v1/snapshots/ws
```

### Mayday Integration

```python
# Mayday polls for snapshots related to active incidents
class SnapshotConsumer:
    def __init__(self, sitrep_url: str):
        self.url = sitrep_url
        
    async def get_incident_context(self, incident_id: str) -> Snapshot:
        """Get all snapshots for an incident, merged into single context."""
        response = await self.client.get(
            f"{self.url}/api/v1/snapshots",
            params={"incident_id": incident_id, "merge": "true"}
        )
        return Snapshot.from_json(response.json())
        
    async def subscribe_to_incident(self, incident_id: str):
        """Stream snapshot updates for active incident."""
        async with self.client.stream(
            f"{self.url}/api/v1/snapshots/stream",
            params={"incident_id": incident_id}
        ) as stream:
            async for event in stream:
                yield Snapshot.from_json(event)
```

---

## Self-Observability

Sitrep emits metrics about its own operation:

```promql
# Ingest metrics
sitrep_events_received_total{source, event_type}
sitrep_events_processed_total{source, event_type}
sitrep_events_dropped_total{source, reason}

# Generation metrics
sitrep_snapshots_generated_total{cluster, trigger, severity}
sitrep_snapshot_generation_duration_seconds{cluster, trigger}
sitrep_correlations_computed_total{correlation_type}

# Correlation quality
sitrep_correlation_confidence_histogram{correlation_type}
sitrep_correlations_with_feedback_total{correlation_type, was_correct}
sitrep_calibration_ece{correlation_type}

# Active incidents
sitrep_active_incidents{cluster}
sitrep_incident_refresh_total{incident_id}

# Storage
sitrep_snapshots_stored_total{cluster}
sitrep_storage_bytes{table}
```

---

## Deployment

### Docker Compose (Development)

```yaml
version: '3.8'
services:
  sitrep:
    image: sitrep:latest
    ports:
      - "8080:8080"
    environment:
      - KAFKA_BROKERS=kafka:9092
      - CLICKHOUSE_URL=clickhouse:9000
      - POSTGRES_URL=postgres://user:pass@postgres:5432/sitrep
    depends_on:
      - kafka
      - clickhouse
      - postgres

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    ports:
      - "9092:9092"

  clickhouse:
    image: clickhouse/clickhouse-server:23.8
    ports:
      - "9000:9000"
      - "8123:8123"

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: sitrep
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
```

### Kubernetes (Production)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sitrep
spec:
  replicas: 3
  selector:
    matchLabels:
      app: sitrep
  template:
    metadata:
      labels:
        app: sitrep
    spec:
      containers:
        - name: sitrep
          image: sitrep:latest
          ports:
            - containerPort: 8080
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "2000m"
          env:
            - name: KAFKA_BROKERS
              valueFrom:
                secretKeyRef:
                  name: sitrep-secrets
                  key: kafka-brokers
```

---

## Implementation Phases

### Phase 1: Specification (Weeks 1-4)
- Finalize snapshot schema
- Write OTel semantic convention proposals (change events, decision telemetry)
- Publish spec on GitHub
- Blog post: "Why AI Agents Need a New Observability Primitive"

### Phase 2: MVP (Weeks 5-12)
- Snapshot generator in Go
- Ingest: Prometheus, GitHub webhooks, Alertmanager
- Temporal correlation only (defer topological)
- ClickHouse storage
- REST API

### Phase 3: Integration (Weeks 13-20)
- Hybrid generation (batch + incident-triggered)
- OpenSRM integration for topology
- Decision telemetry integration
- Mayday consumer
- Keep extension

### Phase 4: Quality (Weeks 21-28)
- Feedback loop implementation
- Calibration metrics
- Judgment SLO dashboards
- Vector similarity for historical lookup

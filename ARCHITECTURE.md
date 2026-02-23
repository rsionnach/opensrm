# Architecture

This document describes the OpenSRM ecosystem architecture: how the specification, tools, agents, and semantic conventions work together to form a complete reliability stack.

---

## Design Principles

### 1. Schemas + Enforcement

Every component is defined by a specification first. Implementation follows. This enables multiple implementations of the same spec, clear contracts between components, and validation at boundaries.

### 2. Shift-Left Reliability

Reliability concerns move earlier in the lifecycle. Service manifests define SLOs before deployment. CI/CD gates enforce contracts. Decision quality is measured, not assumed.

### 3. Operator-Agnostic

The stack supports both human and AI operators. Sitrep snapshots work for dashboards (human) and LLMs (AI). Judgment SLOs measure decision quality regardless of decision-maker. Decision telemetry captures human and AI decisions equally.

### 4. Open Standards

Extend existing standards (OTel) rather than invent new ones. This enables ecosystem adoption and avoids vendor lock-in.

### 5. Reasoning Boundary

Agent capabilities are reserved for components that require interpretation of ambiguous inputs. Deterministic operations (validation, generation, arithmetic) remain as tools that agents invoke. This ensures the system degrades gracefully without AI, that agents can be measured and governed, and that complexity is proportional to the reasoning required. If a component doesn't need to reason, it isn't an agent.

---

## Component Taxonomy

Every component in the ecosystem falls into one of three categories based on its execution model. This distinction is architectural, not cosmetic: it determines how the component is built, deployed, tested, and monitored.

```
┌─────────────────────────────────────────────────────────────────────┐
│                       COMPONENT TAXONOMY                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  DATA SOURCES (static, queryable, no reasoning)                     │
│  ├── OpenSRM Manifests           YAML in Git, source of truth       │
│  ├── Prometheus/OTel metrics     Time-series, queryable             │
│  └── Change event logs           Deployment, config, flag history   │
│                                                                      │
│  TOOLS (deterministic, invocable, no reasoning)                     │
│  ├── NthLayer compiler           Manifest in, artifacts out         │
│  ├── Schema validator            YAML in, pass/fail out             │
│  └── Dependency math engine      Targets in, ceiling out            │
│                                                                      │
│  AGENTS (reasoning, adaptive, judgment required)                    │
│  ├── Sitrep                      Continuous correlation             │
│  ├── IncidentTown Triage         Severity and blast radius          │
│  ├── IncidentTown Investigation  Root cause analysis                │
│  ├── IncidentTown Communication  Stakeholder updates                │
│  ├── IncidentTown Remediation    Fix suggestion and validation      │
│  └── Reliability Governor        Judgment SLO enforcement           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**The test:** Does this component need to reason about ambiguous inputs to produce its output? If yes, it's an agent. If it does the same thing every time given the same input, it's a tool. If it's queryable state that other things read, it's a data source.

**Why this matters:** The data and tool layers work without any AI in the stack. Teams can adopt OpenSRM manifests and NthLayer today with zero agents and still get validated manifests, generated monitoring, and dependency math. The agent layer is additive, not foundational. The system degrades gracefully if an agent fails.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          OPENSRM ECOSYSTEM                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║                STATIC LAYER (Data + Tools)                        ║  │
│  ║                                                                   ║  │
│  ║  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  ║  │
│  ║  │    OpenSRM       │  │    NthLayer      │  │   Generated   │  ║  │
│  ║  │    Manifests     │─▶│    Compiler      │─▶│   Artifacts   │  ║  │
│  ║  │                  │  │                  │  │               │  ║  │
│  ║  │  • Identity      │  │  • Validate      │  │  • Prom rules │  ║  │
│  ║  │  • SLO targets   │  │  • Generate      │  │  • Grafana    │  ║  │
│  ║  │  • Dependencies  │  │  • Check-deploy  │  │  • PagerDuty  │  ║  │
│  ║  │  • Contracts     │  │  • Dep math      │  │  • Topology   │  ║  │
│  ║  │  • AI gates      │  │  • Topology      │  │  • OpenSLO    │  ║  │
│  ║  └──────────────────┘  └──────────────────┘  └───────────────┘  ║  │
│  ║                                                                   ║  │
│  ║  Execution: on-demand (CLI) or CI/CD pipeline                    ║  │
│  ║  No long-running processes. Fully deterministic.                  ║  │
│  ╚══════════════╤════════════════════╤═══════════════════════════════╝  │
│                 │ topology,          │ tool calls                        │
│                 │ contracts,         │ (validate, generate,              │
│                 │ SLO context        │  topology export)                 │
│                 ▼                    ▼                                    │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║                AGENT LAYER (Reasoning)                            ║  │
│  ║                                                                   ║  │
│  ║  ┌──────────────────┐            ┌────────────────────────────┐  ║  │
│  ║  │  Sitrep Agent    │  snapshot  │      IncidentTown Agents   │  ║  │
│  ║  │                  │───────────▶│                            │  ║  │
│  ║  │  Observe:        │            │  ┌──────────────────────┐  │  ║  │
│  ║  │  • metrics       │            │  │ Triage               │  │  ║  │
│  ║  │  • alerts        │            │  │ Investigation        │  │  ║  │
│  ║  │  • changes       │            │  │ Communication        │  │  ║  │
│  ║  │  • topology      │            │  │ Remediation          │  │  ║  │
│  ║  │                  │            │  └──────────────────────┘  │  ║  │
│  ║  │  Reason:         │            │                            │  ║  │
│  ║  │  • correlate     │            │  Shared: incident context  │  ║  │
│  ║  │  • assess        │            │  Orchestration: pipeline   │  ║  │
│  ║  │  • prioritise    │            └────────────────────────────┘  ║  │
│  ║  └──────────────────┘                        ▲                   ║  │
│  ║           ▲                                  │                   ║  │
│  ║           │             ┌──────────────────┐ │                   ║  │
│  ║           │             │    Reliability   │ │                   ║  │
│  ║           └─────────────│    Governor      │─┘                   ║  │
│  ║     judgment SLO        │                  │  autonomy           ║  │
│  ║     metrics             │  Watches:        │  adjustments        ║  │
│  ║                         │  • reversal rate │                     ║  │
│  ║                         │  • error budgets │                     ║  │
│  ║                         │  • calibration   │                     ║  │
│  ║                         └──────────────────┘                     ║  │
│  ║                                                                   ║  │
│  ║  Execution: long-running processes. Stateful. Non-deterministic. ║  │
│  ║  Every agent decision emits OTel telemetry.                       ║  │
│  ╚══════════════════════════════╤════════════════════════════════════╝  │
│                                 │ decision + reversal events            │
│                                 ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                  SEMANTIC CONVENTIONS (OTel)                        │  │
│  │                                                                     │  │
│  │  ┌────────────────┐  ┌────────────────────┐  ┌────────────────┐   │  │
│  │  │ Change Events  │  │ Decision Telemetry │  │ Outcomes       │   │  │
│  │  │ change.id      │  │ gen_ai.decision.*  │  │ gen_ai.outcome │   │  │
│  │  │ change.type    │  │ gen_ai.override.*  │  │                │   │  │
│  │  │ change.scope.* │  │                    │  │                │   │  │
│  │  └────────────────┘  └────────────────────┘  └────────────────┘   │  │
│  │                                                                     │  │
│  │  Transport: OTel Events | Storage: Any OTel-compatible backend     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details: Data Sources

### OpenSRM Manifests

**Category:** Data source

**Purpose:** Define what "reliable" means for a service. The single source of truth for service identity, SLO targets, ownership, dependencies, contracts, and AI gate specifications.

**Inputs:** None (source of truth)

**Outputs:** YAML manifests consumed by tools and agents, JSON Schema for validation

**Key design decisions:**
- Kubernetes-style structure (apiVersion, kind, metadata, spec)
- Supports inheritance via templates
- Extensible via annotations
- `type: ai-gate` extension for AI decision-making services
- Dependency declarations enable cross-service math

**Why it's not an agent:** Manifests are static declarations stored in Git. They don't interpret, adapt, or reason. Tools read them; agents query them. Nothing about serving structured data requires intelligence.

---

## Component Details: Tools

### NthLayer (Compiler)

**Category:** Tool

**Purpose:** Turn specifications into operational reality. Given the same manifest, it produces the same artifacts every time.

**Inputs:**
- OpenSRM manifests
- Prometheus endpoint (for drift detection and verification)
- Optional: Backstage catalog, Istio service mesh

**Outputs:**
- Prometheus recording and alerting rules (including judgment SLO rules for `type: ai-gate`)
- Grafana dashboards (including agent decision quality dashboards)
- PagerDuty service configurations
- OpenSLO specifications
- Topology graph (consumed by Sitrep agent)
- CI/CD gate exit codes

**Key interfaces:**
```
nthlayer validate <manifest>           # Validate against schema + dependency math
nthlayer generate <manifest> -o <dir>  # Generate all artifacts
nthlayer check-deploy <manifest>       # CI/CD deployment gate
nthlayer topology export <manifest>    # Export topology for Sitrep
nthlayer verify <manifest>             # Verify declared metrics exist in Prometheus
nthlayer portfolio                     # Org-wide SLO health view
```

**Why it's not an agent:** Validation is schema checking. Generation is template expansion. Dependency math is arithmetic. Deployment gating is a threshold comparison. All of these are deterministic. Agents call NthLayer as a tool when they need topology data or artifact regeneration.

---

## Component Details: Agents

### Sitrep (Correlation Agent)

**Category:** Agent

**Purpose:** Continuously observe operational telemetry and produce pre-correlated situation assessments. Sitrep doesn't just aggregate data: it interprets context, weighs signals against topology, and makes judgment calls about what matters right now.

**Why it's an agent:** Correlation is inherently a reasoning task. "A deployment happened 12 minutes ago to auth-service, and now checkout-service latency is spiking, and these two services share a critical dependency path": connecting those dots requires understanding topology, temporal proximity, and causal plausibility. Different situations demand different correlation strategies. This is interpretation, not aggregation.

**Inputs:**
- Metrics (Prometheus remote write)
- Alerts (Alertmanager webhook)
- Changes (GitHub, ArgoCD, LaunchDarkly webhooks)
- Logs (OTLP)
- Topology (from NthLayer, via tool call)

**Outputs:**
- JSON snapshots via REST API
- Streaming updates via SSE/WebSocket
- Stored snapshots in ClickHouse

**Reasoning loop:**
```
Observe --> Correlate --> Assess --> Publish
  │            │            │          │
  │ ingest     │ temporal,  │ rank by  │ snapshot
  │ signals    │ topological│ severity,│ to API
  │            │ causal     │ relevance│ + stream
  │            │            │          │
  └────────────┴────────────┴──────────┘
              continuous cycle
```

**Agent states:**

| State | Trigger | Behaviour |
|-------|---------|-----------|
| WATCHING | Normal operations | Background correlation, 5-minute snapshot cycle |
| ALERT | Elevated signal detected | Increased correlation frequency, broader signal ingestion |
| INCIDENT | Incident declared via webhook | Continuous reassessment, 1-minute snapshots, pushes to IncidentTown |
| DEGRADED | Own judgment SLO metrics below threshold | Conservative mode, reduced confidence in correlations, flags for human review |

**Tools Sitrep calls:**
- NthLayer topology export (deterministic: get service graph)
- Prometheus queries (deterministic: get metric values)
- Log search (deterministic: retrieve matching entries)

**Judgment SLOs for Sitrep itself:**
- Correlation accuracy: what percentage of Sitrep's "related change" assessments do humans agree with?
- False positive rate: how often does Sitrep flag a change as incident-related when it isn't?

**Decision telemetry:** Every correlation assessment emits a `gen_ai.decision.*` event. When a human disagrees with a correlation, that emits a `gen_ai.override.*` event. These feed Sitrep's own judgment SLO.

---

### IncidentTown (Incident Response Agents)

**Category:** Agents (multiple, collaborating)

**Purpose:** When an incident fires, specialised agents collaborate to triage, investigate, communicate, and remediate. Each agent has a clear domain, defined decision authority, and its own judgment SLO.

**Why these are agents:** No two incidents are the same. Triage requires interpreting ambiguous signals under pressure. Investigation requires forming hypotheses and adapting approach based on evidence. Communication requires audience-aware judgment. Remediation requires risk assessment. These are reasoning-heavy, context-dependent tasks.

**Orchestration model:** Pipeline with parallel branches. Triage runs first, then Investigation and Communication run in parallel, then Remediation. All agents share an incident context object that accumulates findings.

```
Incident Declared
       │
       ▼
┌──────────────┐
│    Triage    │  severity, blast radius, initial assignment
└──────┬───────┘
       │
       ├───────────────────────┐
       ▼                       ▼
┌──────────────┐       ┌──────────────┐
│Investigation │       │Communication │  initial stakeholder notification
└──────┬───────┘       └──────┬───────┘
       │                       │
       │ root cause found      │
       ├───────────────────────┤
       ▼                       ▼
┌──────────────┐       ┌──────────────┐
│ Remediation  │       │Communication │  update with root cause + fix
└──────────────┘       └──────────────┘
```

**Shared incident context:**

All IncidentTown agents read from and write to a shared incident context object. This is the accumulating record of what is known about the incident.

```yaml
incident_context:
  id: INC-2026-0142
  declared_at: "2026-02-23T14:32:00Z"
  source: pagerduty
  
  triage:
    severity: P1
    blast_radius: [checkout-service, payment-gateway]
    affected_slos: [checkout-availability, payment-latency-p99]
    assigned_teams: [platform-checkout, platform-payments]
  
  investigation:
    hypotheses:
      - id: H1
        description: "auth-service deployment at 14:28 introduced latency regression"
        confidence: 0.82
        evidence: [sitrep-correlation-id-847, metric-auth-p99-spike]
      - id: H2
        description: "database connection pool exhaustion"
        confidence: 0.34
        evidence: [log-pattern-conn-timeout]
    root_cause: H1  # set when confidence threshold met
  
  communication:
    updates_sent:
      - channel: "#platform-incidents"
        timestamp: "2026-02-23T14:33:12Z"
        type: initial_notification
      - channel: status_page
        timestamp: "2026-02-23T14:35:00Z"
        type: investigating
  
  remediation:
    proposed_action: rollback_deployment
    target: auth-service
    deployment_id: deploy-auth-v2.4.1
    risk_assessment: low  # rollback to known-good version
    requires_human_approval: false  # pre-approved safe action
    executed_at: null
```

#### Triage Agent

**Inputs:** Sitrep snapshot, OpenSRM topology, active SLO status from Prometheus

**Reasoning:** Severity classification based on blast radius and SLO impact. Determines which services are affected, which teams own them, and how urgent the response needs to be. Weighs competing signals when severity is ambiguous.

**Tools it calls:** NthLayer topology export (dependency graph lookup), PagerDuty API (incident creation, team paging)

**Decision authority:** Can set severity. Can page teams. Can assign ownership. Cannot remediate. Cannot override existing incident classification without human approval.

**Judgment SLO:** What percentage of severity classifications do humans override? Target: less than 10% reversal rate on severity assignments.

#### Investigation Agent

**Inputs:** Sitrep snapshot, triage output from incident context, historical incident data, service topology

**Reasoning:** Hypothesis generation from correlated signals. Evidence gathering from metrics, logs, and change history. Root cause ranking by confidence. Adapts investigation strategy based on what evidence reveals: follows the data, not a fixed checklist.

**Tools it calls:** Prometheus queries (metric retrieval), log search APIs, NthLayer topology export (dependency paths), deployment history lookup (via Git/ArgoCD APIs)

**Decision authority:** Can form and rank hypotheses. Can declare root cause when confidence exceeds threshold. Cannot execute any remediation. Publishes findings to incident context for other agents.

**Judgment SLO:** How often does the identified root cause match the actual root cause confirmed in post-incident review? Target: 70% agreement at Level 3 maturity.

#### Communication Agent

**Inputs:** Triage output, investigation output, stakeholder map from OpenSRM ownership fields

**Reasoning:** Audience-appropriate messaging. Selects communication channels based on severity and stakeholder type. Decides appropriate level of detail for each audience. Determines update timing: too frequent is noise, too infrequent loses trust.

**Tools it calls:** Slack API, status page API, email API

**Decision authority:** Can draft and send updates within pre-approved templates. Can choose channels and timing. Cannot send communications that contradict investigation findings. Cannot communicate resolution until remediation is confirmed.

**Judgment SLO:** Human edit rate on outgoing communications. Target: less than 15% of messages require human editing before or after send.

#### Remediation Agent

**Inputs:** Investigation output (root cause + confidence), OpenSRM manifest (for safe action definitions), change history, current system state

**Reasoning:** Fix selection from available options. Risk assessment for each option. Rollback viability analysis. Weighs speed of fix against risk of making things worse.

**Tools it calls:** ArgoCD API (rollback), feature flag APIs (LaunchDarkly toggle), scaling APIs (Kubernetes HPA), NthLayer check-deploy (verify error budget allows action)

**Decision authority:** Can suggest fixes to humans. Can execute pre-approved safe actions (rollback to last known-good, scale up, disable feature flag) without human approval. Cannot execute novel remediation that hasn't been pre-approved in the OpenSRM manifest. Cannot make changes to services outside the blast radius.

**Judgment SLO:** Fix success rate (did the action resolve the incident?) and time-to-remediation compared to human baseline. Target: 80% fix success rate, within 2x of human median time-to-remediation.

---

### Reliability Governor

**Category:** Agent

**Purpose:** The meta-agent that watches the watchers. Continuously monitors judgment SLO error budgets for all agents in the ecosystem and makes governance decisions about their autonomy levels.

**Why it's an agent:** Governance decisions require interpretation. A spike in reversal rate could mean the agent has degraded, or it could mean a new human reviewer has different standards, or it could mean the problem domain shifted. The Governor needs to reason about context, not just react to threshold crossings.

**Inputs:**
- Judgment SLO metrics from Prometheus (reversal rates, HCF rates, calibration scores for all agents)
- Error budget burn rates
- Historical agent performance trends

**Outputs:**
- Autonomy policy adjustments (pushed to agents via configuration)
- Alerts when agent error budgets are exhausted
- Governance reports for human review

**Governance actions:**

| Trigger | Action |
|---------|--------|
| Agent reversal rate exceeding SLO target | Increase human review threshold for that agent |
| Agent error budget exhausted | Reduce agent to advisory-only mode (suggest, don't act) |
| Sustained good performance above threshold | Propose autonomy increase for human approval |
| Calibration drift detected | Flag agent for retraining or prompt adjustment |
| Multiple agents degrading simultaneously | Escalate to human operators, suggest system-wide review |

**Decision authority:** Can reduce agent autonomy (safe direction). Cannot increase agent autonomy without human approval (one-way safety ratchet). Can fire alerts. Can switch agents to degraded mode.

**Judgment SLO:** How often do human operators disagree with the Governor's autonomy adjustments? Target: less than 5% reversal rate on governance decisions.

**Tools it calls:** Prometheus queries (metric retrieval), NthLayer generate (regenerate alerting thresholds when policy changes)

---

## Agent Communication

### Protocol

Agents in the OpenSRM ecosystem communicate through two mechanisms:

**Shared state (within IncidentTown):** All IncidentTown agents read from and write to a shared incident context object. This is the simplest model and appropriate for agents collaborating on a single incident. The incident context is the accumulating record of truth. Agents append to it; they don't overwrite each other's findings.

**Event-based (cross-component):** Sitrep publishes snapshots that IncidentTown agents consume. The Reliability Governor reads metrics from Prometheus that all agents emit. These are decoupled, event-driven interactions that don't require agents to know about each other directly.

### Orchestration

IncidentTown uses a pipeline orchestrator that sequences agents based on the incident lifecycle. This is not a general-purpose agent framework: it's a purpose-built flow for incident response.

The orchestrator:
- Receives the incident trigger (from PagerDuty via Sitrep)
- Creates the shared incident context
- Runs Triage, waits for completion
- Runs Investigation and Communication in parallel
- Runs Remediation when Investigation produces a root cause
- Sends Communication updates as findings accumulate
- Closes the incident context when remediation is confirmed

The orchestrator itself is not an agent. It's a deterministic state machine that sequences agent execution. It doesn't reason about what to do next: the pipeline is fixed. Agents reason within their step.

---

## Data Flows

### Flow 1: Manifest to Monitoring

```
Developer              NthLayer              Monitoring Stack
   │                      │                      │
   │  manifest.yaml       │                      │
   ├─────────────────────▶│                      │
   │                      │  validate             │
   │                      │  (schema + dep math)  │
   │                      │                       │
   │                      │  prometheus/rules.yaml│
   │                      ├──────────────────────▶│
   │                      │                       │
   │                      │  grafana/dashboard.json
   │                      ├──────────────────────▶│
   │                      │                       │
   │                      │  pagerduty config     │
   │                      ├──────────────────────▶│
   │                      │                       │
   │                      │  topology.json ──────▶ Sitrep agent
```

### Flow 2: Telemetry to Snapshot (Sitrep reasoning loop)

```
Systems              Sitrep Agent                Consumers
   │                    │                            │
   │ metrics            │                            │
   ├───────────────────▶│                            │
   │                    │ observe                    │
   │ alerts             │                            │
   ├───────────────────▶│                            │
   │                    │ correlate (reasoning)      │
   │ change events      │  "deploy X likely caused   │
   ├───────────────────▶│   alert Y given topology"  │
   │                    │                            │
   │ logs               │ assess                    │
   ├───────────────────▶│  rank by severity,        │
   │                    │  relevance                 │
   │                    │                            │
   │                    │ publish                    │
   │                    │  snapshot (JSON)           │
   │                    ├───────────────────────────▶│
   │                    │                            │
   │                    │         [Sitrep emits      │
   │                    │          gen_ai.decision.* │
   │                    │          for each           │
   │                    │          correlation]       │
```

### Flow 3: Decision to SLO Measurement

```
Any Agent           OTel Collector       Prometheus           Governor
   │                    │                    │                    │
   │ decision event     │                    │                    │
   ├───────────────────▶│                    │                    │
   │                    ├───────────────────▶│                    │
   │                    │                    │                    │
   │ [human reviews]    │                    │                    │
   │                    │                    │                    │
   │ reversal event     │                    │                    │
   ├───────────────────▶│                    │                    │
   │                    ├───────────────────▶│                    │
   │                    │                    │                    │
   │                    │                    │ reversal_rate      │
   │                    │                    │ = 0.032            │
   │                    │                    │ (target: 0.05)     │
   │                    │                    │                    │
   │                    │                    │ judgment SLO       │
   │                    │                    │ metrics            │
   │                    │                    ├───────────────────▶│
   │                    │                    │                    │
   │                    │                    │                    │ [if
   │                    │                    │  autonomy policy   │  degraded]
   │◀────────────────────────────────────────────────────────────┤
```

### Flow 4: Agent Tool Invocation

```
Agent (Sitrep/IncidentTown)    Tool (NthLayer)    Data (OpenSRM)
         │                          │                    │
         │  topology_query          │                    │
         ├─────────────────────────▶│                    │
         │                          │  read manifest     │
         │                          ├───────────────────▶│
         │                          │                    │
         │                          │  manifest.yaml     │
         │                          │◀───────────────────┤
         │                          │                    │
         │  topology.json           │                    │
         │◀─────────────────────────┤                    │
         │                          │                    │
         │  check_deploy_gate       │                    │
         ├─────────────────────────▶│                    │
         │                          │                    │
         │  gate: pass/fail         │                    │
         │◀─────────────────────────┤                    │
```

### Flow 5: Incident Lifecycle

```
PagerDuty  Sitrep   Orchestrator  Triage  Investigate  Remediate  Comms
   │         │          │           │         │           │         │
   │incident │          │           │         │           │         │
   ├────────▶│          │           │         │           │         │
   │         │ snapshot │           │         │           │         │
   │         ├─────────▶│           │         │           │         │
   │         │          │ create    │         │           │         │
   │         │          │ context   │         │           │         │
   │         │          ├──────────▶│         │           │         │
   │         │          │           │         │           │         │
   │         │          │  severity,│         │           │         │
   │         │          │  blast    │         │           │         │
   │         │          │◀──────────┤         │           │         │
   │         │          │           │         │           │         │
   │         │          ├───────────┼────────▶│           │         │
   │         │          ├───────────┼─────────┼───────────┼────────▶│
   │         │          │           │         │           │         │
   │         │          │           │  root   │           │    ┌───▶│
   │         │          │           │  cause  │           │    │    │
   │         │          │◀──────────┼─────────┤           │    │    │
   │         │          │           │         │           │    │    │
   │         │          ├───────────┼─────────┼──────────▶│    │    │
   │         │          │           │         │  fix      │    │    │
   │         │          │◀──────────┼─────────┼───────────┤    │    │
   │         │          │           │         │           │    │    │
   │         │          ├───────────┼─────────┼───────────┼────┘    │
   │         │          │           │         │           │  update │
```

---

## Agent Observability

Every agent in the ecosystem is itself a service with SLOs. The same specification that defines service reliability also defines agent reliability. The same tooling that generates service monitoring also generates agent monitoring.

### How it works

1. Every agent decision emits a `gen_ai.decision.*` OTel event (outcome, confidence, decision class)
2. Human overrides emit `gen_ai.override.*` OTel events (original outcome, new outcome, actor)
3. These events flow to Prometheus via OTel Collector
4. NthLayer generates Prometheus recording rules for each agent's judgment SLOs (from the agent's OpenSRM `type: ai-gate` manifest)
5. NthLayer generates Grafana dashboards for agent decision quality
6. The Reliability Governor consumes these metrics and adjusts autonomy policy

### Agent manifests

Each agent has its own OpenSRM manifest:

```yaml
apiVersion: opensrm.io/v1
kind: ServiceReliabilityManifest
metadata:
  name: sitrep-agent
  tier: critical
spec:
  type: ai-gate
  slos:
    availability:
      target: 0.999
      window: 30d
    judgment:
      reversal_rate:
        target: 0.10
        window: 30d
        observation_period: 48h
      high_confidence_failure:
        target: 0.03
        window: 30d
        confidence_threshold: 0.8
```

This closes the loop: agents are monitored by the same system they help operate. If Sitrep's correlation quality drops, the same Prometheus rules and Grafana dashboards that monitor your services will show you.

---

## Judgment SLO Measurement

### Metrics Computed

```
reversal_rate = 
  sum(rate(gen_ai_reversals_total[30d])) 
  / 
  sum(rate(gen_ai_decisions_total[30d]))

high_confidence_failure_rate = 
  sum(rate(gen_ai_reversals_total{confidence_bucket=">0.9"}[30d])) 
  / 
  sum(rate(gen_ai_decisions_total{confidence_bucket=">0.9"}[30d]))

calibration_ece = 
  sum(abs(accuracy_by_bin - confidence_by_bin) * weight_by_bin)
```

### Maturity Levels

| Level | What's Measured | Effort |
|-------|-----------------|--------|
| 1: Reactive | Reversal rate (when humans are forced to engage) | Minimal |
| 2: Proactive | Audit accuracy (spot-check random sample of unreviewed decisions) | Moderate |
| 3: Outcome | Defect rate (actual correctness from downstream consequences) | High |
| 4: Behavioral | Escalation appropriateness, segment gaps, decision distribution analysis | High |

---

## Integration Points

### External Systems

| System | Integration | Direction |
|--------|-------------|-----------|
| Prometheus | Remote write, query | Metrics to Sitrep, judgment SLOs to Governor |
| Alertmanager | Webhook | Alerts to Sitrep |
| GitHub | Webhook, API | Deploys to Sitrep, rollback from Remediation agent |
| ArgoCD | Webhook, API | Deploys to Sitrep, rollback from Remediation agent |
| LaunchDarkly | Webhook, API | Flags to Sitrep, toggle from Remediation agent |
| PagerDuty | API, webhook | Incidents to Sitrep, config from NthLayer, pages from Triage agent |
| Grafana | JSON import | Dashboards from NthLayer (service + agent dashboards) |
| OTel Collector | OTLP | Logs and traces to Sitrep, decision telemetry from all agents |

### Internal Interfaces

| From | To | Format | Data | Type |
|------|-----|--------|------|------|
| Git | NthLayer | YAML | ServiceManifests | Data to tool |
| NthLayer | Prometheus | YAML | Alert rules | Tool to data |
| NthLayer | Grafana | JSON | Dashboards | Tool to data |
| NthLayer | Sitrep | JSON | Topology graph | Tool to agent |
| Sitrep | IncidentTown | JSON/SSE | Snapshots | Agent to agent |
| Sitrep | REST consumers | JSON/SSE | Snapshots | Agent to external |
| All agents | OTel Collector | Events | Decision telemetry | Agent to data |
| Prometheus | Governor | PromQL | Judgment SLO metrics | Data to agent |
| Governor | All agents | Config | Autonomy policy | Agent to agent |
| IncidentTown agents | Shared context | In-memory | Incident findings | Agent to agent |

---

## Deployment Tiers

The ecosystem is designed for incremental adoption. Each tier adds capabilities without requiring changes to the previous tier.

### Tier 1: Static Only

**Components:** OpenSRM manifests + NthLayer CLI

**Agents involved:** None

**What you get:**
- Validated service reliability manifests with schema and dependency math
- Generated Prometheus alerting rules and Grafana dashboards
- CI/CD deployment gates based on error budgets
- Drift detection between declared and actual monitoring

**Effort:** Write manifests, add NthLayer to CI/CD pipeline. No infrastructure beyond what you already run (Prometheus, Grafana).

### Tier 2: Static + Correlation

**Components:** Everything in Tier 1 + Sitrep agent

**Agents involved:** Sitrep only

**What you get:**
- Everything in Tier 1
- Continuous pre-correlated operational snapshots
- "What changed?" answers assembled before anyone asks
- AI-consumable situation reports alongside human dashboards

**Effort:** Deploy Sitrep as a long-running service. Configure webhook ingestion from Alertmanager, GitHub, ArgoCD. Provide Prometheus read access.

### Tier 3: Full Autonomous

**Components:** Everything in Tier 2 + IncidentTown agents + Reliability Governor

**Agents involved:** Sitrep, Triage, Investigation, Communication, Remediation, Governor

**What you get:**
- Everything in Tier 2
- Agent-orchestrated incident response
- Automated triage, investigation, communication, and safe remediation
- Governance layer monitoring all agent decision quality
- Autonomy adjustments based on measured performance

**Effort:** Deploy IncidentTown orchestrator and agent processes. Define agent manifests with judgment SLOs. Configure safe action permissions in OpenSRM manifests. Deploy Reliability Governor.

---

## Security Model

### Data Classification

| Data | Sensitivity | Handling |
|------|-------------|----------|
| Manifests | Low | Public or internal Git |
| Metrics | Low-Medium | Standard observability controls |
| Logs | Medium-High | PII redaction required |
| Snapshots | Medium | Access control, tenant isolation |
| Decision telemetry | Low-Medium | Anonymize actor IDs if needed |
| Incident context | Medium-High | Access restricted to incident responders |
| Autonomy policy | Medium | Change-controlled, auditable |

### Access Control

- **OpenSRM manifests:** Developer write, CI/CD read, agents read
- **NthLayer:** CI/CD service accounts, agents invoke via tool interface
- **Sitrep API:** Service accounts for IncidentTown agents, RBAC for humans
- **IncidentTown:** Agents scoped to incident they're responding to
- **Reliability Governor:** Read access to all judgment SLO metrics, write access to autonomy policy only
- **Decision telemetry:** Write from all agents, read for metrics aggregation
- **Remediation actions:** Pre-approved safe actions defined in OpenSRM manifests, novel actions require human approval

### Agent Authority Boundaries

No agent can escalate its own permissions. The Reliability Governor can reduce agent autonomy (safe direction) but cannot increase it without human approval. This is a one-way safety ratchet: automation can always be constrained, never self-expanded.

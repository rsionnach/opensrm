# Architecture

This document describes the OpenSRM ecosystem architecture: how the specification, tools, agents, and semantic conventions work together to form a complete reliability stack.

---

## Design Principles

### 1. Schemas + Enforcement

Every component is defined by a specification first. Implementation follows. This enables multiple implementations of the same spec, clear contracts between components, and validation at boundaries.

### 2. Shift-Left Reliability

Reliability concerns move earlier in the lifecycle. Service manifests define SLOs before deployment. CI/CD gates enforce contracts. Decision quality is measured, not assumed.

### 3. Operator-Agnostic

The stack supports both human and AI operators. nthlayer-correlate snapshots work for dashboards (human) and LLMs (AI). Judgment SLOs measure decision quality regardless of decision-maker. Decision telemetry captures human and AI decisions equally.

### 4. Open Standards

Extend existing standards (OTel) rather than invent new ones. This enables ecosystem adoption and avoids vendor lock-in.

### 5. Reasoning Boundary

Agent capabilities are reserved for components that require interpretation of ambiguous inputs. Deterministic operations (validation, generation, arithmetic) remain as tools that agents invoke. This ensures the system degrades gracefully without AI, that agents can be measured and governed, and that complexity is proportional to the reasoning required. If a component doesn't need to reason, it isn't an agent.

---

## Component Taxonomy

Every component in the ecosystem falls into one of four categories based on its execution model. This distinction is architectural, not cosmetic: it determines how the component is built, deployed, tested, and monitored.

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
│  DATA PRIMITIVES (schema + transport, no reasoning)                 │
│  └── Verdict                     Structured record of AI judgments  │
│                                                                      │
│  TOOLS (deterministic, invocable, no reasoning)                     │
│  ├── NthLayer compiler           Manifest in, artifacts out         │
│  ├── Schema validator            YAML in, pass/fail out             │
│  └── Dependency math engine      Targets in, ceiling out            │
│                                                                      │
│  AGENTS (reasoning, adaptive, judgment required)                    │
│  ├── nthlayer-correlate                      Continuous correlation             │
│  ├── nthlayer-respond Triage               Severity and blast radius          │
│  ├── nthlayer-respond Investigation        Root cause analysis                │
│  ├── nthlayer-respond Communication        Stakeholder updates                │
│  ├── nthlayer-respond Remediation          Fix suggestion and validation      │
│  └── nthlayer-measure                     Evaluation + governance            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**The test:** Does this component need to reason about ambiguous inputs to produce its output? If yes, it's an agent. If it does the same thing every time given the same input, it's a tool. If it's a structured record format that other components read and write, it's a data primitive. If it's queryable state, it's a data source.

**Why this matters:** The data, primitive, and tool layers work without any AI in the stack. Teams can adopt OpenSRM manifests, NthLayer, and the verdict library today with zero agents and still get validated manifests, generated monitoring, and structured decision records. The agent layer is additive, not foundational. The system degrades gracefully if an agent fails.

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
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │              VERDICT LAYER (Data Primitive)                        │  │
│  │                                                                     │  │
│  │  Every judgment-producing component writes verdicts. Every          │  │
│  │  feedback-consuming component reads them. The verdict store is      │  │
│  │  the shared substrate, not OTel, not Prometheus, not a message bus. │  │
│  │                                                                     │  │
│  │  ┌────────────────┐  ┌────────────────────┐  ┌────────────────┐   │  │
│  │  │ verdict.create │  │ verdict.resolve    │  │ verdict.query  │   │  │
│  │  │                │  │                    │  │                │   │  │
│  │  │ Agent emits    │  │ Human confirms or  │  │ accuracy()     │   │  │
│  │  │ judgment with  │  │ overrides. CI auto-│  │ gaming-check() │   │  │
│  │  │ confidence +   │  │ resolves from test │  │ review()       │   │  │
│  │  │ lineage links  │  │ failure / revert   │  │ replay()       │   │  │
│  │  └────────────────┘  └────────────────────┘  └────────────────┘   │  │
│  │                                                                     │  │
│  │  Store: SQLite (Tier 1). PostgreSQL, ClickHouse when needed.       │  │
│  │  OTel emission: side-effect of verdict creation, not the primary   │  │
│  │  feedback path.                                                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                 │ verdicts with                                          │
│                 │ lineage                                                │
│                 ▼                                                        │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║                AGENT LAYER (Reasoning)                            ║  │
│  ║                                                                   ║  │
│  ║  ┌──────────────────┐  verdict   ┌────────────────────────────┐  ║  │
│  ║  │  nthlayer-correlate Agent    │───────────▶│      nthlayer-respond Agents         │  ║  │
│  ║  │                  │            │                            │  ║  │
│  ║  │  Observe:        │            │  ┌──────────────────────┐  │  ║  │
│  ║  │  • alerts        │            │  │ Triage               │  │  ║  │
│  ║  │  • changes       │            │  │ Investigation        │  │  ║  │
│  ║  │  • topology      │            │  │ Communication        │  │  ║  │
│  ║  │                  │            │  │ Remediation          │  │  ║  │
│  ║  │  Reason:         │            │  └──────────────────────┘  │  ║  │
│  ║  │  • correlate     │            │                            │  ║  │
│  ║  │  • assess        │            │  Shared: incident context  │  ║  │
│  ║  │  • prioritise    │            │  Orchestration: pipeline   │  ║  │
│  ║  └──────────────────┘            └────────────────────────────┘  ║  │
│  ║           ▲                                  ▲                   ║  │
│  ║           │             ┌──────────────────┐ │                   ║  │
│  ║           │             │    nthlayer-measure       │ │                   ║  │
│  ║           └─────────────│                  │─┘                   ║  │
│  ║     verdict.accuracy()  │  Evaluates:      │  autonomy           ║  │
│  ║     queries             │  • agent output  │  adjustments        ║  │
│  ║                         │  • risk tier     │                     ║  │
│  ║                         │  • calibration   │                     ║  │
│  ║                         └──────────────────┘                     ║  │
│  ║                                                                   ║  │
│  ║  All agents emit verdicts with lineage. The verdict store is the  ║  │
│  ║  primary feedback mechanism. OTel events are a side-effect.       ║  │
│  ╚══════════════════════════════╤════════════════════════════════════╝  │
│                                 │ OTel side-effects                     │
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
│  │  Emitted automatically when verdicts are created and resolved.     │  │
│  │  Enables Prometheus metrics and Grafana dashboards via NthLayer.   │  │
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

## Component Details: Data Primitives

### Verdict

**Category:** Data primitive

**Purpose:** The structured record format for every AI judgment in the ecosystem. A verdict captures what was decided, with what confidence, and — once outcomes are known — whether it was correct. Every judgment-producing component (nthlayer-measure, nthlayer-correlate, nthlayer-respond agents) writes verdicts. Every feedback-consuming component reads them. The verdict store is the shared substrate for calibration, gaming detection, and human review.

**Three phases per verdict:**
1. **Judgment** (at decision time): producer, decision, confidence, context
2. **Outcome** (filled later): human confirms, human overrides, or CI auto-resolves (test failure, deploy regression, revert)
3. **Lineage** (optional): links to parent/child verdicts forming chains (e.g., triage verdict → investigation verdict → remediation verdict)

**Key operations:**
- `verdict.create()` — emit a verdict when making a judgment
- `verdict.resolve()` — confirm or override a verdict (human or automated)
- `verdict.link()` — connect verdicts via lineage
- `verdict.accuracy()` — query confirmation rate, override rate, calibration gap per producer
- `verdict.gaming-check()` — score-outcome divergence per agent over rolling window
- `verdict.review()` — list pending/overdue verdicts needing human attention
- `verdict.replay()` — re-evaluate historical verdicts against current model/prompt

**Store:** SQLite (Tier 1, default). PostgreSQL and ClickHouse stores are deferred until SQLite contention or query volume warrants them.

**OTel integration:** `gen_ai.decision.*` and `gen_ai.override.*` events are emitted automatically when verdicts are created and resolved. This is a side-effect of verdict operations, not a separate instrumentation step.

**Why it's not an agent:** Verdict is pure schema and transport. It records decisions — it doesn't make them. No model calls, no reasoning. It's the foundation layer that sits below all agents in the dependency graph.

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
- Topology graph (consumed by nthlayer-correlate agent)
- CI/CD gate exit codes

**Key interfaces:**
```
nthlayer validate <manifest>           # Validate against schema + dependency math
nthlayer generate <manifest> -o <dir>  # Generate all artifacts
nthlayer check-deploy <manifest>       # CI/CD deployment gate
nthlayer topology export <manifest>    # Export topology for nthlayer-correlate
nthlayer verify <manifest>             # Verify declared metrics exist in Prometheus
nthlayer portfolio                     # Org-wide SLO health view
```

**Why it's not an agent:** Validation is schema checking. Generation is template expansion. Dependency math is arithmetic. Deployment gating is a threshold comparison. All of these are deterministic. Agents call NthLayer as a tool when they need topology data or artifact regeneration.

---

## Component Details: Agents

### nthlayer-correlate (Correlation Agent)

**Category:** Agent

**Purpose:** Continuously observe operational telemetry and produce pre-correlated situation assessments. nthlayer-correlate doesn't just aggregate data: it interprets context, weighs signals against topology, and makes judgment calls about what matters right now.

**Why it's an agent:** Correlation is inherently a reasoning task. "A deployment happened 12 minutes ago to auth-service, and now checkout-service latency is spiking, and these two services share a critical dependency path": connecting those dots requires understanding topology, temporal proximity, and causal plausibility. Different situations demand different correlation strategies. This is interpretation, not aggregation.

**Inputs (Tier 1):**
- Alerts (webhook ingester)
- Changes (webhook ingester — GitHub, ArgoCD, etc.)
- Topology (from NthLayer, via tool call)
- Verdicts (nthlayer-measure quality verdicts accepted as events)

**Inputs (deferred — Tier 2/3):**
- Metrics (Prometheus remote write)
- Logs (OTLP)
- Events via NATS or Kafka

**Outputs:**
- Correlation verdicts with lineage to child signal groups
- Snapshot verdicts (model-generated situational assessment)
- Stored in SQLite FTS5 (Tier 1); PostgreSQL/ClickHouse deferred

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
| INCIDENT | Incident declared via webhook | Continuous reassessment, 1-minute snapshots, pushes to nthlayer-respond |
| DEGRADED | Own judgment SLO metrics below threshold | Conservative mode, reduced confidence in correlations, flags for human review |

**Tools nthlayer-correlate calls:**
- NthLayer topology export (deterministic: get service graph)
- Prometheus queries (deterministic: get metric values)
- Log search (deterministic: retrieve matching entries)

**Judgment SLOs for nthlayer-correlate itself:**
- Correlation accuracy: what percentage of nthlayer-correlate's "related change" assessments do humans agree with?
- False positive rate: how often does nthlayer-correlate flag a change as incident-related when it isn't?

**Verdict output:** Every correlation assessment is emitted as a verdict via `verdict.create()`. Snapshot verdicts link to child correlation verdicts via lineage. When a human disagrees with a correlation, `verdict.resolve(status="overridden")` closes the loop. OTel events (`gen_ai.decision.*`, `gen_ai.override.*`) are emitted automatically as a side-effect.

**DEGRADED mode:** When the model is unavailable, nthlayer-correlate continues the transport pipeline (ingest, group, deduplicate) and emits template-based verdicts with `confidence: 0.0`, flagging them for human review. The pre-correlation engine is fully testable without a model.

---

### nthlayer-respond (Incident Response Agents)

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

All nthlayer-respond agents read from and write to a shared incident context object. This is the accumulating record of what is known about the incident.

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

**Inputs:** nthlayer-correlate snapshot, OpenSRM topology, active SLO status from Prometheus

**Reasoning:** Severity classification based on blast radius and SLO impact. Determines which services are affected, which teams own them, and how urgent the response needs to be. Weighs competing signals when severity is ambiguous.

**Tools it calls:** NthLayer topology export (dependency graph lookup), PagerDuty API (incident creation, team paging)

**Decision authority:** Can set severity. Can page teams. Can assign ownership. Cannot remediate. Cannot override existing incident classification without human approval.

**Judgment SLO:** What percentage of severity classifications do humans override? Target: less than 10% reversal rate on severity assignments.

#### Investigation Agent

**Inputs:** nthlayer-correlate snapshot, triage output from incident context, historical incident data, service topology

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

### nthlayer-measure

**Category:** Agent

**Purpose:** Quality measurement engine and governance layer. The nthlayer-measure evaluates agent output quality, classifies risk, routes evaluations to appropriate model tiers, and self-calibrates using verdict accuracy queries. It also makes governance decisions about agent autonomy levels.

**Why it's an agent:** Both evaluation and governance require interpretation. Evaluating whether agent output is correct requires judgment across multiple quality dimensions. A spike in override rate could mean the agent has degraded, a new reviewer has different standards, or the problem domain shifted. The nthlayer-measure reasons about context, not just threshold crossings.

**Core pipeline (Phase 1 — verdict integration):**

The nthlayer-measure has a fully implemented evaluation pipeline with its own score store and calibration state. Phase 1 refactors this to use verdicts as the storage format:

- `pipeline.evaluate()` emits a verdict via `verdict.create()` instead of writing to the internal score store
- Human overrides call `verdict.resolve(status="overridden")`
- Self-calibration queries `verdict.accuracy(producer="arbiter")` instead of maintaining separate calibration state
- Verdict store configured via `verdict.store` section in `arbiter.yaml`

**Risk classification and tiered routing (Phase 2):**

Not all agent output warrants frontier model evaluation. The nthlayer-measure classifies risk using manifest-declared path lists (not pattern matching):

| Tier | Criteria | Evaluation |
|------|----------|------------|
| Minimal | Low-risk paths, small diff | Auto-approve |
| Standard | Normal paths, moderate diff | Light evaluation |
| Deep | Critical paths, schema changes | Full multi-dimension evaluation |
| Critical | Declared critical paths, large blast radius | Frontier model evaluation |

- **Calibration sampling:** 5% of auto-approved outputs are sampled and fully evaluated. Results calibrate the risk classification.
- **Deep eval sampling:** 5% of high-scoring outputs get a second, more thorough evaluation, linked to the original verdict via lineage.
- **Downstream outcome tracking:** Verdicts auto-resolve from CI signals (test failure, deploy regression, revert).

**Governance actions:**

| Trigger | Action |
|---------|--------|
| Agent override rate exceeding SLO target | Increase human review threshold for that agent |
| Agent error budget exhausted | Reduce agent to advisory-only mode (suggest, don't act) |
| Sustained good performance above threshold | Propose autonomy increase for human approval |
| Calibration drift detected | Flag agent for retraining or prompt adjustment |
| Score-outcome divergence > 0.10 | Emit gaming alert via notification system |

**Decision authority:** Can reduce agent autonomy (safe direction). Cannot increase agent autonomy without human approval (one-way safety ratchet). Can fire alerts. Can switch agents to degraded mode.

**Judgment SLO:** How often do human operators disagree with the nthlayer-measure's autonomy adjustments? Target: less than 5% reversal rate on governance decisions.

**Self-calibration:** The nthlayer-measure measures its own accuracy via `verdict.accuracy(producer="arbiter")`. Every evaluation it makes is itself a verdict, subject to the same feedback loop it enforces on other agents.

---

## Agent Communication

### Protocol

Agents in the OpenSRM ecosystem communicate through three mechanisms:

**Verdicts with lineage (cross-component):** The primary inter-component communication format. nthlayer-correlate emits correlation verdicts. nthlayer-respond's triage agent consumes them and emits triage verdicts linked via lineage. Investigation links to triage. Remediation links to investigation. This creates a traceable chain: any override at any point propagates context back through lineage. The verdict store is queryable — components don't need to know about each other directly.

**Shared state (within nthlayer-respond):** All nthlayer-respond agents read from and write to a shared incident context object. This is the simplest model for agents collaborating on a single incident. Agents are functions with model calls inside, called sequentially by the coordinator within a single process. No mailboxes, no message buses, no polling.

**OTel events (observability side-channel):** `gen_ai.decision.*` and `gen_ai.override.*` events are emitted automatically when verdicts are created and resolved. These feed Prometheus metrics and Grafana dashboards via NthLayer. This is a read-only observability channel, not a communication path.

### Orchestration

nthlayer-respond uses a coordinator that sequences agent calls as direct function invocations. This is not a general-purpose agent framework, a message broker, or a mail system: it's a purpose-built pipeline for incident response.

The coordinator:
- Receives the incident trigger (nthlayer-correlate correlation verdict)
- Creates the shared incident context
- Calls `triage(event)`, gets a result (verdict emitted)
- Calls `investigate(triage_result)` and `communicate(triage_result)` in parallel
- Calls `remediate(investigation_result)` when root cause is found
- Each agent emits verdicts with lineage to its inputs
- Closes the incident context when remediation is confirmed

The coordinator is not an agent. It's a deterministic state machine that sequences function calls. It doesn't reason about what to do next: the pipeline is fixed. Agents reason within their step. If agents later need to run as separate processes (scale trigger), the transport changes — NATS or direct HTTP, not a mail abstraction.

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
   │                      │  topology.json ──────▶ nthlayer-correlate agent
```

### Flow 2: Events to Verdicts (nthlayer-correlate reasoning loop)

```
Event Sources        nthlayer-correlate Agent                Verdict Store
   │                    │                            │
   │ alerts (webhook)   │                            │
   ├───────────────────▶│                            │
   │                    │ ingest → SQLite FTS5       │
   │ changes (webhook)  │                            │
   ├───────────────────▶│                            │
   │                    │ pre-correlate (transport)  │
   │ topology           │  temporal grouping,        │
   │ (NthLayer export)  │  deduplication,            │
   ├───────────────────▶│  severity pre-scoring      │
   │                    │                            │
   │ verdicts           │ model (judgment)           │
   │ (nthlayer-measure quality)  │  correlate, assess,        │
   ├───────────────────▶│  rank                      │
   │                    │                            │
   │                    │ verdict.create()           │
   │                    │  correlation verdict +     │
   │                    │  snapshot verdict with     │
   │                    │  lineage to child          │
   │                    │  correlations              │
   │                    ├───────────────────────────▶│
   │                    │                            │
   │                    │  [OTel side-effect:        │
   │                    │   gen_ai.decision.* per    │
   │                    │   correlation]             │
```

### Flow 3: Decision to Verdict to Measurement

```
Any Agent           Verdict Store        Human / CI           nthlayer-measure
   │                    │                    │                    │
   │ verdict.create()   │                    │                    │
   │ (judgment phase)   │                    │                    │
   ├───────────────────▶│                    │                    │
   │                    │  [OTel side-effect: gen_ai.decision.*] │
   │                    │                    │                    │
   │                    │  verdict.review()  │                    │
   │                    │◀───────────────────┤                    │
   │                    │                    │                    │
   │                    │  verdict.resolve() │                    │
   │                    │  (confirm/override │                    │
   │                    │   or CI auto-      │                    │
   │                    │   resolve)         │                    │
   │                    │◀───────────────────┤                    │
   │                    │  [OTel side-effect: gen_ai.override.*] │
   │                    │                    │                    │
   │                    │  verdict.accuracy(producer=X)           │
   │                    ├───────────────────────────────────────▶│
   │                    │                    │                    │
   │                    │  verdict.gaming-check(producer=X)      │
   │                    ├───────────────────────────────────────▶│
   │                    │                    │                    │
   │                    │                    │  autonomy policy   │
   │◀────────────────────────────────────────────────────────────┤
```

### Flow 4: Agent Tool Invocation

```
Agent (nthlayer-correlate/nthlayer-respond)    Tool (NthLayer)    Data (OpenSRM)
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
PagerDuty  nthlayer-correlate   Orchestrator  Triage  Investigate  Remediate  Comms
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

1. Every agent decision emits a verdict via `verdict.create()` (judgment phase: outcome, confidence, producer, lineage)
2. Human overrides and CI signals resolve verdicts via `verdict.resolve()` (outcome phase: confirmed, overridden, or auto-resolved)
3. OTel events (`gen_ai.decision.*`, `gen_ai.override.*`) are emitted automatically as a side-effect of verdict operations
4. These OTel events flow to Prometheus via OTel Collector
5. NthLayer generates Prometheus recording rules and Grafana dashboards from each agent's OpenSRM `type: ai-gate` manifest
6. The nthlayer-measure queries `verdict.accuracy()` and `verdict.gaming-check()` for calibration and governance decisions
7. `nthlayer-learn gaming-check` (score-outcome divergence > 0.10) triggers alerts via the notification system

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

This closes the loop: agents are monitored by the same system they help operate. If nthlayer-correlate's correlation quality drops, the same Prometheus rules and Grafana dashboards that monitor your services will show you.

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

### External Systems (Tier 1)

| System | Integration | Direction |
|--------|-------------|-----------|
| Alertmanager | Webhook | Alerts to nthlayer-correlate |
| GitHub | Webhook, API | Changes to nthlayer-correlate, rollback from Remediation agent |
| ArgoCD | Webhook, API | Changes to nthlayer-correlate, rollback from Remediation agent |
| PagerDuty | API, webhook | Pages from Triage agent, config from NthLayer |
| Grafana | JSON import | Dashboards from NthLayer (service + agent dashboards) |
| Prometheus | Query | OTel metrics for NthLayer dashboards and recording rules |
| OTel Collector | OTLP | Decision telemetry (side-effect of verdict creation) |
| Slack | API | Governance notifications, overdue reviews (Phase 3) |

### External Systems (Deferred)

| System | Integration | Trigger |
|--------|-------------|---------|
| Prometheus | Remote write to nthlayer-correlate | Webhook ingestion latency under sustained load |
| NATS | Event streaming | Small-team scale, Tier 2 |
| Kafka | Event streaming | Enterprise scale, Tier 3 |
| LaunchDarkly | Webhook, API | Feature flag changes to nthlayer-correlate, toggles from Remediation |

### Internal Interfaces

| From | To | Format | Data | Type |
|------|-----|--------|------|------|
| Git | NthLayer | YAML | ServiceManifests | Data to tool |
| NthLayer | Prometheus | YAML | Alert rules | Tool to data |
| NthLayer | Grafana | JSON | Dashboards | Tool to data |
| NthLayer | nthlayer-correlate | JSON | Topology graph | Tool to agent |
| All agents | Verdict Store | Verdict | Judgments with lineage | Agent to primitive |
| Verdict Store | nthlayer-measure | Query | accuracy(), gaming-check() | Primitive to agent |
| Verdict Store | OTel Collector | Events | gen_ai.decision.*, gen_ai.override.* (auto-emitted) | Primitive to data |
| nthlayer-correlate | nthlayer-respond | Verdict | Correlation verdicts | Agent to agent |
| nthlayer-measure | All agents | Config | Autonomy policy | Agent to agent |
| nthlayer-respond agents | Shared context | In-memory | Incident findings (within single process) | Agent to agent |
| Human / CI | Verdict Store | Resolve | Confirms, overrides, auto-resolves | External to primitive |

---

## Deployment Tiers

The ecosystem is designed for incremental adoption. Each tier adds capabilities without requiring changes to the previous tier.

### Tier 1: Static + Verdicts

**Components:** OpenSRM manifests + NthLayer CLI + Verdict library + nthlayer-measure evaluation pipeline

**Agents involved:** nthlayer-measure (evaluation only, not full governance)

**What you get:**
- Validated service reliability manifests with schema and dependency math
- Generated Prometheus alerting rules and Grafana dashboards
- CI/CD deployment gates based on error budgets
- Drift detection between declared and actual monitoring
- Structured verdict records for every AI judgment
- `nthlayer-learn accuracy`, `nthlayer-learn gaming-check`, `nthlayer-learn review` CLI queries
- nthlayer-measure evaluating agent output quality with tiered risk classification
- Human feedback loop via `nthlayer-learn confirm` / `nthlayer-learn override`

**Effort:** Write manifests, add NthLayer to CI/CD pipeline, `pip install nthlayer-learn`, configure nthlayer-measure. SQLite verdict store — no additional infrastructure.

### Tier 2: Static + Correlation

**Components:** Everything in Tier 1 + nthlayer-correlate agent

**Agents involved:** nthlayer-correlate, nthlayer-measure

**What you get:**
- Everything in Tier 1
- Continuous pre-correlated operational snapshots as verdicts
- "What changed?" answers assembled before anyone asks
- Correlation verdicts with lineage to signal groups
- nthlayer-measure quality verdicts flow back into nthlayer-correlate as events
- Scenario replay for testing (`nthlayer-correlate replay`, `nthlayer-measure replay`)

**Effort:** Deploy nthlayer-correlate as a long-running service. Configure webhook ingestion from Alertmanager, GitHub, ArgoCD. SQLite FTS5 event store.

### Tier 3: Full Chain

**Components:** Everything in Tier 2 + nthlayer-respond agents + full nthlayer-measure governance

**Agents involved:** nthlayer-correlate, Triage, Investigation, Communication, Remediation, nthlayer-measure

**What you get:**
- Everything in Tier 2
- Agent-orchestrated incident response (nthlayer-respond)
- Full verdict lineage chain: nthlayer-correlate correlation → nthlayer-respond triage → investigation → remediation
- Human override at any point propagates through lineage
- Governance layer with gaming detection and autonomy adjustments
- Slack notifications for governance actions and overdue reviews

**Effort:** Deploy nthlayer-respond coordinator (single process, direct function calls). Define agent manifests with judgment SLOs. Configure safe action permissions in OpenSRM manifests.

---

## Security Model

### Data Classification

| Data | Sensitivity | Handling |
|------|-------------|----------|
| Manifests | Low | Public or internal Git |
| Metrics | Low-Medium | Standard observability controls |
| Verdicts | Medium | Access control, audit trail via lineage |
| Incident context | Medium-High | Access restricted to incident responders |
| Autonomy policy | Medium | Change-controlled, auditable |
| OTel decision telemetry | Low-Medium | Anonymize actor IDs if needed |

### Access Control

- **OpenSRM manifests:** Developer write, CI/CD read, agents read
- **NthLayer:** CI/CD service accounts, agents invoke via tool interface
- **Verdict store:** All agents write (create/resolve), nthlayer-measure reads (accuracy/gaming queries), humans read/write (review/confirm/override)
- **nthlayer-correlate:** Webhook ingestion from configured sources, verdict output to store
- **nthlayer-respond:** Agents scoped to incident they're responding to, verdicts linked via lineage
- **nthlayer-measure:** Read access to all verdict stores, write access to autonomy policy only
- **Remediation actions:** Pre-approved safe actions defined in OpenSRM manifests, novel actions require human approval

### Agent Authority Boundaries

No agent can escalate its own permissions. The nthlayer-measure can reduce agent autonomy (safe direction) but cannot increase it without human approval. This is a one-way safety ratchet: automation can always be constrained, never self-expanded.

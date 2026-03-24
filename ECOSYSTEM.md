# OpenSRM Ecosystem

This document describes how the components of the OpenSRM ecosystem work together to form a complete reliability lifecycle for services and AI systems. Each component solves a complete problem independently, and they compose through shared OpenSRM manifests and OTel telemetry conventions rather than code dependencies.

For the OpenSRM specification itself, see the [README](README.md). For the detailed architecture of individual components, see their respective repositories.

---

## Component Taxonomy

Every component in the ecosystem falls into one of three categories based on its execution model. This distinction is architectural: it determines how the component is built, deployed, tested, and monitored.

**Data Sources** (static, queryable, no reasoning):
- OpenSRM Manifests: YAML in Git, the single source of truth for service identity, SLO targets, dependencies, contracts, and AI gate specifications
- Prometheus/OTel metrics: time-series data, queryable by tools and agents
- Change event logs: deployment, config, feature flag, model version, and prompt change history

**Tools** (deterministic, invocable, no reasoning):
- NthLayer compiler: manifest in, monitoring artifacts out (Prometheus rules, Grafana dashboards, PagerDuty config, OpenSLO)
- Schema validator: YAML in, pass/fail out
- Dependency math engine: SLO targets and dependency topology in, feasibility ceiling out

**Agents** (reasoning, adaptive, judgment required):
- The nthlayer-measure: quality measurement, self-calibration, and governance (autonomy management for all agents)
- nthlayer-correlate: continuous signal correlation and situational awareness
- nthlayer-respond's sub-agents: triage, investigation, communication, and remediation during incident response

**The test:** Does this component need to reason about ambiguous inputs to produce its output? If yes, it's an agent. If it does the same thing every time given the same input, it's a tool. If it's queryable state that other things read, it's a data source.

**Why this matters:** The data and tool layers work without any AI in the stack. Teams can adopt OpenSRM manifests and NthLayer today with zero agents and still get validated manifests, generated monitoring, dependency math, and deployment gates. The agent layer is additive, not foundational. This maps directly to [Zero Framework Cognition](https://github.com/rsionnach/nthlayer-measure/blob/main/ZFC.md): data sources and tools are transport, agents are judgment.

---

## Integration Diagram

```
                        ┌─────────────────────────┐
                        │     OpenSRM Manifest     │
                        │  (the shared contract)   │
                        └────────────┬────────────┘
                                     │
                    reads            │           reads
               ┌─────────────┬──────┴──────┬─────────────┐
               ▼             ▼             ▼             ▼
         ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
         │ nthlayer-measure  │ │ NthLayer │ │  nthlayer-correlate  │ │  nthlayer-respond  │
         │          │ │          │ │          │ │          │
         │ quality  │ │ generate │ │correlate │ │ incident │
         │+govern   │ │ monitoring│ │ signals  │ │ response │
         │+cost     │ │          │ │          │ │          │
         └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
              │             │             │             │
              └──────┬──────┴──────┬──────┘             │
                     ▼             ▼                    ▼
              ┌────────────────────────────┐  ┌──────────────┐
              │  Streaming / Queue Layer   │  │  Consumes    │
              │  (Kafka / NATS / etc)      │  │  all three   │
              └──────────┬─────────────────┘  └──────┬───────┘
                         ▼                           │
              ┌────────────────────────┐             │
              │   OTel Collector /     │             │
              │   Prometheus / etc     │             │
              └────────────────────────┘             │
                                                     │
              ┌──────────────────────────────────────┘
              │  Learning loop (post-incident):
              │  nthlayer-respond findings → manifest updates
              │  → NthLayer regenerates → nthlayer-measure
              │  refines → nthlayer-correlate improves
              └──────────────────────────────────────▶ OpenSRM
```

---

## Data Flows

**Forward path:** Alert sources (nthlayer-measure quality breach, Prometheus alert, any webhook) flow to nthlayer-correlate for correlated context, then to nthlayer-respond for coordinated incident response, then to PagerDuty/Slack/email as notification channels to reach humans. PagerDuty and similar tools are notification channels that nthlayer-respond uses, not incident management platforms that sit upstream of the ecosystem.

**Quality path:** The nthlayer-measure produces quality scores as OTel metrics. NthLayer generates dashboards for them. nthlayer-correlate correlates them with other signals (deployments, config changes, model version swaps). nthlayer-respond uses them during incident response to assess whether AI agents in the response are producing reliable diagnostics.

**Change path:** Change events from all sources (normalised via the OpenSRM change event schema) flow through the streaming layer and are consumed by nthlayer-correlate (for correlation with quality signals), the nthlayer-measure (to contextualise quality shifts), and nthlayer-respond (during investigation to identify what changed before an incident).

**Learning loop:** nthlayer-respond's post-incident findings flow back to OpenSRM manifest updates, NthLayer regenerates improved artifacts, the nthlayer-measure refines thresholds, and nthlayer-correlate improves its correlations. The system gets better after every incident.

Each arrow is optional. Any component works alone. Together they form a complete reliability lifecycle for AI systems. The integration point for a user is: one `service.reliability.yaml` manifest, a shared OTel backend, and whichever components they need.

---

## Alert Flow

This is a critical architectural decision that differs from traditional incident management setups.

Alerts flow into the ecosystem first. The flow is:

1. **Alert source** (nthlayer-measure quality breach, Prometheus alert, any webhook) fires
2. **nthlayer-correlate** provides correlated context (what else changed, what's affected, what's the likely cause)
3. **nthlayer-respond** coordinates the response (triage, investigation, communication, remediation)
4. **PagerDuty/Slack/email** are notification channels nthlayer-respond uses to reach humans when it needs approval or escalation

PagerDuty is downstream of nthlayer-respond, not upstream. nthlayer-respond owns the incident lifecycle. This matters because the traditional model (PagerDuty pages a human, human investigates manually) doesn't scale when you're running hundreds of services and dozens of AI agents. The ecosystem handles the initial correlation, triage, and investigation, and reaches humans through whatever notification channels are configured when it needs them.

---

## The Event Volume Problem

The OpenSRM ecosystem must handle the volume of observability events produced by enterprise-scale distributed systems. A company running thousands of services (think SaaS platforms like Workday, Stripe, Twilio) produces an enormous volume of signals: metrics emitted at 15-second intervals across thousands of services, structured logs on every request, distributed traces across service boundaries, alerts from multiple monitoring systems, change events from CI/CD pipelines, feature flag changes, and infrastructure scaling events. This is millions of events per minute flowing into the ecosystem from external sources.

This is the primary scale concern. Agentic systems (like GasTown at 20-50 agents) add additional event volume on top of this, but the enterprise observability firehose is the harder problem by orders of magnitude. nthlayer-correlate needs to correlate across all of these signals in near-real-time. You cannot query raw events at incident time across millions of signals. Pre-correlation must happen continuously in the background so that when an incident fires, the correlated view is already built.

Existing observability infrastructure was not designed for this level of cross-signal correlation. Prometheus handles metrics well. Loki handles logs. Jaeger handles traces. But correlating across all three plus change events plus quality scores plus custom signals at enterprise scale is an unsolved problem that most teams handle manually during incidents (or don't handle at all).

### Streaming Layer

The ecosystem needs a streaming/queuing layer as foundational infrastructure that sits between event producers (OTel collectors, monitoring systems, CI/CD pipelines, the nthlayer-measure) and event consumers (nthlayer-correlate for correlation, NthLayer for dashboard updates, nthlayer-respond for incident detection, training pipelines for training data). This is transport, not a product. It's plumbing that enables the ecosystem to function at scale.

**Minimum viable setup (solo developer or small team):** A single NATS instance handles the message routing without the operational overhead of Kafka.

**Production setup (enterprise deployments):** A Kafka cluster, with partitioning by service, topics by signal type, and consumer groups per ecosystem component. Kafka's partitioning, compaction, and replay capabilities are designed for exactly this volume, and its topic/partition design maps naturally to OpenSRM's service topology.

---

## The Post-Incident Learning Loop

The ecosystem has a complete forward path (Define, Generate, Measure, Correlate, Respond) but the backward path is equally important. After nthlayer-respond resolves an incident, findings must flow back into every component:

```
Forward path:
OpenSRM → NthLayer → nthlayer-measure → nthlayer-correlate → nthlayer-respond
(define)   (generate)  (measure)  (correlate) (respond)

Learning loop (backward path):
nthlayer-respond findings → OpenSRM manifest updates (tighter targets, new dependencies)
nthlayer-respond findings → NthLayer rule refinements (better alerts)
nthlayer-measure history → NthLayer threshold revisions (data-driven targets)
nthlayer-correlate accuracy → nthlayer-correlate correlation improvements (self-calibration)
nthlayer-measure governance → all agents (autonomy adjustments)
```

**Manifest updates:** Incident findings map to specific manifest changes. SLO targets that were too loose get tightened. Missing dependency declarations get added. New safe actions get defined for remediation so that future incidents with the same fix can be resolved automatically.

**Rule refinements:** Quality patterns from the nthlayer-measure inform NthLayer's generated alerting rules. Alerts that should have fired earlier get tuned. Alerts that didn't fire at all get created. The generated monitoring infrastructure becomes more useful after every incident.

**Threshold revisions:** The nthlayer-measure's historical data informs whether judgment SLO thresholds are correctly calibrated. If agents consistently meet their targets by a wide margin, thresholds can be tightened. If targets are consistently missed, they may need adjustment or the agents need improvement.

**Correlation improvements:** nthlayer-correlate's accuracy on past incidents calibrates its future correlations. When nthlayer-correlate correctly identified a root cause, that pattern strengthens. When nthlayer-correlate missed a correlation or flagged a false positive, that signal feeds back into its models.

This is the difference between a system that responds to incidents and one that learns from them. Every mature SRE practice has post-incident review, but almost none systematically feed findings back into tooling. The learning loop is what turns five independent tools into a system that improves over time.

---

## The Change Event Ecosystem

The change event schema defined in the [OpenSRM spec](spec/v1/specification.md) is consumed by multiple components. Changes are the single most common cause of incidents and quality degradation, and the schema covers both traditional changes and AI-specific changes that existing change tracking misses entirely.

**Traditional changes:** Deployments, config updates, feature flag toggles, schema migrations, infrastructure scaling events.

**AI-specific changes:** Prompt changes, system instruction updates, model version swaps, LoRA adapter deployments, context window configuration changes, formula revisions, agent role reassignments. These are first-class change types, not afterthoughts.

Every change source (GitHub, ArgoCD, LaunchDarkly, model registries, prompt management systems) normalises into the change event schema so that downstream consumers don't need per-source integrations.

**How each component uses change events:**

- **nthlayer-correlate** uses them for change attribution (correlating quality drops with recent changes)
- **The nthlayer-measure** uses them to contextualise quality shifts (was a quality drop caused by a model version change or genuine agent degradation?)
- **nthlayer-respond** uses them during investigation (what changed before the incident?)

Change events flow from sources through the streaming layer to all consumers. The schema is defined in the OpenSRM spec, and a concrete example is provided in the [README](README.md).

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

**Effort:** Write manifests, add NthLayer to your CI/CD pipeline. No infrastructure beyond what you already run (Prometheus, Grafana).

### Tier 2: Static + Correlation

**Components:** Everything in Tier 1 + nthlayer-correlate agent

**Agents involved:** nthlayer-correlate only

**What you get:**
- Everything in Tier 1
- Continuous pre-correlated operational snapshots
- 'What changed?' answers assembled before anyone asks
- AI-consumable situation reports alongside human dashboards

**Effort:** Deploy nthlayer-correlate as a long-running service. Configure webhook ingestion from Alertmanager, GitHub, ArgoCD. Provide Prometheus read access. Set up a streaming layer (NATS for small scale, Kafka for enterprise).

### Tier 3: Full Autonomous

**Components:** Everything in Tier 2 + nthlayer-respond agents + nthlayer-measure

**Agents involved:** nthlayer-correlate, Triage, Investigation, Communication, Remediation, nthlayer-measure

**What you get:**
- Everything in Tier 2
- Agent-orchestrated incident response
- Automated triage, investigation, communication, and safe remediation
- Governance layer monitoring all agent decision quality
- Autonomy adjustments based on measured performance
- Post-incident learning loop that feeds findings back into manifests, rules, and thresholds

**Effort:** Deploy nthlayer-respond orchestrator and agent processes. Define agent manifests with judgment SLOs. Configure safe action permissions in OpenSRM manifests. Deploy the nthlayer-measure.

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
- **nthlayer-correlate API:** Service accounts for nthlayer-respond agents, RBAC for humans
- **nthlayer-respond:** Agents scoped to the incident they're responding to
- **nthlayer-measure:** Read access to all judgment SLO metrics, write access to autonomy policy only
- **Decision telemetry:** Write from all agents, read for metrics aggregation
- **Remediation actions:** Pre-approved safe actions defined in OpenSRM manifests, novel actions require human approval

### Agent Authority Boundaries

No agent can escalate its own permissions. The nthlayer-measure can reduce agent autonomy (the safe direction) but cannot increase it without human approval. This is a one-way safety ratchet: automation can always be constrained, never self-expanded.

---

## Components

| Component | Category | What it does | Status | Link |
|-----------|----------|-------------|--------|------|
| **OpenSRM** | Data Source | Specification for declaring service reliability requirements | Stable (draft) | [OpenSRM](https://github.com/rsionnach/opensrm) |
| **NthLayer** | Tool | Generate monitoring infrastructure from manifests | Alpha | [nthlayer](https://github.com/rsionnach/nthlayer) |
| **nthlayer-measure** | Agent | Quality measurement and governance for AI agents | Architecture | [nthlayer-measure](https://github.com/rsionnach/nthlayer-measure) |
| **nthlayer-correlate** | Agent | Situational awareness through signal correlation | Architecture | [nthlayer-correlate](https://github.com/rsionnach/nthlayer-correlate) |
| **nthlayer-respond** | Agent | Multi-agent incident response | Architecture | [nthlayer-respond](https://github.com/rsionnach/nthlayer-respond) |

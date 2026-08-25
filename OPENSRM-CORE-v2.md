# OpenSRM — Open Service Reliability Manifest — v2-draft

**Status:** Draft for implementation
**Supersedes:** OpenSRM v1 (dev.to article, February 2026)
**Date:** 2026-04-19

---

## Delta Summary

OpenSRM v1 was specified as a self-contained format with its own SLO syntax, ownership model, contract references, and dependency notation. v2 repositions OpenSRM as a **composition of established CNCF-adjacent standards with a narrow original contribution**: the judgment SLO framework and the reliability-contract semantics.

What this changes:

| v1 (standalone) | v2 (composed) | Rationale |
|---|---|---|
| Bespoke classical SLO syntax | **OpenSLO v1 documents** embedded or referenced | OpenSLO is the existing standard; paralleling it was a mistake |
| Bespoke ownership model | **Backstage entity compatibility** via alignment with kinds and annotations | Existing Backstage catalogues can adopt OpenSRM incrementally |
| Bespoke contract references | **OpenAPI 3.1 / AsyncAPI 3.x references** | Contracts are APIs and events; reuse the existing specs |
| Bespoke change-event schema | **CloudEvents v1.0 envelope** with OTel semantic conventions on payload | CNCF-graduated, battle-tested |
| Proposed `gen_ai.decision.*` OTel conventions | **Adopt shipped `gen_ai.evaluation.result` from OTel v1.39.0** + propose `gen_ai.decision.*` upstream | Already 70% there; contribute rather than fork |
| Bespoke SLI query syntax | **OpenSLO indicator semantics** with PromQL as a supported query language | Existing standards already specify this correctly |
| Policy semantics implicit | **Rego-evaluable** where relevant (see RBAC extension) | Same substrate as RBAC extension |
| Runtime workload needs out of scope | **Score compatibility noted** as complementary pattern | Score describes workload needs, OpenSRM describes reliability contracts |

What stays original:

- The **judgment SLO framework** (reversal rate, high-confidence failure, audit sampling, outcomes, escalation, segments, stability, calibration) — this is the novel contribution and nobody else owns it
- The **reliability contract** as a first-class cross-service promise
- The **dependency-with-expected-guarantees** relationship model
- The **template inheritance** mechanism for scaling manifest authorship

The positioning shift from "OpenSRM is a new spec" to "OpenSRM composes existing specs with a focused original contribution" is deliberate. It makes adoption easier, reduces the bar for CNCF Sandbox submission, and is more honest about where the novelty actually lies.

---

## 1. Introduction

OpenSRM (Open Service Reliability Manifest) is a specification for declaring a service's reliability as code. A manifest captures the service's identity and ownership, its reliability targets (classical SLOs and, for AI-inflected services, judgment SLOs), its external reliability contracts, its dependencies with expected guarantees, and the instrumentation required to observe those guarantees.

OpenSRM is designed as a **composition layer** over existing CNCF-adjacent standards rather than a replacement for them. It borrows entity semantics from Backstage, SLO semantics from OpenSLO, event semantics from CloudEvents and OpenTelemetry, API contract references from OpenAPI and AsyncAPI, and policy-evaluable preconditions (for the authorisation extension) from Rego.

The original contributions are:

1. **Judgment SLOs** — reliability targets specifically shaped for services that make consequential decisions (human-consequential classifications, credit decisions, content moderation, safety gates, and especially AI agent decisions). Classical SLOs measure whether the service is up and fast; judgment SLOs measure whether its decisions are sound.
2. **Reliability contracts** — first-class declarations of what reliability a service promises to its callers, separate from its own internal SLOs, with explicit semantics for what happens when the contract is broken.
3. **Dependencies with expected guarantees** — a service declares not just that it depends on another service, but what reliability it expects from that dependency. When expectations diverge from reality, this is a correlation signal.
4. **Template inheritance** — an ergonomic mechanism for scaling manifest authorship across tens or hundreds of services in an organisation.

## 2. Relationship to Other Standards

Before specifying OpenSRM, it's useful to map its relationship to adjacent standards clearly. OpenSRM composes these; it does not replace them.

### 2.1 OpenSLO

**Role:** Classical SLOs (availability, latency, error rate, throughput).
**Integration:** An OpenSRM manifest either embeds `kind: SLO` documents inline or references external OpenSLO documents by URI. OpenSRM's `slo` block is syntactically an OpenSLO v1 document list.

### 2.2 Backstage

**Role:** Entity model (Component, API, System, Domain, Resource, Group, User).
**Integration:** OpenSRM manifests live alongside Backstage catalogues. A Backstage `Component` entity can reference an OpenSRM manifest via an annotation (`opensrm.nthlayer.io/manifest`). An OpenSRM manifest can reference Backstage entities for ownership (`owner: group:default/sre-team`). Where both are present, ownership lives in Backstage and reliability intent lives in OpenSRM.

### 2.3 OpenAPI 3.1 and AsyncAPI 3.x

**Role:** API and event contracts.
**Integration:** An OpenSRM `contracts` block references existing OpenAPI/AsyncAPI documents and overlays reliability expectations on specific operations (`operationId` for OpenAPI, channel/operation for AsyncAPI).

### 2.4 CloudEvents and OpenTelemetry

**Role:** Event envelope and decision telemetry.
**Integration:** OpenSRM's change events, decision records, and telemetry emissions use CloudEvents v1.0 envelopes with OTel semantic convention attributes on the payload. The `gen_ai.evaluation.result` event (shipped in OTel semconv v1.39.0) is the substrate for judgment-SLO outcome reporting. The `gen_ai.decision.*` subset is proposed upstream.

### 2.5 Score

**Role:** Workload runtime needs (images, resources, infrastructure dependencies).
**Integration:** Complementary. Score describes *what the service needs to run*; OpenSRM describes *what reliability it promises and expects*. A service can have both a `score.yaml` and an OpenSRM manifest; they don't overlap.

### 2.6 Rego

**Role:** Policy evaluation (for the RBAC extension and for precondition checks).
**Integration:** See RBAC extension v1.1. Not part of OpenSRM core, but OpenSRM's extensions build on Rego.

## 3. Manifest Structure

An OpenSRM manifest is a YAML document with the following top-level shape:

```yaml
apiVersion: opensrm.nthlayer.io/v2
kind: ServiceManifest
metadata:
  name: payment-service
  namespace: default
  annotations:
    # Optional Backstage entity reference
    backstage.io/component-ref: "component:default/payment-service"
  labels:
    domain: payments
    tier: critical
spec:
  # Ownership — references Backstage entities where possible
  owner:
    group: "group:default/sre-payments"
    escalation: "group:default/sre-on-call"
    technical_contact: "user:default/jane.doe"

  # Service identity
  service:
    name: payment-service
    type: ai-gate                                  # Required — see §3.1
    description: "Processes payment authorisation and capture for consumer transactions"

  # Classical SLOs — OpenSLO v1 documents
  slo:
    - $ref: "./slos/payment-availability.yaml"    # External reference
    - <inline OpenSLO document>                    # Or inline

  # Judgment SLOs — OpenSRM's original contribution (see §5)
  judgment_slo:
    - <see §5 for full schema>

  # Reliability contracts — what this service promises to callers (see §6)
  contracts:
    - <see §6>

  # Dependencies with expected guarantees (see §7)
  dependencies:
    - <see §7>

  # Instrumentation requirements (see §8)
  instrumentation:
    <see §8>

  # Optional template references (see §9)
  template:
    extends: "template:default/payment-services-base"
```

The manifest uses Backstage's `apiVersion/kind/metadata/spec` envelope shape. This is deliberate: any Backstage catalogue can treat OpenSRM manifests as additional entity kinds with no parsing infrastructure changes.

### 3.1 Service types

`spec.service.type` records the service's operational pattern. It is **required**.

An implementation MUST accept these six values:

| Type | Meaning |
|---|---|
| `api` | Synchronously called; callers depend on a latency and availability promise |
| `worker` | Processes queued work; nothing calls it synchronously |
| `stream` | Consumes an event stream; measured on lag and throughput |
| `ai-gate` | Makes decisions whose quality is measurable — the judgment SLO archetype |
| `batch` | Runs on a schedule; measured on completion and freshness |
| `database` | Stateful store; measured on query latency and replication |

`ai-gate` denotes decision-making, not AI implementation. A service qualifies because its output is a consequential classification, decision, or action whose quality can be measured — whether that output comes from a model, a rule engine, or a human approver (§5). A purely rule-based or human-in-the-loop approval service that wants judgment SLOs declares `type: ai-gate`.

An implementation MAY define additional types under the reserved `x-` prefix, matching `^x-[a-z][a-z0-9-]*$`. Implementations MUST NOT define additional bare types — a type that is neither one of the six nor `x-` prefixed MUST be rejected. This keeps an implementation-specific type valid under OpenSRM without OpenSRM adopting it.

Type-conditional validation, restoring the v1 rule:

- A manifest whose `spec.service.type` is not `ai-gate` MUST NOT declare `spec.judgment_slo`. Judgment SLOs measure decision quality and are only meaningful for a service that makes decisions. The key itself is what is forbidden: an empty `spec.judgment_slo: []` counts as declaring it and MUST be rejected. A tool that emits empty collections by default MUST omit the key on a non-`ai-gate` manifest. The rule follows the judgment SLO rather than the file it lives in: a standalone `kind: JudgmentSLO` document MUST NOT name a non-`ai-gate` service in its `spec.service`, and an implementation that resolves standalone judgment SLOs against the catalogue MUST enforce this at load time. Schema validation alone cannot — the two documents are validated separately, and neither can see the other.
- An `ai-gate` service MAY declare judgment SLOs but is not required to. A service may adopt the type before its judgment SLOs are authored.
- The restriction is to `ai-gate` alone, not to decision services generally: an `x-` type MUST NOT declare judgment SLOs either. An implementation whose decision services want them declares `ai-gate` — which, per the paragraph above, is about what the service does and not how it is built.

`type` is not inheritable. A `ServiceManifestTemplate` MUST NOT declare `spec.service.type`, and an extending manifest MUST declare its own. Were a template permitted one, a template typed `ai-gate` carrying judgment SLOs and a manifest typed `worker` extending it would both validate alone, and the resolved manifest's verdict would depend on whose value an implementation kept — the same two files accepted by one conformant implementation and rejected by another.

Because template resolution happens at load time rather than during schema validation, a template carrying `judgment_slo` could otherwise supply them to a manifest of any type. An implementation MUST therefore revalidate the fully resolved manifest, after template expansion, against the same rules (§9, §13).

## 4. Classical SLOs (via OpenSLO)

### 4.1 Embedded or referenced

The `slo` block is a list of OpenSLO v1 `kind: SLO` documents. They can be inline or referenced externally:

```yaml
slo:
  - $ref: "./slos/payment-availability.yaml"
  - apiVersion: openslo/v1
    kind: SLO
    metadata:
      name: payment-latency-p99
    spec:
      service: payment-service
      indicator:
        metadata:
          name: latency-p99
        spec:
          ratioMetric:
            counter: true
            total:
              metricSource:
                type: Prometheus
                spec:
                  query: 'rate(http_requests_total{service="payment-service"}[5m])'
            good:
              metricSource:
                type: Prometheus
                spec:
                  query: 'rate(http_request_duration_seconds_bucket{service="payment-service",le="0.5"}[5m])'
      objectives:
        - displayName: "99% under 500ms"
          target: 0.99
```

### 4.2 Extension via annotations

OpenSLO explicitly permits extensions in specific subtrees. OpenSRM extends OpenSLO through:

- `metadata.annotations.opensrm.nthlayer.io/*` for OpenSRM-specific metadata (e.g., contract links, judgment-SLO cross-references)
- Free-form fields inside `indicator.spec.*` subtrees that OpenSLO sanctions
- Sibling `kind: JudgmentSLO` documents (see §5) for things that don't fit OpenSLO at all

This is the pattern Sumo Logic's slogen has used for log-query fields and multi-burn-rate alerts. OpenSRM follows the same playbook.

### 4.3 Compiler requirements

OpenSRM is a specification. It does not prescribe a compiler. However, any OpenSRM compiler SHOULD produce observability artifacts that correctly implement the declared reliability targets. For classical SLOs expressed as OpenSLO documents, this means generating recording and alerting rules that correctly implement multi-window multi-burn-rate alerting as described in Google's SRE methodology.

A compliant compiler must preserve semantic equivalence between the manifest's declared SLOs and the generated artifacts. Compilers may target different observability backends (Prometheus, Mimir, Thanos, Cortex, or others) and may implement generation through different strategies (direct translation, delegation to an external tool, or a compilation pipeline). These are implementation choices outside the scope of this specification.

**Reference implementation.** nthlayer-generate is the reference compiler for the NthLayer ecosystem. Its implementation, its dependencies, and its output formats are documented separately. Conformance to OpenSRM does not require using nthlayer-generate; any compiler producing semantically equivalent artifacts conforms.

### 4.4 Validation requirements

A compliant OpenSRM implementation MUST validate manifests at load time. The specific validations required:

- **OpenSLO conformance.** Embedded and referenced `kind: SLO` documents must conform to the OpenSLO v1 schema.
- **PromQL syntactic validity.** Where an SLO's indicator references a PromQL query, the query must parse successfully.
- **Cross-reference resolution.** Services referenced in dependencies must exist in the catalogue; contract references must resolve; template references must resolve; owner references must be valid (against Backstage where integrated, or against the local catalogue otherwise).
- **JSON Schema conformance.** The manifest as a whole must conform to the OpenSRM JSON Schema (§16).

Invalid manifests MUST fail at validation time rather than producing partial or unsafe outputs.

The specific libraries and tools used to implement these validations are an implementation concern, not a specification concern.

## 5. Judgment SLOs (OpenSRM's original contribution)

Judgment SLOs measure whether a service's decisions are sound. They apply to any service making consequential classifications, decisions, or actions — including AI agents, ML classifiers, rule-based decision systems, and human-in-the-loop approval services.

The framework is the **primary original contribution of OpenSRM**. Nobody else specifies this.

### 5.1 Kind

Judgment SLOs use a sibling kind to OpenSLO:

```yaml
apiVersion: opensrm.nthlayer.io/v2
kind: JudgmentSLO
metadata:
  name: triage-agent-reversal-rate
  namespace: default
spec:
  service: triage-agent
  judgment_type: reversal_rate  # see §5.2
  # ... type-specific fields
```

Judgment SLO documents can be embedded in a service manifest's `judgment_slo` block or referenced externally.

### 5.2 Judgment SLO types

Eight types are specified as the core vocabulary. Organisations can define additional types under their own `apiVersion`; conformant implementations MUST support the eight standard types and MAY support additional types.

#### 5.2.1 Reversal rate

Tracks how often a decision is reversed (by a human, by the same service on reconsideration, or by downstream feedback).

```yaml
spec:
  service: triage-agent
  judgment_type: reversal_rate
  measurement:
    window: 7d
    source: lineage                    # lineage | calibration_sample | downstream_signal
  target:
    maximum_reversal_rate: 0.05        # 5% of decisions reversed is tolerable
  breach_actions:
    - notify: "group:default/sre-payments"
    - create_case: { priority: P2 }
```

#### 5.2.2 High-confidence failure rate

Tracks how often decisions the service expressed high confidence in turn out wrong. This is often a sharper signal than overall accuracy because high-confidence failures indicate calibration problems.

```yaml
spec:
  service: investigation-agent
  judgment_type: high_confidence_failure
  measurement:
    confidence_threshold: 0.9
    window: 30d
  target:
    maximum_failure_rate: 0.02         # 2% of high-confidence decisions wrong
```

#### 5.2.3 Audit sampling

Specifies sampling rates for human audit of decisions, with stratification by confidence, segment, or decision type.

```yaml
spec:
  service: moderation-agent
  judgment_type: audit_sampling
  sampling:
    overall_rate: 0.01
    stratified:
      - segment: "high_stakes"
        rate: 0.1
      - segment: "low_confidence"
        rate: 0.25
  target:
    audit_backlog_maximum_age: 24h     # audits completed within 24h
    audit_completion_rate: 0.95
```

#### 5.2.4 Outcomes

Tracks whether decisions produced intended outcomes, where outcomes are resolvable via downstream signals.

```yaml
spec:
  service: remediation-agent
  judgment_type: outcomes
  outcome_signal:
    source: <consumer-defined>         # e.g. a retrospective-analysis consumer
    window: 1h                         # how long after decision to wait for outcome
  target:
    desired_outcome_rate: 0.9          # 90% of decisions produced desired outcome
```

#### 5.2.5 Escalation

Tracks how often decisions escalate to human review, and whether escalations resolve correctly.

```yaml
spec:
  service: triage-agent
  judgment_type: escalation
  target:
    maximum_escalation_rate: 0.15      # no more than 15% of decisions escalate
    escalation_human_agreement_rate: 0.8  # humans agree with escalation 80% of the time
```

#### 5.2.6 Segments

Tracks that SLO performance is consistent across meaningful segments (customer tiers, geographies, request types). A service with 95% accuracy overall but 60% accuracy on a specific segment has a segment problem that overall SLOs hide.

```yaml
spec:
  service: credit-decision-agent
  judgment_type: segments
  segment_dimension: customer_tier
  segment_values: [enterprise, smb, consumer]
  target:
    maximum_variance_from_overall: 0.05  # no segment more than 5% below overall
```

#### 5.2.7 Stability

Tracks that the service produces consistent decisions for equivalent inputs over time. A service whose decisions drift with model updates, prompt changes, or upstream data changes has a stability problem.

```yaml
spec:
  service: content-classifier
  judgment_type: stability
  probe:
    frozen_input_set: "s3://probes/content-classifier-2026q1.jsonl"
    frequency: daily
  target:
    maximum_drift: 0.02                # decisions on the probe set change at most 2% per measurement
```

#### 5.2.8 Calibration

Tracks that expressed confidence matches actual accuracy. If the service says it's 80% confident, does it get 80% of those decisions right?

```yaml
spec:
  service: investigation-agent
  judgment_type: calibration
  measurement:
    bins: 10                           # 0.0-0.1, 0.1-0.2, ..., 0.9-1.0
    window: 30d
    method: brier_score                # or expected_calibration_error
  target:
    maximum_brier_score: 0.05
```

### 5.3 Statistical requirements

Judgment-SLO evaluation relies on established statistical methods, not bespoke formulas. A conformant implementation MUST compute:

- **Calibration metrics** using accepted methods such as Brier score or expected calibration error, binned over the specified measurement window
- **Confidence intervals** around reversal-rate and outcome-rate estimates, with interval width appropriate to the sample size
- **Segment-variance statistics** for judgment SLOs with segment dimensions, using hypothesis tests appropriate to the segment distribution
- **Cohort retention analysis** for reversal rate and outcomes, tracking decisions from emission through resolution

The wire format for judgment-SLO outcomes is the OTel `gen_ai.evaluation.result` event (OTel semconv v1.39.0+), extended with the `nthlayer.decision.*` attributes described in §11.3.

The specific mathematical libraries used to implement these computations are an implementation concern.

### 5.4 Breach actions

Judgment-SLO breaches produce structured events that consumers (observability platforms, incident-management systems, authorisation systems) can react to. The breach-action declaration is:

```yaml
breach_actions:
  - notify: <recipient>                # notification to an operator or team
  - create_case:                       # case for human attention in a consumer UI
      priority: P0|P1|P2|P3
      template: <template_ref>
  - reduce_autonomy:                   # for services making autonomous decisions
      agent: <agent_id>
      new_autonomy_level: <level>
  - action_request:                    # automatic remediation request
      action_id: <action>
      parameters: {...}
```

How these actions are dispatched — which consumer handles which action type, what the notification mechanism is, how cases are rendered — is a consumer concern, not an OpenSRM concern. The spec describes what the manifest *declares*; consumers decide what to *do* with the declaration.

## 6. Reliability Contracts (OpenSRM's original contribution)

A reliability contract is a first-class cross-service promise. A service declares what reliability it offers to its callers; its callers declare what they expect from it (in the `dependencies` block, §7). When these converge, the system is healthy. When they diverge, an OpenSRM consumer can surface the divergence as a correlation signal.

### 6.1 Shape

```yaml
contracts:
  - name: payment-authorisation-api
    # What API this contract applies to
    api_ref:
      openapi: "./api/payment-api.yaml"
      operation_id: "authorise"
    # What reliability we promise
    promise:
      availability: 0.999
      latency_p99: 500ms
      throughput: 10000rps
    # Conditions under which the promise applies
    conditions:
      - "Callers authenticate with valid API key"
      - "Request body conforms to OpenAPI schema"
    # What happens when the contract breaks
    breach_semantics:
      consumer_notification: "webhook:https://..."
      compensation:
        description: "Free retries for affected requests"
      sla_credits:
        enabled: true
        calculation_ref: "./sla-credits.yaml"
    # Who owns the contract
    contract_owner: "group:default/payments-platform"
```

### 6.2 Contract evaluation

An OpenSRM consumer that evaluates contracts at runtime should:

- Read the contract's `promise` (e.g., "availability 99.9%")
- Compute the actual reliability from the underlying SLO indicator
- Compare: if actual < promised for the measurement window, emit a `contract_breach` event
- Trigger `breach_semantics` (notify consumer, record for SLA credits, open a case)

The specific implementation — which component evaluates, what polling cadence is used, what event format is emitted — is a consumer concern. The spec defines the declaration, not the evaluator.

### 6.3 Relationship to classical SLOs

Contracts reference classical SLOs but aren't the same thing. A classical SLO is an internal reliability target; a contract is an external promise. A service might have an internal availability SLO of 99.95% (the target for internal operations) and a contract with customers promising 99.9% (the externally-promised level). The gap is the service's own error budget for internal issues that don't surface externally.

Contracts are always tied to a specific API operation (OpenAPI or AsyncAPI), not to the service as a whole. A payment service might have a high-reliability contract on its `authorise` operation and a lower-reliability contract on its `list_historical_transactions` operation.

### 6.4 Contract references

Contracts can be referenced by ID across the ecosystem:

```yaml
contract_ref: "contract:payments/payment-authorisation-api"
```

Dependencies (§7) use these references to declare expected guarantees.

## 7. Dependencies with Expected Guarantees (OpenSRM's original contribution)

The `dependencies` block declares that this service depends on other services and what reliability it expects from them.

```yaml
dependencies:
  - service: "component:default/fraud-detection"
    contract_ref: "contract:fraud/fraud-check-api"
    expected_availability: 0.995
    expected_latency_p99: 100ms
    fallback:
      type: "graceful_degradation"
      description: "Proceed with reduced fraud confidence if fraud-detection unavailable"
```

### 7.1 Expectation divergence

When observed reliability of a dependency diverges from its declared contract or from the caller's expectations, this is a correlation signal. An OpenSRM consumer that performs correlation analysis should flag at least:

- **Expectations below contract**: caller expects less than dependency promises — probably fine, but worth surfacing (you might be getting lucky)
- **Expectations above contract**: caller expects more than dependency promises — architectural issue, the caller is exposed
- **Contract breach**: dependency isn't meeting its promise — the caller is at risk
- **Runtime divergence**: observed reliability doesn't match declared contract — something has changed

### 7.2 Topology drift

Dependencies declared in the manifest form the **declared topology**. The **observed topology** comes from runtime observation (for example, from OTel servicegraph connector metrics). Drift between these is a correlation signal:

- **Declared but not observed**: manifest says we depend on X, but no traffic is seen
- **Observed but not declared**: traffic flows to Y, but manifest doesn't mention it

Both are candidates for surfacing by a correlation-capable consumer. Declared-but-not-observed might mean dead code; observed-but-not-declared might mean undocumented dependencies creating risk.

### 7.3 Fallback declarations

Fallback declarations document what the service does when a dependency fails. This is both useful documentation (for humans) and usable by correlation engines to reason about blast radius.

## 8. Instrumentation Requirements

The `instrumentation` block declares what observability the service must emit for the manifest's SLOs and judgment SLOs to be computable.

```yaml
instrumentation:
  required_metrics:
    - name: http_requests_total
      type: counter
      labels: [method, path, status]
    - name: http_request_duration_seconds
      type: histogram
      labels: [method, path]
  required_traces:
    - span_name: "payment.authorise"
      required_attributes: [payment.amount, payment.currency, customer.id]
  required_logs:
    - format: structured
      required_fields: [timestamp, level, service, trace_id]
  required_events:
    # For judgment-SLO-bearing services
    - type: "io.nthlayer.decision.v1"
      schema_ref: "gen_ai.evaluation.result"  # OTel semconv reference
```

This serves two purposes. First, it's a checklist for service owners ("here's what you need to emit for your SLOs to work"). Second, it's verifiable — CI can check that the service actually emits the declared instrumentation.

## 9. Template Inheritance

For organisations with many services, writing a full manifest per service is tedious. Templates let you extract common patterns:

```yaml
# templates/payment-services-base.yaml
apiVersion: opensrm.nthlayer.io/v2
kind: ServiceManifestTemplate
metadata:
  name: payment-services-base
spec:
  slo:
    - $ref: "./slos/baseline-availability.yaml"
  contracts: []
  instrumentation:
    required_metrics: [...]
```

A manifest can extend a template:

```yaml
apiVersion: opensrm.nthlayer.io/v2
kind: ServiceManifest
metadata:
  name: payment-service
spec:
  template:
    extends: "template:default/payment-services-base"
    overrides:
      slo:
        - append: ["./slos/payment-latency-p99.yaml"]
```

Template resolution happens at load time and produces a fully-expanded manifest. Templates themselves may not have templates (one level of inheritance) to avoid unbounded resolution complexity.

## 10. Change Events

OpenSRM manifests change. When they do, a conformant implementation MUST emit a change event so downstream consumers can react.

### 10.1 Format

Change events use **CloudEvents v1.0 envelope** with OpenSRM-specific payload:

```json
{
  "specversion": "1.0",
  "type": "io.nthlayer.opensrm.manifest.changed.v1",
  "source": "urn:opensrm:catalogue:production",
  "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "time": "2026-04-19T09:32:15Z",
  "datacontenttype": "application/json",
  "subject": "component:default/payment-service",

  "data": {
    "manifest_cid_before": "bafyrei...old",
    "manifest_cid_after": "bafyrei...new",
    "change_type": "slo_modified | judgment_slo_added | dependency_changed | ...",
    "changed_by": "user:default/jane.doe",
    "commit_ref": "git:abc123..."
  }
}
```

### 10.2 Consumers

Any OpenSRM consumer that holds manifest-derived state needs to react to change events. Typical reactions:

- **SLO evaluation consumers** — reload SLO targets when manifest changes
- **Judgment-SLO evaluation consumers** — reload judgment-SLO targets
- **Authorisation consumers** — reload action declarations and preconditions
- **Correlation consumers** — reload topology

The specific components handling these reactions depend on the deployment. The spec requires only that change events are emitted; how they are consumed is out of scope.

### 10.3 Propagation

How change events are propagated from producer to consumers is a deployment concern. Common patterns include polling a shared store, subscribing to a message bus, or consuming a webhook feed. The spec requires only that the events conform to §10.1; the transport is unspecified.

## 11. Semantic Conventions (for telemetry)

OpenSRM-instrumented services emit telemetry following OpenTelemetry semantic conventions. The specific conventions:

### 11.1 Classical SLO telemetry

Standard OTel conventions apply. HTTP services use `http.*` attributes; RPC services use `rpc.*`; messaging uses `messaging.*`. No OpenSRM-specific extensions.

### 11.2 Judgment SLO telemetry

For services with judgment SLOs, decisions emit `gen_ai.evaluation.result` events (OTel semconv v1.39.0+):

```
Attributes:
  gen_ai.system: "triage-agent"
  gen_ai.evaluation.name: "incident_triage"
  gen_ai.evaluation.score.value: 0.87     # confidence
  gen_ai.evaluation.score.label: "high"
  gen_ai.evaluation.explanation: "Pattern matches known cascade failure"
  gen_ai.response.id: "bafyrei...cid"
```

### 11.3 Proposed decision-specific conventions

OpenSRM needs a few additional attributes that the current OTel semconv doesn't cover. These are emitted under the `nthlayer.decision.*` namespace pending upstream adoption as `gen_ai.decision.*`:

```
nthlayer.decision.type: "triage | investigate | remediate | approve"
nthlayer.decision.reversible: true | false
nthlayer.decision.autonomous: true | false       # was this executed without human approval
nthlayer.decision.reversal_of: "bafyrei...parent"  # if this decision reverses a prior one
```

These are candidates for upstream contribution to the OTel GenAI SIG as `gen_ai.decision.*`.

## 12. Migration from v1

Organisations running OpenSRM v1:

1. **Move classical SLOs to OpenSLO documents.** v1 SLO syntax maps 1:1 to OpenSLO v1. A migration tool produces OpenSLO documents from v1 manifests.
2. **Adopt Backstage entity references if Backstage is deployed.** Otherwise the v1 ownership model continues to work via `owner:` strings.
3. **Move API contract references to OpenAPI/AsyncAPI documents.** v1 bespoke contract references need to be rewritten.
4. **Retain judgment SLOs unchanged.** The judgment SLO framework is OpenSRM's original contribution; v2 formalises what v1 described informally.
5. **Adopt CloudEvents envelopes for change events.** If v1 emitted custom change events, they move under the CloudEvents envelope.
6. **Move `spec.type` to `spec.service.type`.** v1's service type moves onto the identity block and stays required, with the same six values `spec/v1/schema.json` already enumerates — v1's prose tabulated only four of them (`spec/v1/specification.md` §3.1). The field did not disappear in v2; it moved.

   It is not, however, a pure relocation. v1's prose marked `spec.type` a MUST, but the shipped `spec/v1/schema.json` left it optional, and v1 manifests exist that omit it. A migration tool must therefore prompt for the type, or apply a documented default, whenever the source manifest has none — the v2 field is required and has no fallback.

   On a `ServiceManifestTemplate`, delete `spec.type` outright rather than relocating it — templates MUST NOT declare a type (§3.1), so a mechanical relocation produces a document the schema rejects.

   Delete the old locations as you go. A manifest carrying both `spec.type` and `spec.service.type`, or carrying a `metadata.labels.type` alongside it, validates — the schema does not police either — and leaves two discriminators with no precedence rule between them. Implementations that read a label to recover the type before this field existed must be migrated to `spec.service.type` rather than left to disagree with it.

## 13. Conformance

An OpenSRM v2 implementation MUST:

- Parse manifests conforming to the JSON Schema in §16
- Validate embedded and referenced OpenSLO documents against the OpenSLO v1 schema
- Validate PromQL queries referenced in SLI definitions for syntactic correctness
- Resolve cross-references (dependencies, contracts, templates, owners) and fail load on unresolvable references
- Generate change events as CloudEvents v1.0 envelopes when manifests change
- Support template resolution (§9)
- Revalidate the fully resolved manifest after template expansion, so type-conditional rules (§3.1) cannot be bypassed by a template
- Enforce the same type-conditional rules on standalone `kind: JudgmentSLO` documents when binding them to the service each names, so the rules cannot be bypassed by moving a judgment SLO into a second file

An implementation SHOULD:

- Validate dependency and contract references against the resolved catalogue
- Emit `gen_ai.evaluation.result` events for judgment-SLO outcomes
- Integrate with a Backstage catalogue where one is deployed
- Produce observability artifacts (recording rules, alerting rules, dashboards) that preserve semantic equivalence with the declared SLOs

An implementation MAY:

- Extend judgment SLO types beyond the eight standards under its own `apiVersion`
- Add custom annotations under reserved namespaces
- Target any observability backend capable of representing the declared SLOs
- Adopt the `nthlayer.decision.*` attributes described in §11.3 pending upstream standardisation

The specific libraries, parsers, validators, and generation tools used to meet these conformance requirements are an implementation concern. The spec describes *what* must be true; it does not prescribe *how*.

## 14. Positioning for CNCF Sandbox

Because OpenSRM v2 composes existing CNCF-adjacent standards with a narrow original contribution, the CNCF Sandbox submission is cleaner than a standalone spec would be:

- Builds on **OpenSLO** (incubating) — extending rather than replacing
- Aligns with **Backstage** (incubating) — complementary entity model
- Adopts **CloudEvents** (graduated) and **OpenTelemetry** (graduated) semantic conventions
- Uses **Rego/OPA** (graduated) for policy evaluation in the extension layer
- Complementary to **Score** (incubating) — different concern

The submission narrative is "OpenSRM is the missing composition layer between existing reliability standards, with an original contribution (judgment SLOs) for the AI-inflected services that none of the existing standards cover." This is easier to argue for than a standalone spec.

## 15. Open Questions

- **Judgment SLO type extensibility.** The eight standard types may not cover all real-world needs. Should there be a formal extension mechanism (new types registered with a TC), or should organisations just use custom `apiVersion` values?
- **Contract breach credits.** The `sla_credits` block references an external calculation document. Is that enough, or should OpenSRM specify a contract-breach credit semantics?
- **Template composition.** One level of template inheritance is simple; some organisations may want more. Is the single-level limit acceptable?
- **Multi-cluster manifests.** A service deployed to multiple clusters/regions may have different reliability characteristics per cluster. Does the manifest model need to extend for this, or do we just recommend per-cluster manifests?

## 16. References

**This specification's machine-readable schema.** The JSON Schema (draft-07)
that validates OpenSRM v2 manifests — referenced by §4.4 and §13 — lives at
[`spec/v2/schema.json`](spec/v2/schema.json). See
[`spec/v2/README.md`](spec/v2/README.md) for what it validates, worked example
manifests (one per judgment-SLO type), and how to run validation.

### 16.1 Normative

Specifications this document composes with or depends on:

- OpenSLO v1: https://openslo.com/
- Backstage entity model: https://backstage.io/docs/features/software-catalog/descriptor-format/
- CloudEvents v1.0: https://cloudevents.io/
- OpenAPI 3.1: https://spec.openapis.org/oas/v3.1.0
- AsyncAPI 3.x: https://www.asyncapi.com/docs/reference/specification/v3.0.0
- OpenTelemetry GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- RFC 2119: Key words for use in RFCs

### 16.2 Informative

Adjacent specifications relevant to OpenSRM's positioning:

- Score: https://score.dev/
- OpenSRM RBAC Extension v1.1 (authorisation layer)

### 16.3 Non-normative implementation notes

The OpenSRM specification does not prescribe specific tooling. Readers looking for existing OSS projects that may be useful when building an OpenSRM implementation — SLO rule generators, PromQL parsers, OpenSLO validators, policy engines, capability-token libraries — should consult the companion "OSS Delegation Strategy" document published separately by the NthLayer reference-implementation team. That document is explicitly not part of this specification.

## 17. Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1 | 2026-02 | Initial standalone spec (dev.to article) |
| 2-draft | 2026-04-19 | Repositioned as composition of CNCF-adjacent standards with narrow original contribution (judgment SLOs, reliability contracts, dependencies-with-expected-guarantees). Classical SLOs now use OpenSLO v1 documents; ownership aligns with Backstage entity refs; contracts reference OpenAPI/AsyncAPI documents; change events use CloudEvents v1.0 envelopes; telemetry uses OTel `gen_ai.*` conventions. Implementation-specific references (particular compilers, libraries, or validators) removed from normative text per the specification/tooling separation principle. |

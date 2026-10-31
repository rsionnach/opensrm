# OpenSRM v2 — Addendum A1: Telemetry Binding and Decision Telemetry Errata

**Status:** Draft for review
**Applies to:** `OPENSRM-CORE-v2.md` (v2-draft, 2026-08-25); `conventions/decision-telemetry/`
**Date:** 2026-10-21
**Supersedes:** `OPENSRM-CORE-v2.md` §11.2 and §11.3 in their entirety; amends §2.4, §5.3, §8, §13, §16.1

---

## Summary

Model providers now emit OpenTelemetry spans for every model request, tool use and agent turn, using the GenAI semantic conventions. Anthropic's Claude Platform is the first to do so from the API side with no application instrumentation. These spans carry every identity, provenance and mechanics attribute an OpenSRM implementation needs, and no judgment attribute at all.

This addendum does four things:

1. **Binds OpenSRM to provider-emitted spans.** It specifies which judgment-SLO inputs MAY be taken from `gen_ai.*` spans, which MUST come from the application, and which are admissible only as grader opinion. The binding is provider-neutral; §7 adds a profile for Claude Platform.
2. **Consolidates the decision telemetry vocabulary.** The repository currently carries four overlapping sets (`nthlayer.decision.*` in core §11.3; `gen_ai.{decision,reversal,outcome}.*` in `conventions/`; the SitRep appendix's extensions; `gen_ai.override.*` in `ARCHITECTURE.md`). This addendum reduces them to one family of three application-emitted events, and repositions `gen_ai.evaluation.result` as the grader event it is upstream.
3. **Corrects three collisions with the upstream conventions**: `gen_ai.system` (removed upstream), `gen_ai.response.id` (upstream: the provider's completion id, not a decision CID), and `gen_ai.evaluation.score.value` (upstream: an evaluator's score, not a decision's confidence).
4. **Adds one additive schema field**, `instrumentation.required_traces[].emitted_by`, so a manifest can declare a span the provider emits rather than the application.

Nothing in this addendum adds a judgment SLO type, a threshold type or an evaluation rule. §5 of the core spec is untouched.

---

## 1. Scope

This addendum is normative for OpenSRM v2 implementations that consume OpenTelemetry telemetry from a model provider, an agent runtime, or an application's own GenAI instrumentation. Where an implementation consumes none of these, only §4 (vocabulary), §5 (provenance) and §9 (errata) apply.

The GenAI semantic conventions are in Development status upstream and attribute names can change. This addendum pins the conventions at the commit named in §11 and will be revised when the upstream names move.

## 2. Terminology

- **Decision record.** The application-emitted statement that a decision was made: what was decided, with what confidence, by which gate. Carried as the `nthlayer.decision` event (§4.1). The decision record is the unit a judgment SLO counts.
- **Reversal record.** The application-emitted statement that a prior decision was overturned (§4.2).
- **Outcome record.** The application-emitted statement of ground truth for a prior decision (§4.3).
- **Grader evaluation.** A `gen_ai.evaluation.result` event: an evaluator's opinion of a completion. The evaluator may be a human auditor, the implementation's own grader, or the provider's. It is an opinion, not ground truth (§4.4).
- **Provider span.** A span emitted by a model provider or agent runtime for a model request, tool use, turn or session, following the GenAI conventions.
- **Provenance.** The link from a decision record to the model request that produced it: W3C trace context and the provider's response id.
- **Lineage.** The chain of decision, reversal and outcome records about one decision, keyed on `nthlayer.decision.id`.

## 3. Admissibility

Every telemetry signal an implementation consumes falls in exactly one class. The class decides what the signal MAY be used for.

| Class | Signals | Admissible for | Never admissible for |
|---|---|---|---|
| **Authoritative** | `nthlayer.decision`, `nthlayer.reversal`, `nthlayer.outcome` events emitted by the application | Every judgment SLO numerator and denominator; every judgment threshold | — |
| **Corroborating** | Provider spans and their attributes | Provenance; lineage *discovery*; stability partitioning; classical SLIs for internal SLOs (§4 core); cost; audit content | Any judgment SLO count; contract breach evidence (§6 core) |
| **Grader** | `gen_ai.evaluation.result` events, from any evaluator | `measurement.source: calibration_sample`; audit sampling evidence; calibration thresholds | `measurement.source: lineage`; `downstream_signal`; the `outcomes` judgment SLO |

Rules:

- **A1.** An implementation MUST classify each consumed signal by the table above and MUST NOT promote a signal across classes. In particular a provider span MUST NOT be counted as a decision, and a grader evaluation MUST NOT be counted as an outcome.
- **A2.** A judgment SLO on an `ai-gate` service is computable only from authoritative records. A service that emits provider spans and no decision records has no computable judgment SLOs; an implementation MUST report this as *not evaluable* (§5.5.6 E3 core), not as within bounds.
- **A3.** Provider spans are delivered best-effort, can be lost, duplicated, or left unsampled by the caller. An implementation MUST NOT use them as the sole evidence of a contract breach (§6 core) or as the basis for SLA credits. It MAY use them for internal SLOs (§4 core) and MUST deduplicate by trace id and span id before counting.
- **A4.** A grader evaluation whose evaluator is the same provider that served the evaluated completion is *self-grading*. An implementation MUST record the evaluator identity (§4.4) and MUST be able to report self-graded samples separately from independently graded ones.

## 4. Decision telemetry vocabulary (normative)

### 4.0 Namespace rule

Three events are application-emitted and carry OpenSRM-defined attributes. On the wire they use the `nthlayer.` prefix. The `gen_ai.`-prefixed forms in `conventions/decision-telemetry/` are the upstream proposal and have identical suffixes; they are not emitted until the upstream conventions accept them, at which point a revision of this addendum specifies the rename. An implementation MUST emit the `nthlayer.` forms and MUST NOT emit the `gen_ai.` forms.

The fourth event, `gen_ai.evaluation.result`, is the upstream event and is emitted as defined upstream, with one OpenSRM attribute added to link it to a decision.

All four events are OpenTelemetry log-based events. When emitted inside a trace they SHOULD be parented to the span that produced the decision (for `nthlayer.decision`) or to the span in which the reversal, outcome or evaluation was determined. When emitted outside a trace they MUST carry the provenance attributes of §5.

Attributes marked *low cardinality* MUST NOT carry free text or identifiers.

### 4.1 `nthlayer.decision`

Emitted once per decision, by the application, at the moment the decision becomes effective.

| Attribute | Type | Req. | Description |
|---|---|---|---|
| `nthlayer.decision.id` | string | Required | The decision record's id. SHOULD be the content-addressed id of the decision record (CID). Unique across the catalogue. |
| `nthlayer.decision.type` | string | Required | The class of decision the gate makes; low cardinality. Examples: `triage`, `refund_approval`, `incident_response`. Replaces the SitRep appendix's `gate_type`. |
| `nthlayer.decision.value` | string | Required | The option chosen; low cardinality. `escalate` is reserved: the decision was routed to human review rather than made (§6.4). |
| `nthlayer.decision.confidence` | double | Recommended | The gate's confidence in `value`, as a ratio 0.0–1.0. Required when the service declares a `high_confidence_failure` judgment SLO or a `calibration` threshold. |
| `nthlayer.decision.autonomous` | boolean | Required | `true` when the decision took effect without a human approving it. See §6.3 for derivation from provider spans. |
| `nthlayer.decision.reversible` | boolean | Recommended | Whether the decision can be undone after taking effect. |
| `nthlayer.decision.segment.<dimension>` | string | Conditionally required | One attribute per `segment_dimension` declared in a `segments` threshold on the service, named by that dimension (for example `nthlayer.decision.segment.customer_tier`). Required when the service declares a `segments` threshold. Values MUST be drawn from the threshold's `segment_values`. |
| `gen_ai.provider.name` | string | Recommended | The provider that served the model request behind the decision, as the upstream registry defines it. Absent for a decision made without a model request (rule-based or human). |
| `gen_ai.agent.id` | string | Recommended | The agent that made the decision, when the gate is an agent. |
| `gen_ai.conversation.id` | string | Recommended | The conversation or session thread in which the decision was made, when there is one. Used for lineage discovery (§6.1), never for counting. |
| `gen_ai.response.id` | string | Recommended | The provider's id for the completion the decision was derived from. Provenance (§5). Never a decision id. |

### 4.2 `nthlayer.reversal`

Emitted once per reversal, by the application, when a prior decision is overturned by a human, by the same service on reconsideration, or by an automated process.

| Attribute | Type | Req. | Description |
|---|---|---|---|
| `nthlayer.reversal.decision_id` | string | Required | The `nthlayer.decision.id` being reversed. |
| `nthlayer.reversal.type` | string | Required | `human_override`, `self_reconsideration`, `automated`, `appeal`. Low cardinality. Replaces `gen_ai.override.*`. |
| `nthlayer.reversal.actor_type` | string | Required | `human`, `service`, `policy`. |
| `nthlayer.reversal.actor` | string | Recommended | Who reversed it: a Backstage entity ref for a human or group, a service name for a service. |
| `nthlayer.reversal.new_value` | string | Recommended | The replacement decision value, in the vocabulary of `nthlayer.decision.value`. |
| `nthlayer.reversal.reason` | string | Opt-in | Free text. Content-class; subject to the implementation's content mode. |

A `user.interrupt` or an interrupted turn on the provider side is not a reversal. A reversal exists only when the application emits this event.

### 4.3 `nthlayer.outcome`

Emitted once per decision whose ground truth becomes known, by the application or by a consumer that resolves outcomes (for example a retrospective-analysis consumer).

| Attribute | Type | Req. | Description |
|---|---|---|---|
| `nthlayer.outcome.decision_id` | string | Required | The `nthlayer.decision.id` the outcome resolves. |
| `nthlayer.outcome.value` | string | Required | `correct`, `incorrect`, `indeterminate`. Low cardinality. The ground-truth label the `outcomes` judgment SLO and the `high_confidence_failure` judgment SLO count. |
| `nthlayer.outcome.type` | string | Recommended | What happened downstream; low cardinality. Examples: `incident`, `rollback`, `chargeback`, `defect`, `none`. |
| `nthlayer.outcome.severity` | string | Recommended | Impact severity, in the organisation's severity vocabulary. |
| `nthlayer.outcome.source` | string | Required | Which signal resolved the outcome; low cardinality. Examples: `incident_resolution`, `chargeback_feed`, `human_audit`. MUST NOT be a provider grader (§3, A1). |

The interval between a decision's `nthlayer.decision` event and its `nthlayer.outcome` event is the measurement for the `feedback_latency` threshold (§5.5.5 core).

### 4.4 `gen_ai.evaluation.result` (grader)

Emitted as the upstream conventions define it. OpenSRM adds one attribute and constrains two.

| Attribute | Type | Req. | OpenSRM constraint |
|---|---|---|---|
| `gen_ai.evaluation.name` | string | Required (upstream) | The evaluation metric. For a human audit under an `audit_sampling` judgment SLO, MUST be `opensrm.audit`. |
| `gen_ai.evaluation.score.value` | double | Cond. required (upstream) | The *evaluator's* score. MUST NOT carry the decision's own confidence; that is `nthlayer.decision.confidence`. |
| `gen_ai.evaluation.score.label` | string | Cond. required (upstream) | For `opensrm.audit`: `correct`, `incorrect`, `indeterminate`. |
| `gen_ai.evaluation.explanation` | string | Recommended (upstream) | Content-class. |
| `gen_ai.response.id` | string | Recommended (upstream) | The completion evaluated, as upstream defines it. |
| `nthlayer.decision.id` | string | Required (OpenSRM) | The decision the evaluation is about. Added by OpenSRM so an evaluation can be joined to lineage when the evaluated completion produced a decision. |
| `nthlayer.evaluator.kind` | string | Required (OpenSRM) | `human`, `implementation`, `provider`. Low cardinality. Supports A4. |

A human audit verdict is a grader evaluation with `nthlayer.evaluator.kind: human`. It feeds `audit_sampling` completion and `calibration_sample` measurement. It becomes ground truth only when the application also emits an `nthlayer.outcome` with `source: human_audit`; the two are distinct records because an audit can be sampled and still not be the organisation's definition of ground truth.

## 5. Provenance (normative)

- **P1.** An `nthlayer.decision` event for a decision derived from a model request SHOULD be parented to that request's span. When it cannot be (the decision is recorded outside the trace, or later), it MUST carry `gen_ai.response.id` and SHOULD carry the request's W3C trace context in the attributes `traceparent` and, where present, `tracestate`.
- **P2.** A decision record persisted as a CloudEvent (the `io.nthlayer.decision.v1` type of §8 core) MUST carry the CloudEvents Distributed Tracing extension attributes `traceparent` and `tracestate` when the decision was made inside a trace. The §10.1 core change event MAY carry them.
- **P3.** `gen_ai.response.id` has one meaning everywhere in OpenSRM: the provider's identifier for a completion. It is never a decision id, a verdict id or a CID. A decision's id is `nthlayer.decision.id`.
- **P4.** `gen_ai.provider.name` identifies the provider. `gen_ai.system` MUST NOT be emitted; it is no longer in the upstream registry.
- **P5.** Where a provider's API span and the SDK's client span both exist for one request (a `SERVER` span under a `CLIENT` span of the same name), provenance SHOULD reference the `SERVER` span: it is the one the provider's own child spans hang from.

## 6. Binding to GenAI-convention spans (normative, provider-neutral)

This section states, per purpose, which span attributes an implementation MAY consume and under what rule. Attribute names are the upstream `gen_ai.*` names. Provider-specific names are in §7.

### 6.1 Lineage discovery

`gen_ai.conversation.id` and a provider's session id group the spans of one thread or session, across traces. An implementation MAY use them to *propose* candidate reversals (a later decision in the same thread) for human review in a consumer such as the Bench. It MUST NOT count a candidate as a reversal; only an `nthlayer.reversal` event counts (A1). For `measurement.source: lineage`, the reversal is attributed by `nthlayer.reversal.decision_id`, nothing else.

### 6.2 Decision identity

`gen_ai.agent.id` and `gen_ai.agent.name` on an agent turn or tool span identify the agent. For an `ai-gate` service implemented as an agent, the manifest's `spec.service.name` SHOULD equal the agent's `gen_ai.agent.name`, and `breach_actions[].reduce_autonomy.agent` SHOULD equal its `gen_ai.agent.id`. `gen_ai.tool.call.id` identifies one tool invocation and MAY be used as the `nthlayer.decision.id` input when each tool call is itself a decision; the id emitted MUST still be the decision record's own id.

### 6.3 Autonomy

A provider that evaluates a permission policy before a tool runs exposes the result on the tool span (Claude Platform: `anthropic.tool.evaluated_permission`, values `allow` and `ask`).

- A tool use the provider ran under `allow` took effect without a human; a decision it embodies is `nthlayer.decision.autonomous: true`.
- `ask` means the provider asked the *application*. Whether a human approved is known only to the application. An implementation MUST NOT infer `autonomous: false` from `ask`; the application sets `autonomous` from its own confirmation path.
- A tool use the provider *denied* emits no span at all. The denominator for any rate that includes denied actions therefore cannot come from spans; the application MUST emit the decision record.

### 6.4 Escalation

The `escalation` judgment SLO (§5.2.5 core) counts decision records with `nthlayer.decision.value: escalate`. A provider turn that stops because a tool requires the application to act (Claude Platform: `anthropic.session.turn.stop_reason: requires_action`) is not an escalation signal: it fires for every custom tool, not only for 'ask a human'. An implementation MAY use it, together with `gen_ai.tool.name`, to check that escalation decisions are being emitted, and MUST NOT count it.

### 6.5 Stability and the served model

The `stability` threshold (§5.5.2 core) replays a frozen input set and bounds drift between runs. Two provider attributes confound it:

- `gen_ai.response.model` can differ from `gen_ai.request.model` when the request named an alias, or when a fallback model served it.
- Sampling parameters (`gen_ai.request.temperature`, `gen_ai.request.top_p`, `gen_ai.request.top_k`, reasoning effort, thinking budget) and the service tier change the output distribution.

Rules:

- **S1.** A probe run MUST record, per request, `gen_ai.response.model` and the sampling parameters in effect, and the run as a whole MUST pin them.
- **S2.** Within one run, every request SHOULD be served by the same `gen_ai.response.model`. A request served by a different model (a fallback) MUST be excluded from that run's drift measurement and the exclusion reported. A run with fewer than the implementation's minimum comparable requests after exclusion is *not evaluable* (E3).
- **S3.** Between runs, a change in `gen_ai.response.model` or in the pinned parameters is exactly what the threshold exists to detect. The measured drift stands, and the report MUST name the change so an operator can attribute it.
- **S4.** A hash of `gen_ai.system_instructions`, where available, SHOULD be recorded as a prompt-version dimension and reported the same way.

### 6.6 Classical SLIs

Provider request spans carry duration, `http.response.status_code`, `error.type`, `gen_ai.response.time_to_first_chunk`, and `http.request.resend_count`. An implementation MAY derive availability and latency indicators from them (for example through a spanmetrics connector) for the service's *internal* OpenSLO objectives. Admissibility A3 applies: they are not contract evidence.

### 6.7 Cost

`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens` and provider-specific usage attributes support cost indicators. Usage attributes repeat on more than one span level; an implementation MUST follow the provider's documented counting rule (for Claude Platform, §7.3) or it double-counts.

### 6.8 Audit content

In content mode, `gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.call.arguments` and the provider's tool-result attribute carry the prose a human auditor reads. An implementation MAY present them for `audit_sampling`. A span whose content the provider truncated (Claude Platform: `anthropic.content.truncated: true`) MUST be flagged to the auditor and MUST NOT be scored on content alone.

### 6.9 What spans never carry

For the avoidance of doubt, no provider span carries: a decision value, a decision confidence, a decision id, reversibility, a reversal, ground truth, a business segment, feedback latency or audit backlog. Every one of these is the application's to emit (§4). The intended joining model is: the application's own span carries business context, the provider's spans carry mechanics, and the implementation joins them on trace id.

## 7. Provider profile: Claude Platform (normative for that provider)

Source: Anthropic's OpenTelemetry span reference, beta, conventions pinned at `semantic-conventions-genai` commit `e57c543b` (2026-09-24).

### 7.1 Attribute binding

| OpenSRM purpose | Claude Platform attribute(s) | Span(s) | Rule |
|---|---|---|---|
| Provenance (P1, P5) | trace id and span id; `anthropic.request.id`; `gen_ai.response.id` | `anthropic.model_request`; `anthropic.messages.create` (`SERVER`) | Reference the `SERVER` request span or its `anthropic.model_request` child. |
| Lineage discovery (6.1) | `gen_ai.conversation.id` (thread), `anthropic.session.id` (session), `anthropic.session.thread.id` (SDK tool runner) | session and turn spans | Discovery only. A session's spans span several traces; group by id, not by trace. |
| Decision identity (6.2) | `gen_ai.agent.id`, `gen_ai.agent.name`, `gen_ai.tool.call.id` | `anthropic.session.turn`, tool spans | `gen_ai.agent.name` is `anthropic.advisor` on an advisor thread; an advisor is not a gate. |
| Tenancy / segment | `anthropic.organization.id`, `anthropic.workspace.id` | every request span | MAY serve as a `segment_dimension` when the manifest declares it. |
| Autonomy (6.3) | `anthropic.tool.evaluated_permission` ∈ `allow`, `ask` | API tool spans in Managed Agents | As 6.3. Denied tool uses emit no span. |
| Escalation check (6.4) | `anthropic.session.turn.stop_reason` = `requires_action`, with `gen_ai.tool.name` | `anthropic.session.turn` | Check only; never count. |
| Grader (4.4, A4) | `anthropic.session.outcome_evaluation.result` ∈ `satisfied`, `needs_revision`, `max_iterations_reached`, `failed`, `interrupted`; `.explanation`; `anthropic.session.outcome.id` | `anthropic.session.outcome_evaluation` | Ingest as a `gen_ai.evaluation.result` with `nthlayer.evaluator.kind: provider`. `satisfied` → label `pass`; `needs_revision`, `max_iterations_reached`, `failed` → `fail`; `interrupted` → not evaluable. Self-grading. |
| Stability (6.5) | `gen_ai.response.model`, `gen_ai.request.model`, `anthropic.response.service_tier`, `anthropic.request.service_tier`, `gen_ai.request.temperature`, `gen_ai.request.top_p`, `gen_ai.request.top_k`, `gen_ai.request.reasoning.level`, `anthropic.thinking.type`, `anthropic.thinking.budget_tokens`, `anthropic.beta` | `anthropic.messages.create`, `anthropic.model_request` | Pin and record per S1. |
| Classical SLIs (6.6) | span duration, `http.response.status_code`, `error.type`, `gen_ai.response.time_to_first_chunk`, `http.request.resend_count` | request spans | Internal SLOs only (A3). |
| Cost (6.7) | `gen_ai.usage.*`, `anthropic.usage.cache_creation.ephemeral_5m_input_tokens`, `anthropic.usage.cache_creation.ephemeral_1h_input_tokens`, `anthropic.usage.compaction.input_tokens`, `anthropic.usage.compaction.output_tokens`, `gen_ai.usage.reasoning.output_tokens` | `anthropic.messages.create`, `anthropic.model_request`, `anthropic.compaction`, `anthropic.session.outcome_evaluation` | Count per 7.3. |
| Audit content (6.8) | `gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.call.arguments`, `anthropic.tool_result.content`, `anthropic.content.truncated` | request, turn and tool spans | Content mode only. |

### 7.2 Coverage caveats an implementation MUST account for

- API-side spans exist only for Claude Platform and Claude Platform on AWS. Requests through the Bedrock or Vertex AI clients produce SDK spans only (`gen_ai.provider.name` is `aws.bedrock` or `gcp.vertex_ai`), with no `anthropic.model_request` children and no API-run tool spans.
- The API emits no span for the OpenAI-compatible endpoint.
- The API emits no tool span when the model asks for a tool the application runs, when a tool runs in a self-hosted sandbox, for multiagent or advisor tools, or when a tool use is denied.
- Thinking content is absent from Managed Agents spans.
- Span delivery is best-effort; a caller can unset the sampled flag; spans can arrive more than once. A3 applies. For a complete record of usage, the provider directs implementations to its Usage API.
- Under a HIPAA, FERPA or K-12 restriction the provider exports metadata only, whatever the destination's content mode. Audit content (6.8) is then unavailable from spans.
- Span names and attributes can change during the provider's beta.

### 7.3 Token counting

To count each token once: when a request has both an SDK `CLIENT` span and an API `SERVER` span, sum the API spans. Within API spans for a Messages request, sum either the `anthropic.messages.create` spans or their `anthropic.model_request` children, not both; add `anthropic.compaction` spans and do not also add the `anthropic.usage.compaction.*` attributes. For a Managed Agents session, sum `anthropic.model_request` and `anthropic.session.outcome_evaluation`. `gen_ai.usage.input_tokens` already includes cache reads and writes.

## 8. Schema change: `instrumentation.required_traces[].emitted_by`

§8 of the core spec declares the spans a service must emit so that CI can verify them. It assumes the application emits every span. A provider-emitted span is required just the same (an `ai-gate` whose provenance depends on `anthropic.model_request` has a requirement on it) but CI cannot find it in the application's code.

Add to each `required_traces` item:

```yaml
required_traces:
  - span_name: "refund.decide"
    required_attributes: [refund.amount, refund.reason, nthlayer.decision.segment.customer_tier]
    # emitted_by: application   (default)
  - span_name: "anthropic.model_request"
    emitted_by: provider
    required_attributes: [gen_ai.response.model, gen_ai.response.id]
```

JSON Schema (draft-07) delta to `#/definitions/Instrumentation/properties/required_traces/items/properties`:

```json
"emitted_by": {
  "enum": ["application", "provider"],
  "default": "application",
  "description": "Who emits the span. 'provider' declares a span the model provider or agent runtime emits; verification checks the telemetry destination rather than the application's code."
}
```

The field is optional and additive; every existing manifest validates unchanged. Verification semantics: for `application`, CI checks the code emits the span with the attributes; for `provider`, CI checks that the configured telemetry destination has received a span of that name with those attributes within the implementation's verification window.

`required_events[].schema_ref` gains a recognised value set: `nthlayer.decision`, `nthlayer.reversal`, `nthlayer.outcome`, `gen_ai.evaluation.result`. A `schema_ref` outside this set is permitted (the field stays a free string) but is not an OpenSRM-defined event.

## 9. Errata to existing documents

Each item gives the current text and its replacement. Items 1–7 amend `OPENSRM-CORE-v2.md`.

1. **§2.4, last two sentences.** Current: "The `gen_ai.evaluation.result` event (shipped in OTel semconv v1.39.0) is the substrate for judgment-SLO outcome reporting. The `gen_ai.decision.*` subset is proposed upstream." Replace with: "Decision, reversal and outcome records are the `nthlayer.decision`, `nthlayer.reversal` and `nthlayer.outcome` events (Addendum A1 §4); grader evaluations use the upstream `gen_ai.evaluation.result` event. The `gen_ai.decision.*`, `gen_ai.reversal.*` and `gen_ai.outcome.*` forms are proposed upstream."
2. **§5.3, final paragraph before the implementation note.** Current: "The wire format for judgment-SLO outcomes is the OTel `gen_ai.evaluation.result` event (OTel semconv v1.39.0+), extended with the `nthlayer.decision.*` attributes described in §11.3." Replace with: "The wire formats for judgment-SLO inputs are the four events of Addendum A1 §4. `gen_ai.evaluation.result` carries grader evaluations only."
3. **§8 example, `required_events`.** Current: `schema_ref: "gen_ai.evaluation.result"` under `type: "io.nthlayer.decision.v1"`. Replace with `schema_ref: "nthlayer.decision"`. Same change in `spec/v2/examples/services/ai-gate.yaml`, `spec/v2/examples/service-manifest-full.yaml` and `spec/v2/AUTHORING.md` (the `required_events` example).
4. **§11.2, whole section.** Replace with a pointer to Addendum A1 §4 and §5. The current example is wrong on three counts: `gen_ai.system` is no longer in the upstream registry (use `gen_ai.provider.name`); `gen_ai.response.id` is the provider's completion id upstream, not a CID; `gen_ai.evaluation.score.value` is the evaluator's score upstream, not the decision's confidence.
5. **§11.3, whole section.** Replace with a pointer to Addendum A1 §4.0 (namespace rule) and §4.1. The four attributes fold in as follows: `nthlayer.decision.type` keeps its name with the §4.1 meaning (class of decision, not the chosen option); `nthlayer.decision.reversible` and `nthlayer.decision.autonomous` keep their names; `nthlayer.decision.reversal_of` is retired in favour of the `nthlayer.reversal` event, where `nthlayer.reversal.decision_id` carries the link.
6. **§13, SHOULD list.** Current: "Emit `gen_ai.evaluation.result` events for judgment-SLO outcomes". Replace with: "Emit the Addendum A1 §4 events for decisions, reversals and outcomes, and `gen_ai.evaluation.result` for grader evaluations". **§13, MAY list.** Current: "Adopt the `nthlayer.decision.*` attributes described in §11.3 pending upstream standardisation". Delete; the attributes are now MUST-emit for conformant `ai-gate` services (§10 below).
7. **§16.1.** Current: "OpenTelemetry GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/". Replace with: "OpenTelemetry GenAI semantic conventions: https://github.com/open-telemetry/semantic-conventions-genai (the conventions moved out of the core semantic-conventions repository; the former URL is a redirect notice)".
8. **`conventions/decision-telemetry/README.md`.** Retitle the attribute tables as the upstream proposal form; add the attributes §4.1–§4.3 introduce (`decision.type`, `decision.autonomous`, `decision.reversible`, `decision.segment.<dimension>`, `reversal.actor_type`, `reversal.actor`, `reversal.reason`, `outcome.value`, `outcome.source`) so the proposal and the wire form have identical suffixes; change the "Next Steps" target repository to `open-telemetry/semantic-conventions-genai`.
9. **`components/sitrep/sitrep-technical-appendix.md`, "Integration: Decision Telemetry".** Rename emitted attributes to the `nthlayer.` wire form; `gen_ai.decision.gate_type` becomes `nthlayer.decision.type`; the three `o11y.*` link attributes are SitRep's own and are unaffected.
10. **`ARCHITECTURE.md`** (lines referring to `gen_ai.override.*`). `gen_ai.override.*` is retired; a human override is an `nthlayer.reversal` with `type: human_override`.
11. **`STATUS.md`, Decision Telemetry table.** Add a row for the `nthlayer.` wire form and the Addendum; change the submit target to `semantic-conventions-genai`.
12. **`docs/spec-conventions.md` line 151.** `gen_ai.decision.*` → `nthlayer.decision` event.

Not changed by this addendum: the five judgment SLO types, the five judgment threshold types, the evaluation rules E1–E4, the `ai-gate` type rule, template semantics, change events, contracts and dependencies.

## 10. Conformance additions

An OpenSRM v2 implementation that consumes GenAI-convention telemetry MUST, in addition to §13 of the core spec:

- Classify every consumed signal by §3 and never promote a signal across classes (A1)
- Report judgment SLOs on an `ai-gate` with no decision records as not evaluable (A2)
- Deduplicate provider spans by trace id and span id, and not use them as sole contract-breach evidence (A3)
- Record evaluator identity on every grader evaluation and be able to report self-graded samples separately (A4)
- Emit, for every `ai-gate` service it instruments, `nthlayer.decision` events with the Required attributes of §4.1, and `nthlayer.reversal` and `nthlayer.outcome` events where the service's judgment SLOs need them
- Carry provenance per §5
- Partition stability measurement per S1–S4
- Accept `emitted_by` on `required_traces` items and verify `provider` spans at the destination (§8)

An implementation SHOULD:

- Propose lineage candidates from `gen_ai.conversation.id` for human review (6.1)
- Derive classical SLIs from provider spans for internal objectives (6.6)
- Present content-mode span attributes for audit sampling, flagging truncation (6.8)

## 11. Open questions

- **Upstream namespace.** `gen_ai.decision.*` is the wrong home for a decision a rule engine or a human approver makes, and the core spec is explicit that `ai-gate` denotes decision-making, not AI. The upstream proposal may be better made as a top-level `decision.*` namespace with `gen_ai.*` provenance attributes alongside, rather than as a GenAI extension. This changes the proposal, not the wire form, which stays `nthlayer.` either way.
- **Binding `reduce_autonomy` to provider policy.** A provider that evaluates permission policies per tool call could enforce a `reduce_autonomy` breach action directly. Out of scope for this addendum; noted as a candidate consumer integration.
- **Agent-runtime telemetry.** Claude Code, the Agent SDK and similar runtimes publish separate monitoring conventions. Whether they warrant a second provider profile is deferred until one is consumed.
- **Pin cadence.** The upstream conventions are in Development status and the provider's export is in beta. How often this addendum re-pins, and whether an implementation should tolerate both the pinned and current names during a transition, is unresolved.

## 12. References

- Anthropic, *OpenTelemetry for the Claude API* and *OpenTelemetry span reference* (beta), https://platform.claude.com/docs/en/manage-claude/opentelemetry and https://platform.claude.com/docs/en/api/opentelemetry/spans
- OpenTelemetry GenAI semantic conventions, https://github.com/open-telemetry/semantic-conventions-genai — pinned at commit `e57c543b` (2026-09-24) to match the provider; repository head at time of writing `9ffc7e00` (2026-10-21). `gen_ai.evaluation.result` is defined in `docs/gen-ai/gen-ai-events.md`; `gen_ai.provider.name` in `docs/registry/attributes/gen-ai.md`.
- CloudEvents v1.0 Distributed Tracing extension (`traceparent`, `tracestate`), https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/distributed-tracing.md
- W3C Trace Context, https://www.w3.org/TR/trace-context/
- `OPENSRM-CORE-v2.md`, `conventions/decision-telemetry/README.md`, `spec/v2/schema.json` in this repository

## 13. Revision history

| Version | Date | Changes |
|---|---|---|
| A1-draft | 2026-10-21 | Initial draft: admissibility classes; consolidated decision telemetry vocabulary; provenance rules; provider-neutral span binding; Claude Platform profile; `emitted_by` schema field; errata to core §2.4, §5.3, §8, §11, §13, §16.1 and to five companion documents. |

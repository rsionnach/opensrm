# OpenSRM v2 — Addendum A1: Telemetry Binding and Decision Telemetry Errata

**Status:** Draft for review
**Applies to:** `OPENSRM-CORE-v2.md` (v2-draft, 2026-08-25); `conventions/decision-telemetry/`
**Provider profiles:** §7.2
**Date:** 2026-10-31
**Supersedes:** `OPENSRM-CORE-v2.md` §11.2 and §11.3 in their entirety; amends the Delta Summary, §2.4, §5.3, §5.5.5, §5.5.6, §8, §13, §16.1

---

## Summary

Model providers now emit OpenTelemetry spans for every model request, tool use and agent turn, using the GenAI semantic conventions. Anthropic's Claude Platform is the first to do so from the API side with no application instrumentation. These spans carry every identity, provenance and mechanics attribute an OpenSRM implementation needs, and no judgment attribute at all.

This addendum does five things:

1. **Binds OpenSRM to provider-emitted spans.** It specifies which judgment-SLO inputs MAY be taken from `gen_ai.*` spans, which MUST come from the application, and which are admissible only as grader opinion. The binding is provider-neutral; what each provider emits is stated in a separate provider profile (§7), the first of which covers Claude Platform.
2. **Consolidates the decision telemetry vocabulary.** The repository currently carries four overlapping sets (`nthlayer.decision.*` in core §11.3; `gen_ai.{decision,reversal,outcome}.*` in `conventions/`; the SitRep appendix's extensions; `gen_ai.override.*` in `ARCHITECTURE.md`). This addendum reduces them to one family of three application-emitted events, and repositions `gen_ai.evaluation.result` as the grader event it is upstream.
3. **Corrects three collisions with the upstream conventions**: `gen_ai.system` (removed upstream), `gen_ai.response.id` (upstream: the provider's completion id, not a decision CID), and `gen_ai.evaluation.score.value` (upstream: an evaluator's score, not a decision's confidence).
4. **Adds one additive schema field**, `instrumentation.required_traces[].emitted_by`, so a manifest can declare a span the provider emits rather than the application.
5. **Names OpenSRM's metric series.** Series OpenSRM defines use the `nthlayer_` prefix, never `gen_ai_` (§4.5).

The addendum adds no judgment SLO type and no threshold type. It changes core §5 in two places, both through §9 errata: E3 (§5.5.6) is extended to judgment SLOs, so a service with no decision records is *not evaluable* rather than within objective (erratum 13); and "arrival" in §5.5.5 is defined as the outcome's timestamp (erratum 14). It also pins down an input core §5 left open: calibration is computed from authoritative outcomes only (§3, A5).

**Conformance break.** Core §13 made the `nthlayer.decision.*` attributes a MAY. This addendum makes the `nthlayer.decision` event, with its Required attributes, a MUST for every instrumented `ai-gate` service (§10.2, erratum 6). An `ai-gate` service conformant before it, emitting `gen_ai.evaluation.result` events only, is not conformant after it. An implementation that also reads the old form during a migration MUST still classify it by §3: a `gen_ai.evaluation.result` event is a grader evaluation, never a decision record.

---

## 1. Scope

This addendum is normative for two parties (§10). For OpenSRM v2 implementations that consume OpenTelemetry telemetry from a model provider, an agent runtime, or an application's own GenAI instrumentation, all of it applies. Where an implementation consumes none of these, only §4 (vocabulary), §5 (provenance) and §9 (errata) apply. For applications, the instrumented `ai-gate` services that emit decision telemetry, §4, §5 and §10.2 apply.

The GenAI semantic conventions are in Development status upstream and attribute names can change. This addendum pins the `gen_ai.*` names it uses at the commit named in §12 and will be revised when they move. Each provider profile pins its own sources (§7.1 R2).

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
| **Authoritative** | `nthlayer.decision`, `nthlayer.reversal`, `nthlayer.outcome` events emitted by the application | Every judgment SLO denominator; every judgment SLO numerator, except where the Grader row admits a grader evaluation instead; every judgment threshold | — |
| **Corroborating** | Provider spans and their attributes | Provenance; lineage *discovery*; stability partitioning; classical SLIs for internal SLOs (§4 core); cost; audit content | Any judgment SLO count; contract breach evidence (§6 core) |
| **Grader** | `gen_ai.evaluation.result` events, from any evaluator | `measurement.source: calibration_sample`; audit sampling evidence | `measurement.source: lineage`; `downstream_signal`; the `outcomes` and `high_confidence_failure` judgment SLOs; the `calibration` threshold |

Rules:

- **A1.** An implementation MUST classify each consumed signal by the table above and MUST NOT promote a signal across classes. In particular a provider span MUST NOT be counted as a decision, and a grader evaluation MUST NOT be counted as an outcome.
- **A2.** The population of decisions a judgment SLO on an `ai-gate` service is computed over comes only from authoritative records: every denominator counts decision records. A grader evaluation can contribute to a numerator only where the Grader row admits it (`calibration_sample`, `audit_sampling`), and only for a decision record it names (§4.4). A service that emits provider spans and no decision records therefore has no decision records in the sense of core §5.5.6 E3, which makes each of its judgment SLOs *not evaluable* (amended by §9 erratum 13). Provider spans MUST NOT be used to make it evaluable.
- **A3.** Provider spans are delivered best-effort, can be lost, duplicated, or left unsampled by the caller. An implementation MUST NOT use them as the sole evidence of a contract breach (§6 core) or as the basis for SLA credits. It MAY use them for internal SLOs (§4 core) and MUST deduplicate by trace id and span id before counting.
- **A4.** A grader evaluation whose evaluator is the same provider that served the evaluated completion is *self-grading*. An implementation MUST record the evaluator identity (§4.4) and MUST be able to report self-graded samples separately from independently graded ones.
- **A5.** Calibration (§5.5.3 core) compares a decision's confidence with whether the decision was correct, which is ground truth. It MUST be computed from `nthlayer.decision.confidence` joined, by `nthlayer.outcome.decision_id`, to `nthlayer.outcome.value`, and from nothing else. A decision whose outcome is `indeterminate`, or has not yet arrived, is not in the calibration sample. A grader evaluation never enters it, whoever the evaluator.

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
| `nthlayer.decision.confidence` | double | Recommended | The gate's confidence in `value`, as a ratio 0.0–1.0. Required when the service declares a `high_confidence_failure` judgment SLO, a `calibration` threshold, or a `segments` threshold with `metric: high_confidence_failure`. |
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

The `feedback_latency` threshold (§5.5.5 core) measures, per decision, the interval from the `Timestamp` of its `nthlayer.decision` event to the `Timestamp` of its `nthlayer.outcome` event. These are the OpenTelemetry log record `Timestamp` fields, the time the event occurred:

- **T1.** An emitter MUST set the `nthlayer.decision` event's `Timestamp` to when the decision became effective, and the `nthlayer.outcome` event's `Timestamp` to when the ground truth was determined. A consumer that resolves an outcome after the fact (a retrospective analysis, a chargeback feed) sets it to when the outcome was determined, not to when it emits the event.
- **T2.** An implementation MUST NOT use `ObservedTimestamp`, or the time it received an event, as either end of the interval.
- **T3.** "Arrival" in §5.5.5 core is the outcome's `Timestamp`. The 30-day window is anchored on it.


### 4.4 `gen_ai.evaluation.result` (grader)

Emitted as the upstream conventions define it. OpenSRM adds one attribute and constrains two.

| Attribute | Type | Req. | OpenSRM constraint |
|---|---|---|---|
| `gen_ai.evaluation.name` | string | Required (upstream) | The evaluation metric. For a human audit under an `audit_sampling` judgment SLO, MUST be `opensrm.audit`. |
| `gen_ai.evaluation.score.value` | double | Cond. required (upstream) | The *evaluator's* score. MUST NOT carry the decision's own confidence; that is `nthlayer.decision.confidence`. |
| `gen_ai.evaluation.score.label` | string | Cond. required (upstream) | For `opensrm.audit`: `correct`, `incorrect`, `indeterminate`. |
| `gen_ai.evaluation.explanation` | string | Recommended (upstream) | Content-class. |
| `gen_ai.response.id` | string | Recommended (upstream) | The completion evaluated, as upstream defines it. |
| `nthlayer.decision.id` | string | Conditionally required (OpenSRM) | The decision the evaluation is about, so it can be joined to lineage. Required for `opensrm.audit`, and whenever the evaluated completion produced a decision the implementation can identify (by §5 provenance). An evaluation without it feeds no judgment SLO. |
| `nthlayer.evaluator.kind` | string | Required (OpenSRM) | `human`, `implementation`, `provider`. Low cardinality. Supports A4. |

A grader evaluation that ended without a verdict (the evaluator was interrupted, timed out or errored) has *no verdict*. An implementation ingesting one MUST record it without a `gen_ai.evaluation.score.label` or `gen_ai.evaluation.score.value`, MUST exclude it from every count and rate grader evaluations feed (audit sampling completion, `calibration_sample` measurement), and MUST report how many it excluded alongside each such count. A sampled decision whose only evaluations have no verdict is still unaudited for `audit_sampling` and `audit_backlog`.

A human audit verdict is a grader evaluation with `nthlayer.evaluator.kind: human`. It feeds `audit_sampling` completion and `calibration_sample` measurement. It becomes ground truth only when the application also emits an `nthlayer.outcome` with `source: human_audit`; the two are distinct records because an audit can be sampled and still not be the organisation's definition of ground truth.

### 4.5 Metric names

§4.0's argument applies to metric series too. A Prometheus series that OpenSRM defines, whether counted from the §4 events or computed from them by an implementation, is not an upstream GenAI series. A `gen_ai_` name for it would collide with the series providers and upstream instrumentation emit.

- **N1.** A series OpenSRM defines MUST use the `nthlayer_` prefix and MUST NOT use `gen_ai_`. A series the upstream conventions define keeps its upstream name (for example `gen_ai_client_operation_duration_seconds`).
- **N2.** The name after the prefix follows the OpenTelemetry-to-Prometheus naming rules: the quantity in snake_case, the base unit as a suffix where there is one (`_seconds`), and `_total` on counters. A ratio has no unit suffix.
- **N3.** Every series carries a `service` label equal to the manifest's `metadata.name`. A label taken from a §4 attribute is named by the attribute with the `nthlayer.` prefix removed and dots replaced by underscores, so labels from different events cannot collide (`nthlayer.decision.type` → `decision_type`, `nthlayer.reversal.type` → `reversal_type`, `nthlayer.decision.segment.customer_tier` → `decision_segment_customer_tier`). Only attributes marked low cardinality, and `nthlayer.decision.segment.<dimension>`, MAY become labels. Other labels, such as a bucket computed from a numeric attribute, are defined by the series' contract.
- **N4.** Recording rules an implementation generates are not series under N1. They follow Prometheus's `level:metric:operations` convention and their names are implementation-defined.

The series currently defined, and their names under N1–N3:

| Quantity | Derived from | Kind | Current name(s) | Name |
|---|---|---|---|---|
| Decisions | `nthlayer.decision` | counter | `gen_ai_decisions_total`; `ai_gate_decisions_total` | `nthlayer_decisions_total` |
| Reversals | `nthlayer.reversal` | counter | `gen_ai_overrides_total`; `gen_ai_reversals_total` (in documentation only) | `nthlayer_reversals_total` |
| High-confidence failures (§5.2.2 core) | `nthlayer.decision.confidence` joined to `nthlayer.outcome.value` (§4.3) | counter | `gen_ai_overrides_hcf_total` (redefined, see below) | `nthlayer_high_confidence_failures_total` |
| Decision confidence | `nthlayer.decision.confidence` | gauge | `ai_gate_confidence_score` | `nthlayer_decision_confidence` |
| Expected calibration error (§5.5.3 core) | computed (§3, A5) | gauge | `gen_ai_calibration_ece`; `ai_gate_calibration_error` | `nthlayer_calibration_ece` |
| Brier score (§5.5.3 core) | computed (§3, A5) | gauge | `gen_ai_calibration_brier`; `ai_gate_calibration_brier` | `nthlayer_calibration_brier` |
| Feedback latency (§5.5.5 core) | interval of §4.3 | histogram | `gen_ai_feedback_latency_seconds`; `ai_gate_feedback_latency_seconds` | `nthlayer_feedback_latency_seconds` |

Where two current names map to one, they are the same quantity under two names. The rename changes names only, with one exception: kinds and labels stay as they are today. The exception is high-confidence failures. `gen_ai_overrides_hcf_total` counts *overrides* of high-confidence decisions; §4.3 makes the `high_confidence_failure` judgment SLO count high-confidence decisions whose *outcome* is `incorrect`. `nthlayer_high_confidence_failures_total` follows §4.3, so the series is redefined as well as renamed, and its rate is `nthlayer_high_confidence_failures_total` over high-confidence `nthlayer_decisions_total`, not reversals over decisions. Reconciling the labels the two current names carry for one quantity (for example reversals counted as `ai_gate_decisions_total{reversed="true"}` as well as by their own counter) is the shared metrics contract's job, not this addendum's. `gen_ai_calibration_error`, already superseded by the two calibration gauges, is retired with no successor.

## 5. Provenance (normative)

- **P1.** An `nthlayer.decision` event for a decision derived from a model request SHOULD be parented to that request's span. When it cannot be (the decision is recorded outside the trace, or later), it MUST carry `gen_ai.response.id` and SHOULD carry the request's W3C trace context in the attributes `traceparent` and, where present, `tracestate`.
- **P2.** A decision record persisted as a CloudEvent (the `io.nthlayer.decision.v1` type of §8 core) MUST carry the CloudEvents Distributed Tracing extension attributes `traceparent` and `tracestate` when the decision was made inside a trace. The §10.1 core change event MAY carry them.
- **P3.** `gen_ai.response.id` has one meaning everywhere in OpenSRM: the provider's identifier for a completion. It is never a decision id, a verdict id or a CID. A decision's id is `nthlayer.decision.id`.
- **P4.** `gen_ai.provider.name` identifies the provider. `gen_ai.system` MUST NOT be emitted; it is no longer in the upstream registry.
- **P5.** Where a provider's API span and the SDK's client span both exist for one request (a `SERVER` span under a `CLIENT` span of the same name), provenance SHOULD reference the `SERVER` span: it is the one the provider's own child spans hang from.

## 6. Binding to GenAI-convention spans (normative, provider-neutral)

This section states, per purpose, which span attributes an implementation MAY consume and under what rule. Attribute names are the upstream `gen_ai.*` names. Provider-specific names are in the provider profiles (§7).

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

`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens` and provider-specific usage attributes support cost indicators. Usage attributes repeat on more than one span level; an implementation MUST follow the counting rule in the provider's profile (§7.1 R6) or it double-counts.

### 6.8 Audit content

In content mode, `gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.call.arguments` and the provider's tool-result attribute carry the prose a human auditor reads. An implementation MAY present them for `audit_sampling`. A span whose content the provider truncated (Claude Platform: `anthropic.content.truncated: true`) MUST be flagged to the auditor and MUST NOT be scored on content alone.

### 6.9 What spans never carry

For the avoidance of doubt, no provider span carries: a decision value, a decision confidence, a decision id, reversibility, a reversal, ground truth, a business segment, feedback latency or audit backlog. Every one of these is the application's to emit (§4). The intended joining model is: the application's own span carries business context, the provider's spans carry mechanics, and the implementation joins them on trace id.

## 7. Provider profiles

§6 is provider-neutral. What a particular provider emits, under which span and attribute names, with which gaps, is stated in a **provider profile**: a separate document, normative only for an implementation consuming that provider's telemetry. Profiles are versioned and pinned independently of this addendum and of each other, so one provider's re-pin does not revise the others.

### 7.1 Profile requirements

A provider profile MUST:

- **R1.** Name the provider and the `gen_ai.provider.name` values it covers.
- **R2.** Pin its sources: the `semantic-conventions-genai` commit its attribute names are taken from, and the version or publication date of the provider's own span reference. Where the pinned commit differs from this addendum's (§12), the profile MUST list every `gen_ai.*` name §4–§6 uses that differs at its pin.
- **R3.** For each purpose of §6.1–§6.8, give the provider attributes and spans that serve it, or state that the provider emits nothing for it.
- **R4.** Map each result value of any provider grader to a `gen_ai.evaluation.result` label, or to *no verdict* (§4.4).
- **R5.** State the provider's coverage gaps: request paths, tools or modes that emit no span, content restrictions, delivery guarantees, and any beta or stability caveat on the names.
- **R6.** State the counting rule for usage attributes that repeat across span levels (§6.7).
- **R7.** Carry its own revision history, recording the pin of each version.

A profile MUST NOT relax a rule of §3–§6. It MAY narrow one for its provider (for example, by naming the one span provenance references) and MAY add provider attributes to the purposes it binds.

### 7.2 Registered profiles

| Provider | Profile | `gen_ai.provider.name` | Pin |
|---|---|---|---|
| Anthropic Claude Platform | [`profiles/claude-platform.md`](profiles/claude-platform.md) | `anthropic` | `e57c543b` |

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

Each item gives the current text and its replacement. Items 1–7 and 13–16 amend `OPENSRM-CORE-v2.md`.

1. **§2.4, last two sentences.** Current: "The `gen_ai.evaluation.result` event (shipped in OTel semconv v1.39.0) is the substrate for judgment-SLO outcome reporting. The `gen_ai.decision.*` subset is proposed upstream." Replace with: "Decision, reversal and outcome records are the `nthlayer.decision`, `nthlayer.reversal` and `nthlayer.outcome` events (Addendum A1 §4); grader evaluations use the upstream `gen_ai.evaluation.result` event. The `gen_ai.decision.*`, `gen_ai.reversal.*` and `gen_ai.outcome.*` forms are proposed upstream."
2. **§5.3, final paragraph before the implementation note.** Current: "The wire format for judgment-SLO outcomes is the OTel `gen_ai.evaluation.result` event (OTel semconv v1.39.0+), extended with the `nthlayer.decision.*` attributes described in §11.3." Replace with: "The wire formats for judgment-SLO inputs are the four events of Addendum A1 §4. `gen_ai.evaluation.result` carries grader evaluations only."
3. **§8 example, `required_events`.** Current: `schema_ref: "gen_ai.evaluation.result"` under `type: "io.nthlayer.decision.v1"`. Replace with `schema_ref: "nthlayer.decision"`. Same change in `spec/v2/examples/services/ai-gate.yaml`, `spec/v2/examples/service-manifest-full.yaml` and `spec/v2/AUTHORING.md` (the `required_events` example).
4. **§11.2, whole section.** Replace with a pointer to Addendum A1 §4 and §5. The current example is wrong on three counts: `gen_ai.system` is no longer in the upstream registry (use `gen_ai.provider.name`); `gen_ai.response.id` is the provider's completion id upstream, not a CID; `gen_ai.evaluation.score.value` is the evaluator's score upstream, not the decision's confidence.
5. **§11.3, whole section.** Replace with a pointer to Addendum A1 §4.0 (namespace rule) and §4.1. The four attributes fold in as follows: `nthlayer.decision.type` keeps its name with the §4.1 meaning (class of decision, not the chosen option); `nthlayer.decision.reversible` and `nthlayer.decision.autonomous` keep their names; `nthlayer.decision.reversal_of` is retired in favour of the `nthlayer.reversal` event, where `nthlayer.reversal.decision_id` carries the link.
6. **§13, SHOULD list.** Current: "Emit `gen_ai.evaluation.result` events for judgment-SLO outcomes". Replace with: "Emit the Addendum A1 §4 events for decisions, reversals and outcomes, and `gen_ai.evaluation.result` for grader evaluations". **§13, MAY list.** Current: "Adopt the `nthlayer.decision.*` attributes described in §11.3 pending upstream standardisation". Delete; the `nthlayer.decision` event and its Required attributes are now MUST-emit for instrumented `ai-gate` services (§10.2). This is the conformance break the Summary records.
7. **§16.1.** Current: "OpenTelemetry GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/". Replace with: "OpenTelemetry GenAI semantic conventions: https://github.com/open-telemetry/semantic-conventions-genai (the conventions moved out of the core semantic-conventions repository; the former URL is a redirect notice)".
8. **`conventions/decision-telemetry/README.md`.** Retitle the attribute tables as the upstream proposal form; add the attributes §4.1–§4.3 introduce (`decision.type`, `decision.autonomous`, `decision.reversible`, `decision.segment.<dimension>`, `reversal.actor_type`, `reversal.actor`, `reversal.reason`, `outcome.value`, `outcome.source`) so the proposal and the wire form have identical suffixes; change the "Next Steps" target repository to `open-telemetry/semantic-conventions-genai`.
9. **`components/sitrep/sitrep-technical-appendix.md`, "Integration: Decision Telemetry".** Rename emitted attributes to the `nthlayer.` wire form; `gen_ai.decision.gate_type` becomes `nthlayer.decision.type`; the reversal and outcome examples link by `nthlayer.reversal.decision_id` and `nthlayer.outcome.decision_id`, not `gen_ai.decision.id`; the decision example gains `nthlayer.decision.autonomous`, which §4.1 requires. The `o11y.*` link attributes are SitRep's own and are unaffected.
10. **`ARCHITECTURE.md`** (lines referring to `gen_ai.override.*`). `gen_ai.override.*` is retired; a human override is an `nthlayer.reversal` with `type: human_override`.
11. **`STATUS.md`, Decision Telemetry table.** Add a row for the `nthlayer.` wire form and the Addendum; change the submit target to `semantic-conventions-genai`.
12. **`docs/spec-conventions.md` line 151.** `gen_ai.decision.*` → `nthlayer.decision` event.

13. **§5.5.6 E3.** Append: "E3 applies equally to a judgment SLO (§5.2): one whose service has no decision records in its window is *not evaluable*, and an implementation MUST report it rather than treat it as within objective. Provider-emitted telemetry is not a decision record (Addendum A1 §3)." Change the §5.5.6 lead-in from "The rules below apply to every threshold type" to "The rules below apply to every threshold type, and E3 also to judgment SLOs".
14. **§5.5.5, after the first paragraph.** Insert: "Ground truth *arrives* at the time it was determined, carried as the `Timestamp` of its `nthlayer.outcome` event (Addendum A1 §4.3, T1–T3), not at the time the event was emitted or received."
15. **§13, MUST list.** Current: "Where it evaluates judgment thresholds, report a bound that cannot be measured as not evaluable (§5.5.6 E3)". Replace with: "Where it evaluates judgment thresholds or judgment SLOs, report a bound that cannot be measured, and a judgment SLO whose service has no decision records, as not evaluable (§5.5.6 E3)".

16. **`OPENSRM-CORE-v2.md`, Delta Summary, the decision-telemetry row.** Current: "**Adopt shipped `gen_ai.evaluation.result` from OTel v1.39.0** + propose `gen_ai.decision.*` upstream". Replace with: "**Emit decision records as `nthlayer.decision` events (Addendum A1)**, use the shipped `gen_ai.evaluation.result` for grader evaluations, and propose `gen_ai.decision.*` upstream"; and the rationale "Already 70% there; contribute rather than fork" with: "Contribute rather than fork; keep OpenSRM-defined names out of `gen_ai.*` until upstream accepts them".
17. **`README.md`, "Decision Telemetry" example.** Rename to the `nthlayer.` wire form and add the Required attributes §4.1 and §4.2 list (`decision.type`, `decision.autonomous`, `reversal.actor_type`).
18. **Prometheus series in `ARCHITECTURE.md` ("Judgment SLO Measurement") and `components/sitrep/sitrep-technical-appendix.md` ("Metrics Derivation").** `gen_ai_reversals_total` → `nthlayer_reversals_total` and `gen_ai_decisions_total` → `nthlayer_decisions_total` (§4.5); SitRep's `gate_type` label → `decision_type` (N3). Both documents' high-confidence-failure query divides `nthlayer_high_confidence_failures_total` by high-confidence decisions, per the §4.5 redefinition.

Not changed by this addendum: the five judgment SLO types, the five judgment threshold types, the evaluation rules E1, E2 and E4, the `ai-gate` type rule, template semantics, change events, contracts and dependencies.

## 10. Conformance additions

This section separates two parties. An **implementation** consumes telemetry and evaluates manifests. An **application** is an instrumented service, or the instrumentation library acting for it, that emits telemetry. A tool that does both carries both sets of duties.

### 10.1 Implementations

An OpenSRM v2 implementation that consumes GenAI-convention telemetry MUST, in addition to §13 of the core spec:

- Classify every consumed signal by §3 and never promote a signal across classes (A1)
- Report judgment SLOs on an `ai-gate` with no decision records as not evaluable (A2; core §5.5.6 E3)
- Deduplicate provider spans by trace id and span id, and not use them as sole contract-breach evidence (A3)
- Record evaluator identity on every grader evaluation and be able to report self-graded samples separately (A4)
- Compute calibration from authoritative outcomes only (A5)
- Measure feedback latency from event `Timestamp`s (T1–T3), and handle grader evaluations with no verdict as §4.4 requires
- Partition stability measurement per S1–S4
- Accept `emitted_by` on `required_traces` items and verify `provider` spans at the destination (§8)
- Name the series it defines per N1–N3 (§4.5)
- Consume a provider's telemetry per that provider's profile, where one is registered (§7.2)

An implementation SHOULD:

- Propose lineage candidates from `gen_ai.conversation.id` for human review (6.1)
- Derive classical SLIs from provider spans for internal objectives (6.6)
- Present content-mode span attributes for audit sampling, flagging truncation (6.8)

### 10.2 Applications

An instrumented `ai-gate` service MUST:

- Emit an `nthlayer.decision` event for every decision, with the Required attributes of §4.1, and the Conditionally required ones where their condition holds
- Emit `nthlayer.reversal` and `nthlayer.outcome` events where its judgment SLOs or thresholds need them
- Set event `Timestamp`s per T1
- Carry provenance per §5
- Emit the `nthlayer.` forms of §4.0, never the `gen_ai.decision.*`, `gen_ai.reversal.*` or `gen_ai.outcome.*` forms, and never `gen_ai.system` (P4)

## 11. Open questions

- **Upstream namespace.** `gen_ai.decision.*` is the wrong home for a decision a rule engine or a human approver makes, and the core spec is explicit that `ai-gate` denotes decision-making, not AI. The upstream proposal may be better made as a top-level `decision.*` namespace with `gen_ai.*` provenance attributes alongside, rather than as a GenAI extension. This changes the proposal, not the wire form, which stays `nthlayer.` either way.
- **Binding `reduce_autonomy` to provider policy.** A provider that evaluates permission policies per tool call could enforce a `reduce_autonomy` breach action directly. Out of scope for this addendum; noted as a candidate consumer integration.
- **Agent-runtime telemetry.** Claude Code, the Agent SDK and similar runtimes publish separate monitoring conventions. Whether they warrant a second provider profile is deferred until one is consumed.
- **Pin cadence.** Resolved in part: each provider profile re-pins on its own schedule (§7.1 R2, R7), and this addendum re-pins only when a `gen_ai.*` name in §4–§6 moves. Whether an implementation should accept both the pinned and the current names during a transition is unresolved.

## 12. References

- OpenTelemetry GenAI semantic conventions, https://github.com/open-telemetry/semantic-conventions-genai — pinned at commit `e57c543b` (2026-09-24), the commit the first provider profile pins; repository head at time of writing `9ffc7e00` (2026-10-21). `gen_ai.evaluation.result` is defined in `docs/gen-ai/gen-ai-events.md`; `gen_ai.provider.name` in `docs/registry/attributes/gen-ai.md`.
- CloudEvents v1.0 Distributed Tracing extension (`traceparent`, `tracestate`), https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/distributed-tracing.md
- W3C Trace Context, https://www.w3.org/TR/trace-context/
- `OPENSRM-CORE-v2.md`, `conventions/decision-telemetry/README.md`, `spec/v2/schema.json` and the provider profiles of §7.2 in this repository

## 13. Revision history

| Version | Date | Changes |
|---|---|---|
| A1-draft | 2026-10-21 | Initial draft: admissibility classes; consolidated decision telemetry vocabulary; provenance rules; provider-neutral span binding; Claude Platform profile; `emitted_by` schema field; errata to core §2.4, §5.3, §8, §11, §13, §16.1 and to five companion documents. |
| A1-draft.2 | 2026-10-31 | Review revision (findings F1–F6). Claude Platform binding split into `profiles/claude-platform.md`, with profile requirements and a registry in §7. Metric-name rule and mapping table, `nthlayer_` prefix (§4.5). Calibration computed from authoritative outcomes only (A5). A2's not-evaluable rule moved into core §5.5.6 E3 (erratum 13). Feedback latency measured on event `Timestamp`s (T1–T3, erratum 14). Grader evaluations with no verdict defined (§4.4). Conformance break called out; §10 split into implementation and application duties. |

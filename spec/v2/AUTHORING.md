# Authoring OpenSRM v2 manifests

A practical guide to writing an OpenSRM v2 `ServiceManifest`: what each
block is for, which ones your service actually needs, how to express all
eight judgment SLO types, and how to migrate from v1.

> **Status: v2 is a draft.** `spec/v1/` remains canonical. v2 is
> specified in [`../../OPENSRM-CORE-v2.md`](../../OPENSRM-CORE-v2.md) and
> validated by [`schema.json`](schema.json). Write v2 manifests today if
> you want the eight-type judgment SLO framework or the OpenSLO/Backstage
> composition; expect the draft to move before it stabilises.

Every YAML block in this guide is an excerpt from a real file under
[`examples/`](examples/) that [`validate.sh`](validate.sh) checks on
every run. Excerpts are trimmed for the point being made — follow the
link under each one for the complete manifest.

## 1. What a manifest is for

An OpenSRM manifest is the machine-readable answer to "what does
reliable mean for this service, and who says so". It is written by the
team that owns the service, lives in that service's repository, and is
consumed by tooling that needs to reason about reliability across
services rather than one at a time.

That last part is the reason for the format's shape. A dashboard only
needs your thresholds. A system that answers "if the fraud detector
degrades, which customer-facing promises break?" needs your thresholds,
your promises to callers, and your expectations of dependencies, in a
form it can traverse. That is what the `contracts` and `dependencies`
blocks are for, and why they are separate from `slo`.

**What v2 changed.** v1 was self-contained: its own SLO syntax, its own
ownership model, its own contract references. v2 composes existing
standards instead — OpenSLO for classical SLOs, Backstage entity refs
for ownership, OpenAPI/AsyncAPI for contracts, CloudEvents for change
events — and keeps as original only what nobody else specifies: the
judgment SLO framework, reliability-contract semantics, and
dependencies-with-expected-guarantees. If you are coming from v1, read
[§7](#7-migrating-from-v1) first; the mechanical changes are larger than
the conceptual ones.

## 2. The envelope

Every OpenSRM v2 document uses the Backstage
`apiVersion`/`kind`/`metadata`/`spec` envelope, so a Backstage catalogue
can treat manifests as additional entity kinds without parsing changes.

There are three document kinds:

| `kind` | Purpose |
|---|---|
| `ServiceManifest` | One service's reliability declaration. The main event. |
| `JudgmentSLO` | A standalone judgment SLO, referenced from a manifest. |
| `ServiceManifestTemplate` | Shared defaults a manifest extends ([§4.8](#48-template)). |

The smallest manifest the schema accepts needs only an owner and a
service identity:

```yaml
apiVersion: opensrm.nthlayer.io/v2
kind: ServiceManifest
metadata:
  name: checkout-api          # DNS-style: lowercase alphanumerics and hyphens
spec:
  owner:
    group: "group:default/sre-checkout"
  service:
    name: checkout-api
```

→ [`examples/minimal.yaml`](examples/minimal.yaml)

That is valid but useless — it declares ownership and nothing else. It
is worth knowing as the floor, because it tells you the schema will not
stop you shipping an empty manifest. Everything below is optional as far
as the validator is concerned; whether it is optional for *you* is the
subject of the rest of this guide.

`apiVersion` is exactly `opensrm.nthlayer.io/v2` and `kind` is exactly
`ServiceManifest` — both are constants, not patterns. A v1 `apiVersion:
opensrm/v1` document is rejected outright.

## 3. Choosing a starting point

Rather than start from the empty manifest, start from the archetype that
matches your service and delete what does not apply.

**v2 has no `spec.type` field.** v1 had one — `api`, `worker`, `stream`,
or `ai-gate` — and used it to drive conditional validation (in v1,
judgment SLOs were only valid on an `ai-gate`). v2 dropped it, so the
archetypes below are a way of organising *this guide* and nothing more.
No field records which one you picked, and the schema will not stop a
worker from declaring judgment SLOs. Whether that omission was
deliberate is an open question tracked in `opensrm-6w9d`.

What distinguishes the archetypes is which blocks they use:

| Archetype | Characteristic SLOs | `contracts`? | `judgment_slo`? | Example |
|---|---|---|---|---|
| **api** | availability, latency | Yes — callers need a promise | No | [`examples/services/api.yaml`](examples/services/api.yaml) |
| **worker** | success rate, processing time | No — nothing calls it synchronously | No | [`examples/services/worker.yaml`](examples/services/worker.yaml) |
| **stream** | consumer lag, throughput | Yes — via AsyncAPI | No | [`examples/services/stream.yaml`](examples/services/stream.yaml) |
| **ai-gate** | availability, latency | Yes | **Yes** — the point of the archetype | [`examples/services/ai-gate.yaml`](examples/services/ai-gate.yaml) |

Three things are worth drawing out, because they are the mistakes people
make when they start from the wrong archetype:

**A worker has no inbound contract.** Availability is the wrong question
for something that is not serving requests. Ask instead whether queued
work completed, and in time:

```yaml
  slo:
    - apiVersion: openslo/v1
      kind: SLO
      metadata:
        name: reconciliation-success-rate
      spec:
        service: invoice-reconciler
        objectives:
          - displayName: "99.5% of reconciliation jobs complete without error"
            target: 0.995
```

→ [`examples/services/worker.yaml`](examples/services/worker.yaml)

**A stream does have a contract** — consumers need a promise about
freshness and volume — but it points at an AsyncAPI document, and its
conditions are about consumption discipline rather than authentication:

```yaml
  contracts:
    - name: enriched-order-events
      api_ref:
        asyncapi: "./api/order-events.asyncapi.yaml"
      promise:
        availability: 0.999
        throughput: 20000rps
      conditions:
        - "Consumers commit offsets at least once per minute"
        - "Consumers tolerate at-least-once delivery and duplicate events"
```

→ [`examples/services/stream.yaml`](examples/services/stream.yaml)

**An ai-gate is an api plus judgment SLOs.** Classical SLOs tell you the
gate answered quickly and without erroring. They cannot tell you it
answered *well*. That gap is what [§5](#5-the-eight-judgment-slo-types)
is about.

## 4. Block by block

### 4.1 `owner` (required)

Who is accountable, as Backstage entity references — `<kind>:<namespace>/<name>`,
validated against that pattern. A bare team name like `payments` is
rejected; use `group:default/payments`.

```yaml
  owner:
    group: "group:default/sre-checkout"
    escalation: "group:default/sre-on-call"
    technical_contact: "user:default/priya.raman"
```

→ [`examples/services/api.yaml`](examples/services/api.yaml)

Only `group` is required. `escalation` is the rota to wake, which is
usually a different group from the one that owns the code, and
`technical_contact` is a named human for questions that are not
incidents.

There is no field here for Slack channels, PagerDuty IDs, runbook URLs
or email. v1 had them; v2 does not. Put them in `metadata.annotations`,
which is a free-form string map — see the migration example for the
convention.

### 4.2 `service` (required)

```yaml
  service:
    name: checkout-api
    description: "Creates and confirms customer checkout sessions"
```

→ [`examples/services/api.yaml`](examples/services/api.yaml)

`name` is the only required field. Spend a moment on `description`:
write what the service *does for whom*, not what it is built from. It is
the string a human sees when your service appears as somebody else's
dependency, and "Go service backed by Postgres" tells them nothing about
what breaks when it goes down.

### 4.3 `slo` — classical SLOs

Classical SLOs are OpenSLO v1 documents, either inline or referenced.
Both forms may be mixed in the same list:

```yaml
  slo:
    - $ref: "./slos/checkout-availability.yaml"
    - apiVersion: openslo/v1
      kind: SLO
      metadata:
        name: checkout-latency-p99
      spec:
        service: checkout-api
        objectives:
          - displayName: "99% of sessions confirmed under 300ms"
            target: 0.99
```

→ [`examples/services/api.yaml`](examples/services/api.yaml)

Prefer `$ref` once you have more than two or three. An OpenSLO document
in its own file is independently useful to any tool that understands
OpenSLO but has never heard of OpenSRM, and it keeps the manifest
readable as a summary rather than a wall of objectives.

**These are not validated here.** `spec/v2/schema.json` deliberately
checks only that each item is either a `$ref` or an object with
`kind: SLO` — the body is an OpenSLO document and belongs to the OpenSLO
schema. Validate them separately; a green `validate.sh` says nothing
about whether your objectives are well-formed.

### 4.4 `judgment_slo` — decision-quality SLOs

Same two forms, inline or `$ref`:

```yaml
  judgment_slo:
    - service: refund-approver
      judgment_type: reversal_rate
      measurement:
        window: 7d
        source: lineage
      target:
        maximum_reversal_rate: 0.05
    - $ref: "../judgment-slos/03-audit-sampling.yaml"
```

→ [`examples/services/ai-gate.yaml`](examples/services/ai-gate.yaml)

Unlike `slo`, these **are** fully validated: `judgment_type` selects one
of eight branches, each requiring its own `measurement`/`sampling`/
`probe`/`target` shape. Get the shape wrong and the fixture suite
catches it. [§5](#5-the-eight-judgment-slo-types) covers all eight.

### 4.5 `contracts` — what you promise callers

A contract is a promise to the services that call you. It is the block
that makes cross-service reasoning possible, and it is **not** the same
thing as your SLOs — see [§6](#6-conventions-and-gotchas), which is the
distinction most worth getting right in this whole guide.

```yaml
  contracts:
    - name: checkout-session-api
      api_ref:
        openapi: "./api/checkout-api.yaml"
        operation_id: "createSession"
      promise:
        availability: 0.999
        latency_p99: 500ms
        throughput: 5000rps
      conditions:
        - "Callers authenticate with a valid service token"
        - "Idempotency-Key header present on all POST requests"
      breach_semantics:
        consumer_notification: "webhook:https://checkout.example.com/contract-breach"
        sla_credits:
          enabled: false
      contract_owner: "group:default/checkout-platform"
```

→ [`examples/services/api.yaml`](examples/services/api.yaml)

`contracts` is a list because one service may promise different things
on different APIs — a read endpoint and a payment endpoint rarely
deserve the same number. v1's singular `contract` assumed one per
service.

`conditions` are the terms under which the promise holds. Write them
down even when they feel obvious: an unstated condition is one you
cannot point at when a caller hammers you without a rate limit and then
asks why you missed your number.

### 4.6 `dependencies` — what you expect from others

The mirror image of `contracts`. Your dependency's `promise` and your
`expected_*` values should agree; where they do not, a consumer can
surface the divergence before it becomes an incident.

```yaml
  dependencies:
    - service: "component:default/payment-service"
      contract_ref: "contract:payments/payment-authorisation-api"
      expected_availability: 0.999
      expected_latency_p99: 500ms
      fallback:
        type: fail_closed
        description: "Reject the checkout rather than confirm an unpaid session"
```

→ [`examples/services/api.yaml`](examples/services/api.yaml)

**There is no `critical:` flag in v2.** v1 had one. Express criticality
through `fallback` instead — it says what actually happens when the
dependency fails, which is both more useful and harder to write
thoughtlessly than a boolean. `fallback.type` is an open string, not an
enum; the examples here use `fail_closed`, `graceful_degradation`,
`retry_with_backoff` and `fail_open_to_human`. Agree on a vocabulary
within your organisation, because nothing in the schema will.

### 4.7 `instrumentation` — what the service must emit

The declaration that makes everything above computable, and a checklist
for the service owner:

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
      - span_name: "checkout.create_session"
        required_attributes: [checkout.session_id, customer.id]
    required_logs:
      - format: structured
        required_fields: [timestamp, level, service, trace_id]
```

→ [`examples/services/api.yaml`](examples/services/api.yaml)

`type` is a closed enum: `counter`, `gauge`, `histogram`, `summary`.

Services with judgment SLOs also need `required_events` — without a
decision event carrying the outcome and its later reversal, no judgment
SLO is computable at all:

```yaml
    required_events:
      - type: "io.nthlayer.decision.v1"
        schema_ref: "gen_ai.evaluation.result"
```

→ [`examples/services/ai-gate.yaml`](examples/services/ai-gate.yaml)

This block declares what the service **emits**, not what is built on top
of it. Dashboards, alert rules and trace sampling rates are not
manifest concerns in v2.

### 4.8 `template` — shared defaults

For organisations with many similar services, factor the common parts
into a `ServiceManifestTemplate`:

```yaml
apiVersion: opensrm.nthlayer.io/v2
kind: ServiceManifestTemplate
metadata:
  name: payment-services-base
  namespace: default
spec:
  slo:
    - $ref: "./slos/baseline-availability.yaml"
  instrumentation:
    required_metrics:
      - name: http_requests_total
        type: counter
        labels: [method, path, status]
```

→ [`examples/service-manifest-template.yaml`](examples/service-manifest-template.yaml)

and extend it from a manifest:

```yaml
spec:
  template:
    extends: "template:default/payment-services-base"
    overrides:
      slo:
        - append: ["./slos/payment-latency-p99.yaml"]
```

→ [`examples/template-extension.yaml`](examples/template-extension.yaml)

Resolution happens at load time and produces a fully expanded manifest.
**Inheritance is one level only** — a template may not extend another
template — which is a deliberate bound on resolution complexity, not an
oversight.

## 5. The eight judgment SLO types

Judgment SLOs are OpenSRM's original contribution — the part no other
standard specifies. They measure whether a service's decisions are
*sound*, which classical SLOs cannot express: a service can be fully
available, answer in 50ms, return HTTP 200 every time, and be wrong.

They apply to anything making consequential decisions, not just AI: ML
classifiers, rule engines, and human-in-the-loop approval queues all
qualify. If the service's output is a judgement someone could disagree
with, these apply.

Eight types are the standard vocabulary. Implementations MUST support
all eight; organisations MAY define more under their own `apiVersion`.
Each type below gives what it measures, when to reach for it, how to set
the target, what a breach means, and the mistake people make.

**Setting targets, generally.** Do not open with an aspiration.
Instrument first, measure your actual distribution over at least one
full measurement window, and set the initial target at or just inside
observed behaviour. A target you already miss on day one produces alert
fatigue and gets muted, which is worse than having no target. Tighten
once it holds.

### 5.1 `reversal_rate`

```yaml
spec:
  service: triage-agent
  judgment_type: reversal_rate
  measurement:
    window: 7d
    source: lineage
  target:
    maximum_reversal_rate: 0.05
  breach_actions:
    - notify: "group:default/sre-payments"
    - create_case:
        priority: P2
```

→ [`examples/judgment-slos/01-reversal-rate.yaml`](examples/judgment-slos/01-reversal-rate.yaml)

**Measures** how often a decision is later overturned — by a human, by
the service reconsidering, or by a downstream signal.

**Reach for it when** decisions are reviewable after the fact and you
can attribute the reversal back to the original decision. This is the
default first judgment SLO for most services: it is the easiest to
source and the easiest to explain to people outside the team.

**Setting the target** starts from your observed reversal rate.
`source` matters as much as the number: `lineage` means you trace the
reversal to the decision record, `downstream_signal` infers it from a
later event, `calibration_sample` measures it on a deliberately sampled
subset. They do not produce comparable rates, so do not copy a target
from a service using a different source.

**A breach means** the service is producing decisions that someone keeps
undoing — the decision quality has drifted, or the world changed and the
service did not.

**Common mistake:** counting *every* correction as a reversal, including
routine additional information arriving later. If the reversal was not
caused by the decision being wrong, it is noise in this metric.

### 5.2 `high_confidence_failure`

```yaml
spec:
  service: investigation-agent
  judgment_type: high_confidence_failure
  measurement:
    confidence_threshold: 0.9
    window: 30d
  target:
    maximum_failure_rate: 0.02
```

→ [`examples/judgment-slos/02-high-confidence-failure.yaml`](examples/judgment-slos/02-high-confidence-failure.yaml)

**Measures** how often decisions the service was *confident* about turn
out wrong.

**Reach for it whenever confidence gates behaviour** — where a
high-confidence decision skips human review, auto-applies, or short-cuts
a slower path. That is precisely where being wrong costs most, and it is
invisible in an overall accuracy number.

**Setting the target** requires picking `confidence_threshold` to match
wherever your system actually changes behaviour. If you auto-approve
above 0.85, measure at 0.85 — measuring at 0.9 leaves the riskiest band
unmonitored. The target rate should be materially tighter than your
overall error rate; if it is not, confidence is not carrying information.

**A breach means** the service is confidently wrong, which is a
calibration failure. Reducing autonomy is a proportionate response —
hence `reduce_autonomy` in the breach actions of
[`examples/services/ai-gate.yaml`](examples/services/ai-gate.yaml).

**Common mistake:** setting the threshold where it produces a
comfortable number rather than where the system's behaviour changes.

### 5.3 `audit_sampling`

```yaml
spec:
  service: moderation-agent
  judgment_type: audit_sampling
  sampling:
    overall_rate: 0.01
    stratified:
      - segment: high_stakes
        rate: 0.1
      - segment: low_confidence
        rate: 0.25
  target:
    audit_backlog_maximum_age: 24h
    audit_completion_rate: 0.95
```

→ [`examples/judgment-slos/03-audit-sampling.yaml`](examples/judgment-slos/03-audit-sampling.yaml)

**Measures** something different from the others: not decision quality
directly, but whether the *human audit process* that establishes ground
truth is actually running. It is the SLO on your measurement apparatus.

**Reach for it when** you have no automatic ground truth. Most reversal
and outcome signals ultimately rest on sampled human review; this
declares the sampling rate and holds the audit queue accountable.

**Setting the target** means stratifying. A flat `overall_rate` spends
your reviewers' scarce attention uniformly across decisions that do not
deserve it uniformly — sample high-stakes and low-confidence decisions
harder, as above. Then set `audit_completion_rate` and
`audit_backlog_maximum_age` to what your reviewer capacity can actually
sustain.

**A breach means** you have stopped auditing at the declared rate, so
every other judgment SLO fed by audit data is now running on stale or
thin evidence. Treat it as an integrity failure of the whole judgment
SLO set, not a minor process miss.

**Common mistake:** declaring a sampling rate the team has no capacity
to review, then quietly falling behind. The backlog target exists to
make that visible.

### 5.4 `outcomes`

```yaml
spec:
  service: remediation-agent
  judgment_type: outcomes
  outcome_signal:
    source: retrospective-analysis
    window: 1h
  target:
    desired_outcome_rate: 0.9
```

→ [`examples/judgment-slos/04-outcomes.yaml`](examples/judgment-slos/04-outcomes.yaml)

**Measures** whether decisions produced the result they were supposed
to. The strongest judgment signal available, because it skips the
question of whether the decision looked right and asks whether it
*worked*.

**Reach for it when** a downstream signal resolves the outcome —
remediation actually fixed the alert, the approved transaction did not
charge back, the routed ticket did not bounce.

**Setting the target** hinges on `window`: how long after the decision
you wait before judging it. Too short and you score decisions before
their effects land; too long and the signal arrives too late to act on.
Set it from how long the outcome genuinely takes to materialise, not
from how quickly you want the number.

**A breach means** the service's decisions are not achieving their
purpose, regardless of how defensible each one looked in isolation.

**Common mistake:** an outcome signal contaminated by the decision
itself. If a remediation is marked successful because the agent said so,
you are measuring the agent's self-report, not the outcome.

### 5.5 `escalation`

```yaml
spec:
  service: triage-agent
  judgment_type: escalation
  target:
    maximum_escalation_rate: 0.15
    escalation_human_agreement_rate: 0.8
```

→ [`examples/judgment-slos/05-escalation.yaml`](examples/judgment-slos/05-escalation.yaml)

**Measures** how often the service hands a decision to a human, and
whether those handoffs were justified. Note this type needs no
`measurement` block — only `target`.

**Reach for it when** the service can defer. Escalation is the safety
valve, and an unmonitored safety valve fails in both directions.

**Setting the target** means setting *both* numbers, which is the whole
point of the type. `maximum_escalation_rate` alone drives escalation
down, which a service can satisfy by confidently deciding things it
should have deferred. `escalation_human_agreement_rate` is the
counterweight: when the service escalates, the human should usually
agree that it needed a human. Constrain the pair or you have optimised
one into the other's failure.

**A breach means** either the service is dumping work on people (rate
too high) or escalating the wrong things (agreement too low). Which
number moved tells you which.

**Common mistake:** treating a low escalation rate as unambiguously
good. It is only good if agreement stays high.

### 5.6 `segments`

```yaml
spec:
  service: credit-decision-agent
  judgment_type: segments
  segment_dimension: customer_tier
  segment_values: [enterprise, smb, consumer]
  target:
    maximum_variance_from_overall: 0.05
```

→ [`examples/judgment-slos/06-segments.yaml`](examples/judgment-slos/06-segments.yaml)

**Measures** whether quality holds *evenly*. A service at 95% overall
that runs at 60% for one segment has a serious problem that the
aggregate hides.

**Reach for it whenever decisions affect identifiable groups** —
customer tiers, geographies, languages, request types. On decisions
affecting people, this is often the judgment SLO that matters most, and
aggregate metrics are structurally incapable of surfacing it.

**Setting the target** means choosing `segment_dimension` where you
suspect performance actually varies, not where the data is easiest to
join. Enumerate `segment_values` explicitly — a segment absent from the
list is not monitored.

**A breach means** at least one segment is being served materially worse
than the whole. Check which before assuming the model is at fault: thin
training data, a broken upstream join, or an unrepresentative audit
sample all produce this.

**Common mistake:** picking one dimension and calling the question
answered. Segment problems hide along the dimension you did not declare;
several `segments` SLOs on different dimensions is a reasonable manifest.

### 5.7 `stability`

```yaml
spec:
  service: content-classifier
  judgment_type: stability
  probe:
    frozen_input_set: "s3://probes/content-classifier-2026q1.jsonl"
    frequency: daily
  target:
    maximum_drift: 0.02
```

→ [`examples/judgment-slos/07-stability.yaml`](examples/judgment-slos/07-stability.yaml)

**Measures** whether the same inputs still get the same decisions. A
frozen probe set is replayed on a schedule and the answers compared
against the previous run.

**Reach for it when** the service's behaviour can change without its
code changing — model updates, prompt edits, retrieval-corpus drift,
upstream feature changes. This is the only type that catches silent
behavioural change, because it is the only one holding the input
constant.

**Setting the target** starts with the probe set, which is the real
work. It must be *frozen* and representative; a probe set of easy cases
will report stability you do not have. Version it — the path in the
example carries `2026q1` for that reason — and re-cut it deliberately,
never quietly.

**A breach means** decisions moved without anyone deciding they should.
That is not automatically bad (a model upgrade *should* change answers)
but it must be attributable to a change someone made.

**Common mistake:** refreshing the probe set to make drift go away. That
converts your one silent-change detector into a rubber stamp.

### 5.8 `calibration`

```yaml
spec:
  service: investigation-agent
  judgment_type: calibration
  measurement:
    bins: 10
    window: 30d
    method: brier_score
  target:
    maximum_brier_score: 0.05
```

→ [`examples/judgment-slos/08-calibration.yaml`](examples/judgment-slos/08-calibration.yaml)

**Measures** whether expressed confidence means anything: of the
decisions the service called 80% likely, are about 80% correct?

**Reach for it when** confidence values are consumed by anything —
routing, thresholds, autonomy levels. If confidence drives behaviour, it
needs its own SLO. Note the relationship to §5.2: `high_confidence_failure`
watches one end of the confidence range, `calibration` assesses the whole
curve.

**Setting the target** requires matching `method` to the target key.
`brier_score` pairs with `maximum_brier_score`;
`expected_calibration_error` pairs with
`maximum_expected_calibration_error`. `bins` controls the resolution of
the reliability curve — more bins need more data per bin to stay
meaningful.

**A breach means** the confidence signal is not trustworthy, so
everything downstream that gates on it is running on a number that does
not mean what it says.

**Common mistake:** the schema does **not** currently enforce that
`method` and the target key agree — you can declare `brier_score` and
set `maximum_expected_calibration_error`, and validation passes. Check
this pairing by eye. Binding the two is tracked in `opensrm-vquh`.

### 5.9 `breach_actions`

Any judgment SLO may declare what happens when it breaks. Four action
forms are available: `notify`, `create_case` (with a `P0`–`P3`
priority), `reduce_autonomy`, and `action_request`.

```yaml
      breach_actions:
        - create_case:
            priority: P1
        - reduce_autonomy:
            agent: refund-approver
            new_autonomy_level: recommend_only
```

→ [`examples/services/ai-gate.yaml`](examples/services/ai-gate.yaml)

`reduce_autonomy` is the one worth dwelling on: it lets a service
declare, in advance and in version control, how much authority it should
lose when its own quality degrades. Deciding that while things are calm
is much easier than deciding it mid-incident.

The manifest only *declares* these. Which consumer dispatches them, and
how, is deliberately out of scope.

## 6. Conventions and gotchas

### 6.1 `contracts` and `slo` are different things

This is the distinction most worth getting right, and the one people
most often collapse.

- **`slo`** is your *internal* target. What you hold yourselves to.
- **`contracts`** is your *external* promise. What callers may design
  against.

They should not be the same number. The contract is deliberately looser;
the gap between them is your operating margin — room to degrade, page
someone, and recover without breaking a promise to anyone else. In
[`examples/services/api.yaml`](examples/services/api.yaml) the internal
availability SLO is 0.9995 while the contract promises 0.999.

Collapsing them means every internal blip is simultaneously an external
breach, and you lose the ability to have a bad afternoon quietly. It
also weakens the dependency graph: your callers' `expected_availability`
should track your promise, not your private target.

### 6.2 Ratios are 0.0–1.0, never percentages

`0.999`, not `99.9`. This is the wire format, enforced by the `Ratio`
type (`minimum: 0`, `maximum: 1`).

The forgiving failure is writing `99.9` where `0.999` was meant: it is
rejected, loudly. The dangerous one is writing `0.99` for `99.9%` —
in range, silently valid, and an order of magnitude more error budget
than you intended. Nothing will catch that but review.

### 6.3 Durations are integer + unit

`100ms`, `7d`, `24h`. Units are `ms`, `s`, `m`, `h`, `d`, `w`. Not ISO
8601 (`PT1H`), not bare seconds (`3600`), not decimals (`1.5h` — use
`90m`).

### 6.4 Throughput is a string ending `rps`

`5000rps`, not `5000`. Applies to stream services too, where it reads as
events per second.

### 6.5 References are Backstage entity refs

`<kind>:<namespace>/<name>` — `group:default/sre-payments`,
`component:default/payment-service`. A bare `payments` or `sre-team` is
rejected. `metadata.name` is separately constrained to DNS style:
lowercase alphanumerics and hyphens.

### 6.6 What the schema does not check

Worth knowing precisely, because a green `validate.sh` is easy to
over-read:

- **Unknown keys are not rejected.** The schema does not set
  `additionalProperties: false` on `spec`, so a typo like `judgement_slo`
  or `contract` (singular, v1 habit) is silently ignored rather than
  flagged. Your block simply does nothing. This looseness is tracked in
  `opensrm-vquh`.
- **Classical SLO bodies are not validated** — only that each item is a
  `$ref` or carries `kind: SLO` ([§4.3](#43-slo--classical-slos)).
  Validate them against the OpenSLO schema separately.
- **`$ref` targets are not resolved.** A reference to a file that does
  not exist validates happily.
- **`method` and target keys are not bound** for `calibration`
  ([§5.8](#58-calibration)).
- **Nothing restricts judgment SLOs to decision-making services**, since
  v2 has no `spec.type` ([§3](#3-choosing-a-starting-point)).

In short: the schema checks shape, not sense. It will not tell you your
SLO is wrong, only that it is well-formed.

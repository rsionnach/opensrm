# Authoring OpenSRM v2 manifests

A practical guide to writing an OpenSRM v2 `ServiceManifest`: what each
block is for, which ones your service actually needs, how to express all
eight judgment SLO types, and how to migrate from v1.

> **Status: v2 is a draft.** `spec/v1/` remains canonical. v2 is
> specified in [`../../OPENSRM-CORE-v2.md`](../../OPENSRM-CORE-v2.md) and
> validated by [`schema.json`](schema.json). Write v2 manifests today if
> you want the eight-type judgment SLO framework or the OpenSLO/Backstage
> composition; expect the draft to move before it stabilises.

Every YAML block in this guide is an excerpt from a real file, linked
beneath it. Excerpts are trimmed for the point being made — follow the
link for the complete manifest. Everything under
[`examples/`](examples/) is checked by [`validate.sh`](validate.sh) on
every run; the one exception is the **v1** "before" blocks in
[§7](#7-migrating-from-v1), which are excerpted from the real v1
manifest at [`examples/api-full.yaml`](../../examples/api-full.yaml) in
the repo root and are, correctly, not valid under the v2 schema.

## Contents

1. [What a manifest is for](#1-what-a-manifest-is-for)
2. [The envelope](#2-the-envelope)
3. [Choosing a starting point](#3-choosing-a-starting-point)
4. [Block by block](#4-block-by-block)
5. [The eight judgment SLO types](#5-the-eight-judgment-slo-types)
6. [Conventions and gotchas](#6-conventions-and-gotchas)
7. [Migrating from v1](#7-migrating-from-v1)
8. [Validating your manifest](#8-validating-your-manifest)

New to OpenSRM? Read in order. Migrating an existing v1 manifest? Start
at [§7](#7-migrating-from-v1), which points back into the detail.
Writing your first judgment SLO? [§5](#5-the-eight-judgment-slo-types)
stands alone.

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
| `ServiceManifestTemplate` | Shared defaults a manifest extends ([§4.8](#48-template--shared-defaults)). |

The smallest manifest the schema accepts needs only an owner and a
service identity — and an identity means both `name` and `type`
([§3.1](#31-the-type-field)):

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
    type: api
```

→ [`examples/minimal.yaml`](examples/minimal.yaml)

That is valid but useless — it declares ownership and a typed identity
and nothing else. It is worth knowing as the floor, because it tells you
the schema will not stop you shipping an empty manifest. Everything
below is optional as far as the validator is concerned; whether it is
optional for *you* is the subject of the rest of this guide.

`apiVersion` is exactly `opensrm.nthlayer.io/v2` and `kind` is exactly
`ServiceManifest` — both are constants, not patterns. A v1 `apiVersion:
opensrm/v1` document is rejected outright.

## 3. Choosing a starting point

Rather than start from the empty manifest, start from the archetype that
matches your service and delete what does not apply.

What distinguishes the archetypes is which blocks they use:

| Archetype | `type` | Characteristic SLOs | `contracts`? | `judgment_slo`? | Example |
|---|---|---|---|---|---|
| **api** | `api` | availability, latency | Yes — callers need a promise | No | [`examples/services/api.yaml`](examples/services/api.yaml) |
| **worker** | `worker` | success rate, processing time | No — nothing calls it synchronously | No | [`examples/services/worker.yaml`](examples/services/worker.yaml) |
| **stream** | `stream` | consumer lag, throughput | Yes — via AsyncAPI | No | [`examples/services/stream.yaml`](examples/services/stream.yaml) |
| **ai-gate** | `ai-gate` | availability, latency | Yes | **Yes** — the point of the archetype | [`examples/services/ai-gate.yaml`](examples/services/ai-gate.yaml) |

`spec.service.type` records which one you picked, and the schema uses it —
declaring judgment SLOs on anything but an `ai-gate` is rejected
([§3.1](#31-the-type-field)).

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

### 3.1 The `type` field

`spec.service.type` is required, and takes one of six values: `api`,
`worker`, `stream`, `ai-gate`, `batch`, `database`. It does one job beyond
documentation: **the schema rejects `judgment_slo` on any type but
`ai-gate`.**

```yaml
  service:
    name: refund-approver
    type: ai-gate            # required; permits the judgment_slo block
```

→ [`examples/services/ai-gate.yaml`](examples/services/ai-gate.yaml)

An `ai-gate` is permitted to declare judgment SLOs, not obliged to — adopt
the type first, author the judgment SLOs when you are ready.

If none of the six fits, an implementation may define its own type under
the reserved `x-` prefix (`^x-[a-z][a-z0-9-]*$`) — `x-cache`, `x-web`. A
bare custom type is rejected: it must carry the prefix, so a reader can
always tell a standard type from a local one.

→ [`examples/x-service-type.yaml`](examples/x-service-type.yaml)

**Why this reads as a v2 addition but is really a v1 restoration.** v1 had
`spec.type` and made the rule normative: `spec/v1/specification.md` §11
lists type-specific validation as a **MUST** ("judgment SLOs only valid
for `ai-gate` type"), and the schema listing embedded in that document
implements it as an `if`/`then`. The *shipped* `spec/v1/schema.json` never
implemented that conditional, and left `type` optional — so two of v1's
own examples omit the field entirely and the MUST could never bite. The v2
draft then dropped the field, and the rule with it. It is now required,
and enforced in the artefact rather than only in prose.

The six values are v1's own. `spec/v1/schema.json`'s `ServiceType` enum
already listed exactly `api`, `worker`, `stream`, `ai-gate`, `batch`,
`database`; it is v1's *prose* (`spec/v1/specification.md` §3.1) that
tabulates only the first four. v2 adopts the shipped enum verbatim and
adds the `x-` extension branch — nothing else.

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
    type: api
    description: "Creates and confirms customer checkout sessions"
```

→ [`examples/services/api.yaml`](examples/services/api.yaml)

`name` and `type` are required; `description` is not. For `type`, see
[§3.1](#31-the-type-field). Spend a moment on `description`:
write what the service *does for whom*, not what it is built from. It is
the string a human sees when your service appears as somebody else's
dependency, and "Go service backed by Postgres" tells them nothing about
what breaks when it goes down.

### 4.3 `slo` — classical SLOs

Classical SLOs are OpenSLO v1 documents, either inline or referenced.
Both forms may be mixed in the same list:

```yaml
  slo:
    - apiVersion: openslo/v1
      kind: SLO
      metadata:
        name: checkout-availability
      spec:
        service: checkout-api
        objectives:
          - displayName: "99.95% of checkout sessions served successfully"
            target: 0.9995
    - $ref: "./slos/checkout-latency-p99.yaml"
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

This block is only permitted on a service whose `spec.service.type` is
`ai-gate`; the schema rejects it on any other type
([§3.1](#31-the-type-field)). Same two forms as `slo`, inline or `$ref`:

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
thing as your SLOs — see
[§6.1](#61-contracts-and-slo-are-different-things).

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

Two warnings, because both of these fail late rather than at validation:

- **The one-level rule is not enforced by the schema.** A
  `ServiceManifestTemplate` that itself carries `template.extends`
  validates cleanly. You will not find out you built a two-level chain
  until a loader rejects it.
- **`overrides` has no defined grammar.** The schema types it as a bare
  object, so anything at all validates —
  `overrides: {slooo: [{wibble: 1}]}` passes. `append` above is the verb
  shown in `OPENSRM-CORE-v2.md` §9, but it is illustrated rather than
  specified, and a misspelled key silently does nothing. Until it is
  specified, treat `overrides` as the least safe block in the format and
  check any expansion by hand.

## 5. The eight judgment SLO types

Judgment SLOs are OpenSRM's original contribution — the part no other
standard specifies. They measure whether a service's decisions are
*sound*, which classical SLOs cannot express: a service can be fully
available, answer in 50ms, return HTTP 200 every time, and be wrong.

They apply to anything making consequential decisions, not just AI: ML
classifiers, rule engines, and human-in-the-loop approval queues all
qualify. If the service's output is a call someone could disagree
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
make that visible. The opposite error is quieter and worse: an
`overall_rate` of `0` validates, and starves every judgment SLO that
depends on audit-derived ground truth without any of them reporting a
breach.

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
Watch the degenerate case too: a single entry in `segment_values`
validates, and compares that one segment against the overall figure. If
it is the dimension's only value, the variance is identically zero and
the SLO can never fire; if it is not, everything you left off the list
goes unmonitored.

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
meaningful, and the schema floors it at 2, since one bin is not a curve.

**A breach means** the confidence signal is not trustworthy, so
everything downstream that gates on it is running on a number that does
not mean what it says.

**Common mistake:** comparing calibration numbers computed with
different `bins` or a different `method` and treating the difference as
a change in quality. Neither metric is comparable across configurations
— if you re-tune `bins`, your history restarts.

### 5.9 `breach_actions` — applies to all eight

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
someone, and recover without breaking a promise to anyone else.

The `api` archetype shows the pattern. Its `slo` block is the internal
target:

```yaml
  slo:
    - apiVersion: openslo/v1
      kind: SLO
      metadata:
        name: checkout-availability
      spec:
        service: checkout-api
        objectives:
          - displayName: "99.95% of checkout sessions served successfully"
            target: 0.9995
```

→ [`examples/services/api.yaml`](examples/services/api.yaml)

Its `contracts` block promises callers less:

```yaml
  contracts:
    - name: checkout-session-api
      api_ref:
        openapi: "./api/checkout-api.yaml"
        operation_id: "createSession"
      promise:
        availability: 0.999
```

→ [`examples/services/api.yaml`](examples/services/api.yaml)

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

**The endpoints are legal and almost always wrong.** `0` and `1` are
both in range, so a `maximum_reversal_rate: 1` (nothing can ever breach
it), an `expected_availability: 1` (a dependency that never fails), or
an `audit_sampling` `overall_rate: 0` (sample nothing) all validate. A
target at an endpoint is usually a placeholder somebody forgot to
replace. The same goes for `0s` durations and `0rps` throughputs, and
for a contract whose `promise: {}` is empty — it promises nothing at all
while looking like a contract.

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
  flagged. Your block simply does nothing. This looseness is a known gap
  in the draft schema, tracked internally as `opensrm-vquh`.
- **Classical SLO bodies are not validated** — only that each item is a
  `$ref` or carries `kind: SLO` ([§4.3](#43-slo--classical-slos)).
  Validate them against the OpenSLO schema separately.
- **`$ref` targets are not resolved.** A reference to a file that does
  not exist validates happily, and fails when a loader tries to expand
  it. Validation-time green, load-time red.
- **Template nesting is not caught.** A `ServiceManifestTemplate` whose
  own `spec` carries `template.extends` validates, despite one-level
  inheritance being the rule ([§4.8](#48-template--shared-defaults)).
  So does an `extends` naming a template that does not exist.
- **Nothing inside `overrides` is checked** — it is typed as a bare
  object, so a misspelled merge key validates and silently no-ops.
- **`method` and target keys are not bound** for `calibration`
  ([§5.8](#58-calibration)).
- **Judgment SLOs arriving via a template are not type-checked.** The
  schema forbids `judgment_slo` on a non-`ai-gate` manifest
  ([§3.1](#31-the-type-field)), but a `ServiceManifestTemplate` may carry
  `judgment_slo` and has no required `type` to check it against. Template
  resolution happens at load time, outside validation, so a `worker`
  extending such a template validates. Implementations are required to
  revalidate after expansion (`OPENSRM-CORE-v2.md` §13); the schema alone
  does not catch it.

In short: the schema checks shape, not sense. It will not tell you your
SLO is wrong, only that it is well-formed.

## 7. Migrating from v1

The conceptual model barely changes. The syntax changes a great deal,
because v2 replaced most of v1's bespoke blocks with references to
established standards.

This section works through a real migration:
[`examples/api-full.yaml`](../../examples/api-full.yaml) at the repo
root — an actual v1 manifest for `payment-api` — becoming
[`examples/migration/api-full-v2.yaml`](examples/migration/api-full-v2.yaml).
Both files are real, and the v2 result is in the validated fixture set.

### 7.1 The map

| v1 | v2 | Kind of change |
|---|---|---|
| `apiVersion: opensrm/v1`, `kind: ServiceReliabilityManifest` | `apiVersion: opensrm.nthlayer.io/v2`, `kind: ServiceManifest` | Rename |
| `metadata.team` / `.tier` / `.description` | `spec.owner`, `metadata.labels.tier`, `spec.service.description` | Moved |
| `spec.type` (four values in v1's prose, six in `spec/v1/schema.json`) | `spec.service.type` — v1's shipped six, adopted verbatim | Moved ([§3.1](#31-the-type-field)) |
| `spec.slos` (bespoke) | `spec.slo` — OpenSLO v1 documents | **Rewrite** |
| `spec.contract` (singular) | `spec.contracts` (list) | Renamed + pluralised |
| `spec.dependencies[].type` | Carried by the Backstage ref kind | Reshaped |
| `spec.dependencies[].critical` | `fallback` | Reshaped (lossy — needs a decision) |
| `spec.dependencies[].manifest` (URL) | Catalogue lookup by entity ref | **No equivalent** |
| `spec.ownership` | `spec.owner` + `metadata.annotations` | Partly lossy |
| `spec.observability.metrics` | `spec.instrumentation` | Reshaped, stricter |
| `spec.notifications` | Per-contract / per-judgment-SLO | **No equivalent** |
| `spec.observability.dashboards` / `.alerts` | — | **No equivalent** |
| `spec.observability.tracing.sampling_rate` | — | **No equivalent** |
| `spec.deployment` (gates, rollback) | — | **No equivalent** |
| — | `spec.judgment_slo` | New in v2 |

Steps 1–5 of `OPENSRM-CORE-v2.md` §12 give the official sequence. The
rest of this section is what that sequence looks like in practice.

### 7.2 Ownership becomes entity references

v1:

```yaml
  ownership:
    team: payments
    slack: "#payments-team"
    email: payments@example.com
    escalation: payments-oncall
```

→ [`examples/api-full.yaml`](../../examples/api-full.yaml)

v2 keeps the accountability fields as entity references:

```yaml
  owner:
    group: "group:default/payments"
    escalation: "group:default/payments-oncall"
    technical_contact: "user:default/payments-lead"
```

→ [`examples/migration/api-full-v2.yaml`](examples/migration/api-full-v2.yaml)

and the contact channels move to annotations, because `spec.owner` has
nowhere to put them:

```yaml
  annotations:
    backstage.io/component-ref: "component:default/payment-api"
    backstage.io/techdocs-ref: "dir:."
    opensrm.nthlayer.io/runbook: "https://wiki.example.com/payment-api-runbook"
    opensrm.nthlayer.io/documentation: "https://docs.example.com/payment-api"
    pagerduty.com/service-id: "PXXXXXX"
    slack.com/channel: "#payments-team"
```

→ [`examples/migration/api-full-v2.yaml`](examples/migration/api-full-v2.yaml)

Bare names become entity refs: `payments` → `group:default/payments`.
The annotation keys above are a convention, not a schema requirement —
`annotations` is an unconstrained string map, so agree on keys across
your organisation or they will be useless to tooling.

### 7.3 SLOs become OpenSLO documents

The largest mechanical change, and the one most amenable to tooling —
v1 SLO syntax maps 1:1.

v1:

```yaml
  slos:
    availability:
      target: 0.9995
      window: 30d
```

→ [`examples/api-full.yaml`](../../examples/api-full.yaml)

v2:

```yaml
  slo:
    - apiVersion: openslo/v1
      kind: SLO
      metadata:
        name: payment-api-availability
      spec:
        service: payment-api
        objectives:
          - displayName: "99.95% availability over 30 days"
            target: 0.9995
```

→ [`examples/migration/api-full-v2.yaml`](examples/migration/api-full-v2.yaml)

Note what the validator will and will not do for you here: it checks the
item carries `kind: SLO` and nothing more
([§4.3](#43-slo--classical-slos)). A malformed objective passes
`validate.sh` and fails only against the OpenSLO schema. Run both.

### 7.4 `contract` becomes `contracts`

v1:

```yaml
  contract:
    availability: 0.9995
    latency:
      p99: 300ms
    throughput:
      max_rps: 5000
```

→ [`examples/api-full.yaml`](../../examples/api-full.yaml)

v2:

```yaml
  contracts:
    - name: payment-api
      api_ref:
        openapi: "./api/payment-api.yaml"
      promise:
        availability: 0.9995
        latency_p99: 300ms
        throughput: 5000rps
      contract_owner: "group:default/payments"
```

→ [`examples/migration/api-full-v2.yaml`](examples/migration/api-full-v2.yaml)

Three changes in one block: the key is now plural and takes a list;
nested `latency.p99` flattens to `latency_p99`; and `throughput.max_rps:
5000` (a bare integer) becomes `throughput: 5000rps` (a string).

> **The trap.** Leaving the key as singular `contract:` **validates**.
> The schema does not reject unknown keys
> ([§6.6](#66-what-the-schema-does-not-check)), so a v1 manifest whose
> contract block was never renamed passes cleanly and declares no
> contract at all. Nothing warns you. After migrating, grep for the v1
> key names before trusting a green run.

Note also that the migrated promise (`availability: 0.9995`) repeats the
internal availability target from [§7.3](#73-slos-become-openslo-documents)
exactly. That was defensible in v1, where the two were one field. In v2 they are separate on purpose — see
[§6.1](#61-contracts-and-slo-are-different-things) and consider loosening
the promise to give yourself margin.

### 7.5 Dependencies lose `critical` and `type`

v1:

```yaml
  dependencies:
    - service: postgresql
      type: database
      critical: true
      expects:
        availability: 0.9995
```

→ [`examples/api-full.yaml`](../../examples/api-full.yaml)

v2:

```yaml
  dependencies:
    - service: "resource:default/postgresql"
      expected_availability: 0.9995
      fallback:
        type: fail_closed
        description: "v1 critical: true — no payment can be recorded without the store"
```

→ [`examples/migration/api-full-v2.yaml`](examples/migration/api-full-v2.yaml)

`type: database` is carried by the entity ref kind (`resource:` rather
than `component:`). `critical: true` has no v2 field at all — express it
as a `fallback`, which is an improvement in disguise: `critical: true`
records how much you care, while `fail_closed` records what actually
happens. The latter is what a blast-radius calculation needs.

This does mean the migration is **lossy in one direction**: a tool
converting v1→v2 cannot derive the fallback behaviour automatically. It
has to ask. Budget for that; it is the one part of the migration that is
not mechanical.

Also gone: `manifest:`, the URL pointing at the dependency's own
manifest. v2 resolves the entity ref through the catalogue instead.

### 7.6 What has nowhere to go

Four v1 blocks have no v2 equivalent. Do not delete them from your v1
manifest until they have a home:

- **`spec.notifications`** — v2 has no service-level notification block.
  Breach notification is per-contract
  (`contracts[].breach_semantics.consumer_notification`) or per judgment
  SLO (`breach_actions[].notify`). Routing every event type to a Slack
  channel is a deployment concern in v2, not a manifest one.
- **`spec.observability.dashboards` / `.alerts`** — `instrumentation`
  declares what the service must *emit*, not what is built on top.
- **`spec.observability.tracing.sampling_rate`** — collector
  configuration. v2 declares required spans, not sampling.
- **`spec.deployment`** — gates and rollback criteria. This is the
  significant one: v1 let you gate a deploy on error budget from the
  manifest itself. v2 has no deployment block, so that logic moves to
  your CD pipeline — which can still read the SLOs above to make the
  same decisions, but must now be told to.

### 7.7 Suggested order

1. Rename the envelope and confirm it validates. Everything else fails
   loudly until this is right.
2. Convert `slos` → `slo` as OpenSLO documents. Largest change,
   automatable, and independently testable.
3. Rename `contract` → `contracts`, then **grep for the old key** to
   confirm nothing was left behind ([§7.4](#74-contract-becomes-contracts)).
4. Rewrite `dependencies` — the manual step, since fallbacks need a
   decision per dependency.
5. Move `ownership` to `owner` plus annotations.
6. Reshape `observability.metrics` into `instrumentation`, adding the
   `type` each metric now needs.
7. Park the four homeless blocks somewhere before deleting them.
8. Only now consider adding `judgment_slo`
   ([§5](#5-the-eight-judgment-slo-types)) — new capability, not
   migration. Do it as its own change, and note that it requires
   `spec.service.type: ai-gate` ([§3.1](#31-the-type-field)); on any
   other type the schema rejects the block.

## 8. Validating your manifest

Validate a single file:

```bash
uvx check-jsonschema --schemafile spec/v2/schema.json path/to/manifest.yaml
```

Run the whole fixture suite — every file under `examples/` must
validate, and every file under `tests/invalid/` must be rejected:

```bash
bash spec/v2/validate.sh
```

The negative half matters as much as the positive half. It is what
stops the schema from degrading into one that rubber-stamps anything.
If you add a constraint, add a fixture under `tests/invalid/` that
proves the constraint bites.

**What green means.** Your manifest is well-formed: the envelope is
right, required fields are present, ratios are in range, durations and
throughputs are correctly shaped, entity refs parse, and any judgment
SLO matches its type's required shape.

**What green does not mean.** Read
[§6.6](#66-what-the-schema-does-not-check) before treating a pass as
approval. In particular a green run does not tell you that a key is
spelled right, that your OpenSLO bodies are valid, that a `$ref`
resolves, or that any target is a sensible number.

`validate.sh` is not yet wired into CI. Until it is, run it yourself
before committing a manifest change. That wiring, and the schema
hardening noted in [§6.6](#66-what-the-schema-does-not-check), are
tracked internally as `opensrm-vquh`.

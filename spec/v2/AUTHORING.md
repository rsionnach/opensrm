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

# OpenSRM v2 service type discriminator — design

**Bead:** opensrm-6w9d (P3) — split out of opensrm-tu04.3 on 2026-08-15.
**Date:** 2026-08-17
**Depends on:** opensrm-tu04.3 (`spec/v2/AUTHORING.md` on main) — closed.
**Scope:** `opensrm` repo only. Implementation changes are filed as
follow-ups, not done here.

## Goal

Decide whether OpenSRM v2 reintroduces a service type discriminator, then
make the decision normative and enforced.

**Decision (Rob, 2026-08-17): reintroduce it as `spec.service.type`,
required, with the six v1 values plus an extension escape hatch, and
enforce one type-conditional rule in the schema.**

## Why the bead's framing changed

The bead offered two exits: document the omission as intentional, or
reintroduce the field. Investigation showed the first exit is not
available — it would document something the reference implementation
already contradicts.

Three findings drove this.

**1. The discriminator never actually went away.** `nthlayer-common`
*requires* a service type:
`src/nthlayer_common/manifest/models.py:827` raises
`"Service type is required"`, and `:834` validates it against a
seven-value `VALID_SERVICE_TYPES` (`:45-53`). Since v2 has no field to
read, `src/nthlayer_common/manifest/parser/v2.py:215-244` invents one:
`_infer_service_type()` reads **`metadata.labels.type`** first
(`:229-231`), falls back to two heuristics, then hard-raises. The v1→v2
upconverter writes v1's `spec.type` into that label
(`src/nthlayer_common/manifest/v1_compat.py:222-226`).

`metadata.labels.type` is specified nowhere in OpenSRM. The
implementation's error message instructs authors to set it
(`parser/v2.py:242-244`). So v2 already has a required discriminator — it
is undocumented, and it lives in a free-form `StringMap` with no reserved
keys (`spec/v2/schema.json:50-53, 65`).

**2. Three of the four shipped v2 archetype examples fail the reference
parser.** `spec/v2/examples/services/{api,worker,stream}.yaml` carry
`labels: {domain, tier}` only — no `labels.type`, no `judgment_slo`, no
`required_events[].type` containing `"decision"`. All three hit the raise
at `parser/v2.py:242`. `validate.sh` is green on all four. No test covers
the seam. (Compounded, separately, by `tier: important` in
`worker.yaml:19` and `stream.yaml:18` failing `VALID_TIERS` at
`models.py:37-42`.)

**3. The inference is unsound in exactly the direction `AUTHORING.md`
§3.1 warns about.** `parser/v2.py:233-235` infers `ai-gate` *from the
presence of* `judgment_slo`. v1's rule ran the other way — `ai-gate`
*permits* judgment SLOs. Because nothing restricts judgment SLOs, a
worker that wrongly declares one is not caught; it is silently
**reclassified as an `ai-gate`** and routed into ai-gate-only codepaths:
recording-rule groups (`nthlayer-generate/src/nthlayer_generate/recording_rules/manifest_builder.py:55,
551`), judgment contract validation and instrumentation serialisation
(`specs/manifest.py:729, 819`), and the remediation LLM prompt
(`nthlayer-workers/src/nthlayer_workers/respond/agents/base.py:291-298`).
The missing constraint does not merely fail to catch an authoring error —
it converts it into a wrong classification.

### The Backstage hypothesis is unsupported

The bead hypothesised the omission might be deliberate, with v2 leaning on
Backstage entity metadata for categorisation. Across every Backstage
mention in the repo, its role is exactly three things: the
`apiVersion/kind/metadata/spec` envelope shape, `EntityRef` syntax for
ownership and cross-references, and annotation-based linking.
`OPENSRM-CORE-v2.md:59-62` draws the division of labour explicitly —
*"ownership lives in Backstage and reliability intent lives in OpenSRM"* —
and categorisation is not among the roles assigned. Backstage's own
`Component.spec.type` is never mentioned anywhere in the repo. Integration
is optional at SHOULD level (`OPENSRM-CORE-v2.md:658`,
`ARCHITECTURE.md:236`), so outsourcing categorisation to it would leave
standalone deployments with none.

Decisively: §12 Migration (`OPENSRM-CORE-v2.md:633-641`) is where a
deliberate removal would be recorded, and `spec.type` appears nowhere in
it — the only v1 field to vanish without a migration note. §15 Open
Questions (`:682-688`) lists four other deferrals and not this one. The
silence reads as oversight.

## Resolved decisions

### Location: `spec.service.type`

A first-class field on the identity block, not a blessed
`metadata.labels.type`. Labels are free-form with no reserved keys; a
discriminator that conditional validation depends on belongs in the
schema's typed surface.

### Optionality: required

`ServiceIdentity` goes from `required: ["name"]` to
`required: ["name", "type"]`.

v1's failure mode was precisely an optional discriminator.
`spec/v1/schema.json:1259-1294` left `type` optional (the `Spec`
definition has no `required` array at all), so two shipped v1 examples —
`examples/api-full.yaml` and `examples/api-internal.yaml` — omit it
entirely, and the type-conditional MUST at
`spec/v1/specification.md:977` could never bite. An optional
discriminator yields conditional validation only for authors who opt in,
which reproduces the normative-but-unenforced shape this bead exists to
escape.

Required also lets `_infer_service_type()` be **deleted** rather than
retained as a fallback, removing the unsound inversion at its root
instead of guarding it.

Costs, accepted: this is a breaking change to the v2 draft; eight in-repo
manifests gain a mandatory line; `examples/minimal.yaml` — the fixture
asserting the schema's floor — grows a second required field; and
`AUTHORING.md:207` must stop claiming `name` is the only required field.

### Vocabulary: six v1 values plus an `x-` extension rule

```json
"ServiceType": {
  "oneOf": [
    { "enum": ["api", "worker", "stream", "ai-gate", "batch", "database"] },
    { "type": "string", "pattern": "^x-[a-z][a-z0-9-]*$" }
  ]
}
```

The `"type": "string"` in the second branch is load-bearing, not
decoration. JSON Schema applies `pattern` only to strings, so a
pattern-only branch accepts any non-string: verified that
`type: 5`, `type: true`, `type: {a: 1}` and `type: [x]` all validate
without it, and all four are rejected with it.

Five mutually inconsistent type vocabularies exist today:

| Source | Values |
|---|---|
| `spec/v1/schema.json:26-37` | api, worker, stream, ai-gate, batch, database |
| `spec/v1/specification.md:1219-1222` | api, worker, stream, ai-gate |
| `docs/spec-conventions.md:24-35` | the six, with different SLO mappings |
| `nthlayer-common/…/manifest/models.py:45-53` | the six plus `web`; aliases `background-job→worker`, `pipeline→batch` |
| `nthlayer-generate/…/metrics/templates/registry.py:20-42` | api, grpc, worker, queue-consumer, database-client, gateway, cache (+14 aliases) |

The six v1 shipped-schema values are the choice because
`examples/batch-etl.yaml:18` and `examples/database-mysql.yaml:19` are
shipped v1 examples using `batch` and `database`; a four-value enum makes
them unmigratable.

`web` is explicitly an NthLayer extension —
`nthlayer-generate/tests/test_opensrm.py:450` asserts
`"web" in VALID_SERVICE_TYPES  # NthLayer extension`. Absorbing it into
the spec would have OpenSRM own a downstream invention; omitting it with
no escape hatch would make an nthlayer-valid manifest OpenSRM-invalid —
the same seam in reverse. The `x-` prefix resolves both: `web` becomes
`x-web` (or is remapped) in the follow-up, and the next extension needs
no spec revision.

The `registry.py` vocabulary is a different axis — metric-template
selection keyed by a type string, where `get_template("ai-gate")` returns
`None` (`:56`) because neither `ai-gate` nor `stream` has a template. That
is a latent gap independent of this decision and does not drive the enum.
Filed separately.

### Conditional: forbid `judgment_slo` on non-`ai-gate`, and nothing else

One enforced branch, added to `definitions.ServiceManifest`:

```json
"allOf": [
  {
    "if": {
      "properties": {
        "spec": {
          "properties": {
            "service": {
              "properties": { "type": { "not": { "const": "ai-gate" } } },
              "required": ["type"]
            }
          },
          "required": ["service"]
        }
      },
      "required": ["spec"]
    },
    "then": {
      "properties": { "spec": { "not": { "required": ["judgment_slo"] } } }
    }
  }
]
```

This restores v1's single type-conditional MUST
(`spec/v1/specification.md:977`, *"Judgment SLOs only valid for `ai-gate`
type"*) and enforces it in the shipped artefact this time. It becomes
v2's twelfth `if` and its first conditioned on the service rather than on
document `kind` or `judgment_type` — the technique is already used
thoroughly for the eight judgment-SLO shapes
(`spec/v2/schema.json:184-375`), so only the discriminator was missing.

Deliberately excluded, with reasons:

- **`breach_actions[].reduce_autonomy`** (`schema.json:399-410`) is
  AI-agent-specific, but it lives inside a judgment SLO, so gating
  `judgment_slo` covers it transitively. No separate rule.
- **`contracts`** — *"a worker has no inbound contract"*
  (`AUTHORING.md:114`) is a documentation observation, not an invariant.
  Forbidding `contracts` on `worker`/`batch` would be prescriptive and
  likely wrong.
- **`api_ref.openapi` vs `.asyncapi`** (`schema.json:433-437`) — both are
  optional siblings with no `oneOf`, so a manifest can set both. That is
  a missing `oneOf`, fixable with no reference to type. Belongs with the
  `additionalProperties` work already scoped in **opensrm-vquh**.
- **The v1 converse branch** — v1's prose schema
  (`spec/v1/specification.md:1637-1666`) also required `ai-gate` services
  to declare judgment SLOs. That is the check
  `nthlayer-generate/…/specs/manifest.py:520-524` deliberately stubs to a
  no-op (*"Warning, not error - might be added later"*). Taking the
  forbid direction only keeps a partially-authored ai-gate valid.

### Template identity: split the definition

`ServiceManifestTemplate.spec.service` currently `$ref`s the same
`ServiceIdentity` (`schema.json` `ServiceManifestTemplate`), under a
description reading *"All fields optional; owner/service are supplied by
the extending manifest."* Adding `type` to `ServiceIdentity.required`
would falsify that description for any template supplying a partial
`service` block.

The shipped fixture `spec/v2/examples/service-manifest-template.yaml` has
**no `service:` block at all**, so nothing breaks today — but the shared
definition would make the constraint arrive by accident later.

Resolution: give the template its own all-optional identity definition
(`TemplateServiceIdentity`), leaving `ServiceIdentity` honest for
manifests. v1 set the precedent — `Spec` (`spec/v1/schema.json:1259`) and
`TemplateSpec` (`:1345`) each carried `type` independently.

This also avoids a pre/post-resolution ambiguity: if a template could
supply an inherited `type`, a manifest omitting `type` would still be
rejected by the schema, which validates the pre-resolution document.
Manifests declare their own type; templates do not supply it.

### Verification

Every schema claim in this document was prototyped against
`spec/v2/schema.json` with `jsonschema.Draft7Validator` before being
written down, rather than reasoned about. Twelve cases, all matching
expectation:

| Case | Expected |
|---|---|
| `api`, no judgment | valid |
| `ai-gate` + judgment | valid |
| `ai-gate`, no judgment | valid (converse branch deliberately absent) |
| `worker` + judgment — `n13` | reject |
| `batch` + judgment | reject |
| `x-web`, no judgment | valid |
| `x-web` + judgment | reject |
| missing `type` — `n14` | reject |
| `type: gateway` — `n15` | reject |
| `type: x-` (prefix, no suffix) | reject |
| template with partial `service`, no `type` | valid |
| all 8 `judgment-slos/*.yaml` fixtures | valid, unchanged |

The prototype is throwaway; implementation happens under the plan.

## Known limit: template extension bypasses the conditional

`ServiceManifestTemplate.spec` may carry `judgment_slo` — and the shipped
fixture does (`judgment_slo: []`). A template carrying real judgment SLOs,
extended by a manifest declaring `type: worker`, bypasses the conditional:
resolution happens at load time outside the schema, and
`TemplateExtension.overrides` is an unchecked bare object
(`AUTHORING.md:918-919`; nesting likewise uncaught, `:914-917`).

The schema cannot close this — a template has no required `type` to
condition on. The normative text will therefore state that tooling MUST
revalidate the post-resolution manifest, and `AUTHORING.md` §6.6 will
record the limit rather than claim the gap is fully closed.

## Deliverables

### `spec/v2/schema.json`

1. New `definitions.ServiceType` — the `oneOf` above.
2. `ServiceIdentity` — add `type: {"$ref": "#/definitions/ServiceType"}`;
   `required: ["name", "type"]`.
3. New `definitions.TemplateServiceIdentity` — same properties, nothing
   required; `ServiceManifestTemplate.spec.service` re-pointed to it.
4. `definitions.ServiceManifest` — add the `allOf` conditional.

### `OPENSRM-CORE-v2.md`

The normative gap: this document is currently silent on service types.

1. §3 skeleton (`:106-109`) — `service` block gains `type:`.
2. New subsection under §3 defining the six values, the `x-` extension
   rule, the conditional as a MUST, and the post-resolution revalidation
   requirement.
3. §12 Migration (`:633-641`) — the entry `spec.type` never got:
   v1 `spec.type` → v2 `spec.service.type`. The field moved; it did not
   disappear.
4. §15 Open Questions — no change. Service type was never listed there,
   which was part of the evidence for oversight.

### `spec/v2/AUTHORING.md`

1. §3 table (`:111-116`) — add a `type` column.
2. `:118-119` — *"Nothing in the manifest records which one you picked"*
   is now false. Remove.
3. §3.1 (`:167-178`) — flips from *"Why there is no `type` field"* to the
   decision, keeping the v1 history that motivated it. Retitle; the
   in-document anchor `#31-why-there-is-no-type-field` is referenced from
   `:119` and `:923`, so both call sites update with it.
4. §4.2 (`:207-222`) — stop claiming `name` is the only required field.
5. §6.6 (`:922-923`) — drop the "nothing restricts judgment SLOs" gap;
   replace with the template-extension limit above.

### Fixtures

**`spec.service` means two different things in v2.** In a
`kind: ServiceManifest` it is a `ServiceIdentity` object; in a standalone
`kind: JudgmentSLO` document it is a plain **string** naming the service
(`JudgmentSLOSpec`; e.g. `service: triage-agent` in
`examples/judgment-slos/01-reversal-rate.yaml`). The eight
`judgment-slos/*.yaml` fixtures therefore need no change, and the
conditional is safe because it is scoped inside
`definitions.ServiceManifest` rather than applied at the document root.
Implementation must not treat the two as one field.

All eight manifest positives gain a `type:` line —
`examples/services/{api,worker,stream,ai-gate}.yaml`,
`examples/migration/api-full-v2.yaml`, `examples/minimal.yaml`,
`examples/service-manifest-full.yaml`,
`examples/template-extension.yaml`. `examples/service-manifest-template.yaml`
has no `service` block and is unchanged.

The four archetype files open with header NOTEs explaining the field's
absence (`api.yaml:1-8`, `worker.yaml:1-9`, `stream.yaml:1-8`,
`ai-gate.yaml:1-13`); all four get rewritten.

New negatives, following the §8 rule tu04.3's edge-case pass established
(new positive surface needs matching negative surface):

- `n13-judgment-slo-non-ai-gate.yaml` — `type: worker` plus a
  `judgment_slo`. The rule this bead exists to enforce.
- `n14-missing-service-type.yaml` — `service` without `type`.
- `n15-bad-service-type.yaml` — `type: gateway` (a `registry.py` value,
  not an OpenSRM one) — rejected because it is neither in the enum nor
  `x-` prefixed.

One new positive so the extension rule is tested rather than asserted:
`examples/x-service-type.yaml`, shaped like `minimal.yaml` but with
`type: x-web`. A standalone fixture rather than `x-` applied to an
existing archetype, because mutating `api.yaml` to `x-api` would
misrepresent the archetype it exists to illustrate. Positives go 17 → 18.

Because the conditional forbids the `judgment_slo` **key** rather than
inspecting its items, it also closes the `$ref` path: a non-`ai-gate`
manifest cannot pull in judgment SLOs by referencing external
`kind: JudgmentSLO` documents.

`validate.sh` globs `examples/**/*.yaml` and `tests/invalid/*.yaml`
recursively, so no wiring is needed. Negative fixtures go 12 → 15.

Note: `validate.sh` asserts only *that* a negative is rejected, not *why*
— so `n13`–`n15` could rot into passing for an unintended reason. That
weakness is recorded on **opensrm-vquh** and is not fixed here.

## Follow-ups to file

- **`nthlayer-common`** — delete `_infer_service_type()`
  (`parser/v2.py:215-244`), read `spec.service.type`, update
  `v1_compat.py:222-226` to write the field rather than the label, and
  resolve `web` (→ `x-web`, or remap). Closes the parser seam; until it
  lands, `api/worker/stream.yaml` remain parser-red for the reason they
  are red today.
- **`nthlayer-generate`** — `metrics/templates/registry.py:20-42` has no
  `ai-gate` or `stream` template, so `get_template()` returns `None` for
  two of six spec types. Independent of this decision.
- **`tier: important`** — `worker.yaml:19` and `stream.yaml:18` use a
  value absent from `VALID_TIERS` (`models.py:37-42`), which
  `parser/v2.py:107-112` requires. Same class of undeclared coupling
  between free-form v2 labels and a closed implementation enum, but a
  different field. Pre-existing; not smuggled into this bead.

## Out of scope

- `additionalProperties: false` on any block, and the `api_ref` `oneOf` —
  **opensrm-vquh**.
- Strengthening `validate.sh` to assert rejection reasons —
  **opensrm-vquh**.
- Reconciling `docs/spec-conventions.md`'s per-type SLO mappings, which
  reference SLO kinds absent from the §3.1 table. Noted, not fixed.
- Any change to v1 artefacts. `spec/v1/schema.json`'s divergence from the
  schema listing embedded in `spec/v1/specification.md` is real
  (different `$id`, four values vs six, `type` required vs optional) but
  v1 is frozen.

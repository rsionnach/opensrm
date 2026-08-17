# OpenSRM v2 Service Type Discriminator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reintroduce a service type discriminator in OpenSRM v2 as a required `spec.service.type` field, with six enum values plus an `x-` extension escape hatch, and enforce one type-conditional rule (judgment SLOs forbidden on non-`ai-gate` services) in the shipped schema.

**Architecture:** Four ordered changes to the `opensrm` repo — schema first (it is the enforcement point every later task is verified against), then fixtures (so `validate.sh` is green before any prose claims anything), then the normative spec, then the authoring guide. Prose comes last deliberately: the tu04.3 R5 found that prose asserting facts about files is what rots, so every prose claim in Tasks 3 and 4 must point at a file that already contains what the prose says.

**Tech Stack:** JSON Schema draft-07, YAML fixtures, `check-jsonschema` via `uvx`, bash (`spec/v2/validate.sh`). No Python source changes — `opensrm` is a specification repo with no Python package.

**Spec:** `docs/superpowers/specs/2026-08-17-v2-service-type-discriminator-design.md`

## Global Constraints

- **Scope is the `opensrm` repo only.** No edits to any sibling repo. Implementation follow-ups are already filed as `opensrm-ih0v` (nthlayer-common), `opensrm-8sa6` (nthlayer-generate), `opensrm-9bil` (`tier: important`). Do not fix them here.
- **v1 artefacts are frozen.** No edits to `spec/v1/schema.json`, `spec/v1/specification.md`, `spec/v1/judgment-slos.md`, or the v1 examples in `examples/` at repo root.
- **The enum is exactly:** `api`, `worker`, `stream`, `ai-gate`, `batch`, `database`. The extension pattern is exactly `^x-[a-z][a-z0-9-]*$`.
- **The conditional is forbid-direction only.** `type != ai-gate` ⇒ `judgment_slo` forbidden. An `ai-gate` with no judgment SLOs MUST stay valid.
- **`"type": "string"` is mandatory in the `x-` branch** of `ServiceType`. JSON Schema applies `pattern` only to strings; without it, `type: 5` and `type: {a: 1}` validate.
- **`spec.service` is polysemous.** In `kind: ServiceManifest` it is a `ServiceIdentity` object. In `kind: JudgmentSLO` it is a plain string naming the service (`JudgmentSLOSpec`). Never apply the conditional or the `type` requirement at document root — scope both inside `definitions.ServiceManifest` / `definitions.ServiceIdentity`.
- **`ServiceManifestTemplate` keeps its all-optional contract.** Its `spec.service` must not inherit `required: ["type"]`.
- **Verification command for every task:** `bash spec/v2/validate.sh` — must exit 0. It globs `examples/**/*.yaml` and `tests/invalid/*.yaml` recursively, so new fixtures need no wiring.
- **Every commit message carries the bead id `opensrm-6w9d`** in the subject or a trailer. This is the convention `opensrm-tl78` exists to enforce; the tu04.3 R5 range detection broke because a commit omitted it.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Modified:**
- `spec/v2/schema.json` — the enforcement point. Gains `definitions.ServiceType`, `definitions.TemplateServiceIdentity`; `ServiceIdentity` gains `type` + `required`; `ServiceManifest` gains one `allOf` branch; `ServiceManifestTemplate.spec.service` re-pointed.
- `spec/v2/examples/services/{api,worker,stream,ai-gate}.yaml` — `type:` line + header NOTE rewrite.
- `spec/v2/examples/{minimal,service-manifest-full,template-extension}.yaml` — `type:` line.
- `spec/v2/examples/migration/api-full-v2.yaml` — `type:` line.
- `OPENSRM-CORE-v2.md` — §3 skeleton, new §3.1, §12 migration entry, §13 conformance clause.
- `spec/v2/AUTHORING.md` — Contents, §3 table, §3.1 rewrite + anchor rename (4 call sites), §4.2, §6.6, §7.1 table row.

**Created:**
- `spec/v2/examples/x-service-type.yaml` — positive fixture for the extension rule.
- `spec/v2/tests/invalid/n13-judgment-slo-non-ai-gate.yaml`
- `spec/v2/tests/invalid/n14-missing-service-type.yaml`
- `spec/v2/tests/invalid/n15-bad-service-type.yaml`

**Unchanged, deliberately:** `spec/v2/examples/service-manifest-template.yaml` (no `service` block), all eight `spec/v2/examples/judgment-slos/*.yaml` (their `spec.service` is a string), `spec/v2/validate.sh` (glob-based, needs no wiring), `spec/v2/README.md` (describes the validator, makes no type claims).

---

## Task 1: Schema — `ServiceType`, required `type`, and the conditional

The enforcement point. Tests are the negative fixtures, written first, and they must LEAK (validate when they should be rejected) before the schema change lands.

**Files:**
- Modify: `spec/v2/schema.json`
- Test/Create: `spec/v2/tests/invalid/n13-judgment-slo-non-ai-gate.yaml`
- Test/Create: `spec/v2/tests/invalid/n14-missing-service-type.yaml`
- Test/Create: `spec/v2/tests/invalid/n15-bad-service-type.yaml`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `#/definitions/ServiceType` (referenced by `ServiceIdentity.properties.type` and by nothing else); `#/definitions/TemplateServiceIdentity` (referenced only by `ServiceManifestTemplate.spec.properties.service`). Tasks 2–4 depend on the field path being exactly `spec.service.type` and the enum being exactly the six values plus `^x-[a-z][a-z0-9-]*$`.

- [ ] **Step 1: Write the three failing negative fixtures**

`spec/v2/tests/invalid/n13-judgment-slo-non-ai-gate.yaml`:

```yaml
# NEGATIVE FIXTURE — must be REJECTED by spec/v2/schema.json.
#
# A worker declaring a judgment SLO. This is the rule opensrm-6w9d exists
# to enforce: judgment SLOs measure decision quality, so they are only
# meaningful on a decision-making service. v1 stated this as a MUST
# (spec/v1/specification.md §11) but its shipped schema never enforced it.
apiVersion: opensrm.nthlayer.io/v2
kind: ServiceManifest
metadata:
  name: reconciliation-worker
spec:
  owner:
    group: "group:default/sre-finance"
  service:
    name: reconciliation-worker
    type: worker
  judgment_slo:
    - $ref: "./judgment-slos/01-reversal-rate.yaml"
```

`spec/v2/tests/invalid/n14-missing-service-type.yaml`:

```yaml
# NEGATIVE FIXTURE — must be REJECTED by spec/v2/schema.json.
#
# A service identity with no `type`. v2 makes the discriminator required
# (opensrm-6w9d) precisely because v1's optional one could never be
# enforced — two shipped v1 examples omit it entirely.
apiVersion: opensrm.nthlayer.io/v2
kind: ServiceManifest
metadata:
  name: checkout-api
spec:
  owner:
    group: "group:default/sre-checkout"
  service:
    name: checkout-api
```

`spec/v2/tests/invalid/n15-bad-service-type.yaml`:

```yaml
# NEGATIVE FIXTURE — must be REJECTED by spec/v2/schema.json.
#
# `gateway` is a real key in nthlayer-generate's metric-template registry
# but is NOT an OpenSRM service type. It is rejected because it is neither
# in the enum nor `x-` prefixed — an implementation-specific type must be
# spelled `x-gateway`.
apiVersion: opensrm.nthlayer.io/v2
kind: ServiceManifest
metadata:
  name: edge-gateway
spec:
  owner:
    group: "group:default/sre-edge"
  service:
    name: edge-gateway
    type: gateway
```

- [ ] **Step 2: Run the validator to verify all three LEAK**

Run: `bash spec/v2/validate.sh`

Expected: exit 1, with three `LEAK` lines — `n13-judgment-slo-non-ai-gate.yaml`, `n14-missing-service-type.yaml`, `n15-bad-service-type.yaml` each reported `(should have been rejected)`. Positive fixtures all `ok`.

If any of the three is already `caught`, stop — it is being rejected for an unintended reason (a typo, a bad `$ref` shape), not by the rule under test. Fix the fixture so it fails only on the intended rule.

- [ ] **Step 3: Add `definitions.ServiceType`**

In `spec/v2/schema.json`, inside `definitions`, adjacent to the other small scalar definitions (`Ratio`, `Throughput`, `EntityRef`, `StringMap`):

```json
    "ServiceType": {
      "description": "Service operational pattern. The six standard values, or an implementation-specific type under the reserved `x-` prefix.",
      "oneOf": [
        { "enum": ["api", "worker", "stream", "ai-gate", "batch", "database"] },
        { "type": "string", "pattern": "^x-[a-z][a-z0-9-]*$" }
      ]
    },
```

The `"type": "string"` in the second branch is load-bearing: `pattern` applies only to strings, so without it `type: 5`, `type: true`, `type: {a: 1}` and `type: [x]` all validate.

- [ ] **Step 4: Add `type` to `ServiceIdentity` and make it required**

Replace `definitions.ServiceIdentity` with:

```json
    "ServiceIdentity": {
      "type": "object",
      "required": ["name", "type"],
      "properties": {
        "name": { "type": "string" },
        "type": { "$ref": "#/definitions/ServiceType" },
        "description": { "type": "string" }
      }
    },
```

- [ ] **Step 5: Add `definitions.TemplateServiceIdentity` and re-point the template**

A template's `spec` is documented as "All fields optional; owner/service are supplied by the extending manifest", so it must not inherit `required: ["type"]`. Add:

```json
    "TemplateServiceIdentity": {
      "type": "object",
      "description": "Service identity within a ServiceManifestTemplate. Nothing is required — a template supplies defaults, and the extending manifest supplies the identity. Manifests use ServiceIdentity, which requires `name` and `type`.",
      "properties": {
        "name": { "type": "string" },
        "type": { "$ref": "#/definitions/ServiceType" },
        "description": { "type": "string" }
      }
    },
```

Then in `definitions.ServiceManifestTemplate.properties.spec.properties`, change `service` from `{ "$ref": "#/definitions/ServiceIdentity" }` to:

```json
          "service": { "$ref": "#/definitions/TemplateServiceIdentity" },
```

- [ ] **Step 6: Add the conditional to `definitions.ServiceManifest`**

`definitions.ServiceManifest` currently has keys `type`, `required`, `properties`. Add a sibling `allOf` key:

```json
      "allOf": [
        {
          "description": "Judgment SLOs measure decision quality and are only meaningful on a decision-making service. Restores v1 §11's type-specific validation MUST, which v1's shipped schema never enforced.",
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
            "properties": {
              "spec": { "not": { "required": ["judgment_slo"] } }
            }
          }
        }
      ],
```

Two details that matter. The `required` keywords inside the `if` are load-bearing: without them the `if` matches a document that has no `spec` or no `service` at all, and `then` would fire on documents the requirement already rejects. And `then` forbids the `judgment_slo` **key**, not its contents — which is what closes the `$ref` path, since a non-`ai-gate` manifest cannot pull judgment SLOs in by referencing external `kind: JudgmentSLO` documents either.

- [ ] **Step 7: Verify the schema is still valid JSON and draft-07-legal**

Run:

```bash
python3 -c "
import json
d = json.load(open('spec/v2/schema.json'))
import jsonschema
jsonschema.Draft7Validator.check_schema(d)
defs = d['definitions']
assert defs['ServiceIdentity']['required'] == ['name', 'type']
assert 'required' not in defs['TemplateServiceIdentity']
assert defs['ServiceManifestTemplate']['properties']['spec']['properties']['service'] \
       == {'\$ref': '#/definitions/TemplateServiceIdentity'}
assert len(defs['ServiceManifest']['allOf']) == 1
print('schema OK')
"
```

Expected: `schema OK`, no exception.

- [ ] **Step 8: Run the behaviour matrix**

The three negative fixtures cover three cases; the design doc verified twelve. Run the full matrix so the cases without a fixture are also confirmed:

```bash
python3 - <<'PY'
import json, jsonschema, yaml, glob
V = jsonschema.Draft7Validator(json.load(open('spec/v2/schema.json')))

def mk(t, judg=False):
    m = {"apiVersion": "opensrm.nthlayer.io/v2", "kind": "ServiceManifest",
         "metadata": {"name": "svc"},
         "spec": {"owner": {"group": "group:default/x"},
                  "service": {"name": "svc"}}}
    if t is not None:
        m["spec"]["service"]["type"] = t
    if judg:
        m["spec"]["judgment_slo"] = [{"$ref": "./j.yaml"}]
    return m

cases = [
    ("api, no judgment",                mk("api"),           True),
    ("ai-gate + judgment",              mk("ai-gate", True), True),
    ("ai-gate, no judgment",            mk("ai-gate"),       True),
    ("worker + judgment (n13)",         mk("worker", True),  False),
    ("batch + judgment",                mk("batch", True),   False),
    ("x-web, no judgment",              mk("x-web"),         True),
    ("x-web + judgment",                mk("x-web", True),   False),
    ("missing type (n14)",              mk(None),            False),
    ("bad type 'gateway' (n15)",        mk("gateway"),       False),
    ("bad ext 'x-'",                    mk("x-"),            False),
    ("non-string type 5",               mk(5),               False),
    ("non-string type {}",              mk({"a": 1}),        False),
]
bad = 0
for name, doc, want in cases:
    got = not list(V.iter_errors(doc))
    if got != want:
        bad += 1
        print(f"FAIL  {name}: got {'valid' if got else 'reject'}, want {'valid' if want else 'reject'}")
    else:
        print(f"pass  {name}")

tpl = {"apiVersion": "opensrm.nthlayer.io/v2", "kind": "ServiceManifestTemplate",
       "metadata": {"name": "base"},
       "spec": {"service": {"description": "defaults"}, "judgment_slo": []}}
if list(V.iter_errors(tpl)):
    bad += 1
    print("FAIL  template w/ partial service, no type -> should be VALID")
else:
    print("pass  template w/ partial service, no type")

for f in sorted(glob.glob('spec/v2/examples/judgment-slos/*.yaml')):
    if list(V.iter_errors(yaml.safe_load(open(f)))):
        bad += 1
        print(f"FAIL  {f} -> should be VALID (spec.service is a string here)")
print("pass  8 judgment-slos fixtures unaffected" if not bad else f"\n{bad} FAILURES")
raise SystemExit(1 if bad else 0)
PY
```

Expected: every line `pass`, exit 0.

- [ ] **Step 9: Run the validator — negatives now caught, positives now failing**

Run: `bash spec/v2/validate.sh`

Expected: exit 1. The three negatives are now `caught`. **Eight positives now FAIL** — `services/{api,worker,stream,ai-gate}.yaml`, `minimal.yaml`, `service-manifest-full.yaml`, `template-extension.yaml`, `migration/api-full-v2.yaml` — because `type` is now required and none of them declares it. That is expected and is Task 2's work. `service-manifest-template.yaml` and the eight `judgment-slos/*.yaml` must still be `ok`.

Confirm the count is exactly eight failing positives. A ninth means something was missed; fewer means a fixture already had a `type` key that was silently ignored before.

- [ ] **Step 10: Commit**

```bash
git add spec/v2/schema.json spec/v2/tests/invalid/n13-judgment-slo-non-ai-gate.yaml \
        spec/v2/tests/invalid/n14-missing-service-type.yaml \
        spec/v2/tests/invalid/n15-bad-service-type.yaml
git commit -F - <<'EOF'
feat(schema): add required spec.service.type with conditional (opensrm-6w9d)

Reintroduces the v2 service type discriminator as a required first-class
field, with the six v1 enum values plus an `^x-[a-z][a-z0-9-]*$` extension
escape hatch, and one enforced conditional: judgment_slo is forbidden when
type != ai-gate.

This restores v1's single type-conditional MUST (spec/v1/specification.md
§11.1) and enforces it in the shipped artefact -- v1 implemented it only in
the schema listing embedded in the prose document, never in
spec/v1/schema.json.

Design details:
- `"type": "string"` in the x- branch is load-bearing; pattern applies only
  to strings, so without it `type: 5` and `type: {a: 1}` validate.
- ServiceManifestTemplate gets its own TemplateServiceIdentity so templates
  keep their documented all-optional contract.
- The conditional forbids the judgment_slo KEY, which also closes the $ref
  path -- a non-ai-gate manifest cannot pull in external JudgmentSLO docs.
- Scoped inside definitions.ServiceManifest because spec.service is
  polysemous: an object in a ServiceManifest, a plain string in a
  standalone kind: JudgmentSLO document.

Negative fixtures n13 (worker + judgment_slo), n14 (missing type),
n15 (non-enum, non-x- type). Negatives go 12 -> 15.

The eight manifest positives fail until the next commit adds their `type`
line; validate.sh is intentionally red between these two commits.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Fixtures — `type:` on all eight manifests, plus the extension positive

Makes `validate.sh` green again and gives the extension rule test coverage rather than prose.

**Files:**
- Modify: `spec/v2/examples/services/api.yaml`, `worker.yaml`, `stream.yaml`, `ai-gate.yaml`
- Modify: `spec/v2/examples/minimal.yaml`, `service-manifest-full.yaml`, `template-extension.yaml`
- Modify: `spec/v2/examples/migration/api-full-v2.yaml`
- Create: `spec/v2/examples/x-service-type.yaml`
- Test: `bash spec/v2/validate.sh`

**Interfaces:**
- Consumes: `spec.service.type` as required by Task 1's `ServiceIdentity`; the six enum values; the `x-` pattern.
- Produces: `examples/services/*.yaml` become the files Task 4's §3 table and §3.1 prose point at. Task 4's claims are verified against these files, so the `type` values chosen here are the values the guide documents: `api` → `api`, `worker` → `worker`, `stream` → `stream`, `ai-gate` → `ai-gate`.

- [ ] **Step 1: Add `type:` to the four archetype examples**

In each of `spec/v2/examples/services/{api,worker,stream,ai-gate}.yaml`, add `type:` to the `service` block immediately after `name`, matching the archetype the file illustrates. For `api.yaml`:

```yaml
  service:
    name: checkout-api
    type: api
    description: "Creates and confirms customer checkout sessions"
```

Use `type: worker` in `worker.yaml`, `type: stream` in `stream.yaml`, `type: ai-gate` in `ai-gate.yaml`. Keep each file's existing `name` and `description` values — do not rewrite them.

- [ ] **Step 2: Rewrite the four archetype header NOTEs**

Each archetype file opens with a comment block explaining that the field does not exist. Those NOTEs are now false. Replace the NOTE portion (keep each file's `# Archetype: <name>` first line and any other framing).

In `api.yaml`, `worker.yaml`, `stream.yaml` — replace the absence NOTE with:

```yaml
# The `spec.service.type` field records the archetype (opensrm-6w9d).
# It is required, and the schema uses it to forbid judgment SLOs on
# services that do not make decisions. See AUTHORING.md §3.1.
```

In `ai-gate.yaml`, replace the fuller NOTE at `:10-13` with:

```yaml
# `type: ai-gate` is what permits the judgment_slo block below. The schema
# rejects judgment SLOs on any other type (opensrm-6w9d) -- v1 declared
# that rule normatively but never enforced it in its shipped schema.
# An ai-gate is NOT required to declare judgment SLOs, only permitted to.
```

- [ ] **Step 3: Add `type:` to the four remaining manifests**

`spec/v2/examples/minimal.yaml` — this fixture asserts the schema's floor, so it now shows two required identity fields:

```yaml
  service:
    name: checkout-api
    type: api
```

Also update its header comment, which currently says the smallest manifest is "the envelope, an owner, and a service identity" — still true, but the floor now includes `type`. Change the first paragraph to:

```yaml
# The smallest manifest spec/v2/schema.json accepts: the envelope, an
# owner, and a service identity (`name` and `type`). Everything else is
# optional to the validator.
```

For `service-manifest-full.yaml`, `template-extension.yaml`, and `migration/api-full-v2.yaml`, add a `type:` line after `name:` in the `service` block. Pick the value from what each file illustrates — read the file's SLOs and contracts first. `template-extension.yaml` and `migration/api-full-v2.yaml` are both payment/checkout API-shaped, so `type: api` unless the file's content says otherwise.

- [ ] **Step 4: Create the extension-rule positive fixture**

`spec/v2/examples/x-service-type.yaml`:

```yaml
# An implementation-specific service type under the reserved `x-` prefix.
#
# The six standard types (api, worker, stream, ai-gate, batch, database)
# cover OpenSRM's vocabulary. An implementation needing another declares it
# as `x-<name>`: nthlayer's `web` type becomes `x-web`. This keeps an
# implementation-valid manifest OpenSRM-valid without OpenSRM owning a
# downstream invention.
#
# This fixture exists so the extension rule is tested rather than asserted
# -- it is what keeps AUTHORING.md §3.1's `x-` claim honest.
apiVersion: opensrm.nthlayer.io/v2
kind: ServiceManifest
metadata:
  name: marketing-site
spec:
  owner:
    group: "group:default/web-platform"
  service:
    name: marketing-site
    type: x-web
    description: "Serves the public marketing site and pricing pages"
```

- [ ] **Step 5: Run the validator — everything green**

Run: `bash spec/v2/validate.sh`

Expected: exit 0, `== all v2 schema fixtures behaved as expected ==`. 18 positives all `ok` (17 existing + `x-service-type.yaml`), 15 negatives all `caught`.

- [ ] **Step 6: Verify no fixture accidentally lost its type or gained a bad one**

Run:

```bash
python3 -c "
import yaml, glob
for f in sorted(glob.glob('spec/v2/examples/**/*.yaml', recursive=True)):
    d = yaml.safe_load(open(f)) or {}
    if d.get('kind') != 'ServiceManifest':
        continue
    svc = (d.get('spec') or {}).get('service') or {}
    print(f\"{svc.get('type', '*** MISSING ***'):12} {f}\")
"
```

Expected: nine `ServiceManifest` files listed, every one with a type, none `*** MISSING ***`. Values: `api`, `worker`, `stream`, `ai-gate`, plus `api`/`x-web` for the rest per Steps 3–4.

- [ ] **Step 7: Commit**

```bash
git add spec/v2/examples
git commit -F - <<'EOF'
test(fixtures): declare spec.service.type on all v2 manifests (opensrm-6w9d)

Adds the now-required `type` to all eight manifest positives and rewrites
the four archetype header NOTEs, which explained the field's absence and
are no longer true.

New positive `examples/x-service-type.yaml` covers the `x-` extension rule
with `type: x-web`, so the escape hatch is tested rather than asserted in
prose. Positives go 17 -> 18.

minimal.yaml's header updated: the schema floor is now envelope + owner +
`name` + `type`.

validate.sh green again -- 18 positives ok, 15 negatives caught.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Normative spec — `OPENSRM-CORE-v2.md`

This document is currently silent on service types. That silence was part of the evidence the omission was an oversight rather than a decision; it is also the gap bead exit (a) named.

**Files:**
- Modify: `OPENSRM-CORE-v2.md` — §3 skeleton (`:107-110`), new §3.1 (after `:138`), §12 (`:633-641`), §13 (`:645-652`)
- Test: `bash spec/v2/validate.sh` plus the prose-drift check in Step 5

**Interfaces:**
- Consumes: the field path, enum, and pattern from Task 1; the fixture values from Task 2.
- Produces: the normative definition Task 4's guide points back to. §3.1's heading text fixes the anchor `AUTHORING.md` will link to.

- [ ] **Step 1: Add `type` to the §3 manifest skeleton**

`OPENSRM-CORE-v2.md:107-110` currently reads:

```yaml
  # Service identity
  service:
    name: payment-service
    description: "Processes payment authorisation and capture for consumer transactions"
```

Replace with:

```yaml
  # Service identity
  service:
    name: payment-service
    type: api                                      # See §3.1
    description: "Processes payment authorisation and capture for consumer transactions"
```

- [ ] **Step 2: Add §3.1**

§3 currently has no subsections — it runs from `:84` to §4 at `:140`, ending with the Backstage envelope paragraph at `:138`. Insert a new `### 3.1 Service types` between that paragraph and `## 4. Classical SLOs (via OpenSLO)`:

```markdown
### 3.1 Service types

`spec.service.type` records the service's operational pattern. It is **required**.

An implementation MUST accept these six values:

| Type | Pattern |
|---|---|
| `api` | Synchronously called; callers depend on a latency and availability promise |
| `worker` | Processes queued work; nothing calls it synchronously |
| `stream` | Consumes an event stream; measured on lag and throughput |
| `ai-gate` | Makes decisions whose quality is measurable — the judgment SLO archetype |
| `batch` | Runs on a schedule; measured on completion and freshness |
| `database` | Stateful store; measured on query latency and replication |

An implementation MAY define additional types under the reserved `x-` prefix, matching `^x-[a-z][a-z0-9-]*$`. Implementations MUST NOT define additional bare types — a type that is neither one of the six nor `x-` prefixed MUST be rejected. This keeps an implementation-specific type valid under OpenSRM without OpenSRM adopting it.

Type-conditional validation, restoring the v1 rule:

- A manifest whose `spec.service.type` is not `ai-gate` MUST NOT declare `spec.judgment_slo`. Judgment SLOs measure decision quality and are only meaningful for a service that makes decisions.
- An `ai-gate` service MAY declare judgment SLOs but is not required to. A service may adopt the type before its judgment SLOs are authored.

Because template resolution happens at load time rather than during schema validation, a template carrying `judgment_slo` could otherwise supply them to a manifest of any type. An implementation MUST therefore revalidate the fully resolved manifest, after template expansion, against the same rules (§9, §13).
```

- [ ] **Step 3: Add the §12 migration entry**

`spec.type` is the only v1 field absent from §12. It currently has five numbered items ending with CloudEvents at `:641`. Add a sixth:

```markdown
6. **Move `spec.type` to `spec.service.type`.** v1's service type moves onto the identity block and stays required, with the same values plus `batch` and `database` (§3.1). The field did not disappear in v2 — it moved. Any v1 manifest already declares it; migration is a relocation, not new authoring.
```

- [ ] **Step 4: Add the conformance clause**

`OPENSRM-CORE-v2.md:645-652` lists what an implementation MUST do. The existing item `- Support template resolution (§9)` is where post-resolution revalidation belongs. Add one MUST item after it:

```markdown
- Revalidate the fully resolved manifest after template expansion, so type-conditional rules (§3.1) cannot be bypassed by a template
```

- [ ] **Step 5: Verify every new prose claim against the files**

The tu04.3 R5 found that prose asserting facts about files is the thing that rots — its correctness pass caught the guide's most-emphasised claim pointing at a `$ref` that did not exist. Check each claim mechanically:

```bash
python3 - <<'PY'
import json, re
schema = json.load(open('spec/v2/schema.json'))
st = schema['definitions']['ServiceType']
enum = st['oneOf'][0]['enum']
pattern = st['oneOf'][1]['pattern']
core = open('OPENSRM-CORE-v2.md').read()

# every enum value named in the §3.1 table
missing = [v for v in enum if f'`{v}`' not in core]
print("enum values absent from CORE-v2:", missing or "none")

# the pattern is quoted exactly
print("pattern quoted verbatim:", pattern in core)

# required-ness matches the schema
print("ServiceIdentity requires type:",
      schema['definitions']['ServiceIdentity']['required'] == ['name', 'type'])

# the skeleton's type value is a real enum member
m = re.search(r'^\s*type:\s*(\S+)', core[core.index('# Service identity'):], re.M)
print("skeleton type value:", m.group(1), "in enum:", m.group(1) in enum)
PY
```

Expected: `none`, `True`, `True`, and a skeleton value that is in the enum.

- [ ] **Step 6: Confirm fixtures still pass**

Run: `bash spec/v2/validate.sh`

Expected: exit 0. This task edits only Markdown, so a failure here means a fixture was touched by accident.

- [ ] **Step 7: Commit**

```bash
git add OPENSRM-CORE-v2.md
git commit -F - <<'EOF'
docs(spec): specify service types normatively in v2 (opensrm-6w9d)

CORE-v2 was silent on service types -- the gap that made "document the
omission as intentional" impossible, since the reference implementation
already required a type and read it from an undocumented
metadata.labels.type.

Adds §3.1 defining the six values, the reserved `x-` extension prefix, and
the type-conditional rule as a MUST (judgment_slo forbidden on non-ai-gate;
an ai-gate is permitted but not required to declare them).

§3 skeleton gains `type:`. §12 gains the migration entry spec.type never
had -- it was the only v1 field to vanish with no migration note, which was
part of the evidence for oversight. §13 gains a MUST to revalidate after
template expansion, since resolution happens outside schema validation and
a template carrying judgment_slo could otherwise bypass the conditional.

§15 Open Questions unchanged: service type was never listed there.

Every claim added here was checked against schema.json rather than
asserted.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Authoring guide — `spec/v2/AUTHORING.md`

Six sites, four of which are now factually false. The §3.1 anchor rename has four call sites; missing one leaves a dead in-document link.

**Files:**
- Modify: `spec/v2/AUTHORING.md` — Contents (`:22-31`), §3 table (`:111-119`), §3.1 (`:167-178`), §4.2 (`:207-216`), §6.6 (`:922-923`), §7.1 table (`:946`)
- Test: `bash spec/v2/validate.sh` plus the link and drift checks in Steps 7–8

**Interfaces:**
- Consumes: the normative §3.1 from Task 3; the fixture `type` values from Task 2; the enum and pattern from Task 1.
- Produces: nothing downstream — this is the last task.

- [ ] **Step 1: Update the §3 archetype table**

`AUTHORING.md:111-116` has columns `Archetype | Characteristic SLOs | contracts? | judgment_slo? | Example`. Add a `type` column after `Archetype`:

```markdown
| Archetype | `type` | Characteristic SLOs | `contracts`? | `judgment_slo`? | Example |
|---|---|---|---|---|---|
| **api** | `api` | availability, latency | Yes — callers need a promise | No | [`examples/services/api.yaml`](examples/services/api.yaml) |
| **worker** | `worker` | success rate, processing time | No — nothing calls it synchronously | No | [`examples/services/worker.yaml`](examples/services/worker.yaml) |
| **stream** | `stream` | consumer lag, throughput | Yes — via AsyncAPI | No | [`examples/services/stream.yaml`](examples/services/stream.yaml) |
| **ai-gate** | `ai-gate` | availability, latency | Yes | **Yes** — the point of the archetype | [`examples/services/ai-gate.yaml`](examples/services/ai-gate.yaml) |
```

Note the `judgment_slo?` column now means something enforced rather than descriptive — the "No" rows are schema-rejected, not merely unusual.

- [ ] **Step 2: Replace the false claim at `:118-119`**

Currently:

```markdown
Nothing in the manifest records which one you picked — the archetypes
organise this guide only ([§3.1](#31-why-there-is-no-type-field)).
```

Replace with:

```markdown
`spec.service.type` records which one you picked, and the schema uses it —
declaring judgment SLOs on anything but an `ai-gate` is rejected
([§3.1](#31-the-type-field)).
```

- [ ] **Step 3: Rewrite §3.1**

Replace `AUTHORING.md:167-178` entirely — heading included, since the anchor changes:

```markdown
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
```

- [ ] **Step 4: Fix §4.2's required-field claim**

`AUTHORING.md:207-216`. Update the code block and the sentence at `:216`:

```markdown
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
```

Keep the rest of the existing `description` guidance unchanged.

- [ ] **Step 5: Update §6.6's gap list**

`AUTHORING.md:922-923` currently reads:

```markdown
- **Nothing restricts judgment SLOs to decision-making services**, since
  v2 has no `spec.type` ([§3.1](#31-why-there-is-no-type-field)).
```

That gap is closed. Replace with the one that remains — a real limit, not a claim of completeness:

```markdown
- **Judgment SLOs arriving via a template are not type-checked.** The
  schema forbids `judgment_slo` on a non-`ai-gate` manifest
  ([§3.1](#31-the-type-field)), but a `ServiceManifestTemplate` may carry
  `judgment_slo` and has no required `type` to check it against. Template
  resolution happens at load time, outside validation, so a `worker`
  extending such a template validates. Implementations are required to
  revalidate after expansion (`OPENSRM-CORE-v2.md` §13); the schema alone
  does not catch it.
```

- [ ] **Step 6: Fix the §7.1 migration table row**

`AUTHORING.md:946` currently marks the field removed:

```markdown
| `spec.type` (`api`/`worker`/`stream`/`ai-gate`) | — | **Removed** ([§3.1](#31-why-there-is-no-type-field)) |
```

Replace:

```markdown
| `spec.type` (`api`/`worker`/`stream`/`ai-gate`) | `spec.service.type` — same values, plus `batch`/`database` | Moved ([§3.1](#31-the-type-field)) |
```

- [ ] **Step 7: Verify no dead in-document links**

The old anchor had four call sites. Check every one moved and that every anchor referenced in the file exists:

```bash
python3 - <<'PY'
import re
txt = open('spec/v2/AUTHORING.md').read()

stale = txt.count('31-why-there-is-no-type-field')
print("stale anchor refs (must be 0):", stale)

heads = set()
for line in txt.splitlines():
    if line.startswith('#'):
        t = line.lstrip('#').strip()
        heads.add('#' + re.sub(r'[^a-z0-9\s-]', '', t.lower()).replace(' ', '-'))

refs = set(re.findall(r'\]\((#[^)]+)\)', txt))
dead = sorted(r for r in refs if r not in heads)
print("dead anchors:", dead or "none")
print("new anchor present:", '#31-the-type-field' in heads)
PY
```

Expected: `0`, `none`, `True`.

Also confirm the Contents block at `:22-31` still matches the top-level headings — §3.1 is a subsection and is not listed there, so it should need no change, but verify rather than assume.

- [ ] **Step 8: Verify every file path and claim the guide asserts**

```bash
python3 - <<'PY'
import re, os, json, yaml
txt = open('spec/v2/AUTHORING.md').read()
base = 'spec/v2'

# every relative link target exists
bad = []
for target in re.findall(r'\]\((?!#)([^)]+)\)', txt):
    t = target.split('#')[0]
    if t.startswith('http'):
        continue
    if not os.path.exists(os.path.join(base, t)):
        bad.append(t)
print("missing link targets:", bad or "none")

# the ai-gate excerpt matches the fixture
fx = yaml.safe_load(open(f'{base}/examples/services/ai-gate.yaml'))
print("ai-gate fixture type:", fx['spec']['service']['type'])
print("has judgment_slo:", 'judgment_slo' in fx['spec'])

# the x- fixture matches what §3.1 claims
xf = yaml.safe_load(open(f'{base}/examples/x-service-type.yaml'))
pat = json.load(open(f'{base}/schema.json'))['definitions']['ServiceType']['oneOf'][1]['pattern']
print("x- fixture type:", xf['spec']['service']['type'],
      "matches pattern:", bool(re.match(pat, xf['spec']['service']['type'])))
print("pattern quoted in guide:", pat in txt)
PY
```

Expected: `none`, `ai-gate`, `True`, `x-web` matching, pattern quoted.

- [ ] **Step 9: Full fixture run**

Run: `bash spec/v2/validate.sh`

Expected: exit 0, 18 positives `ok`, 15 negatives `caught`.

- [ ] **Step 10: Commit**

```bash
git add spec/v2/AUTHORING.md
git commit -F - <<'EOF'
docs(guide): document spec.service.type in AUTHORING (opensrm-6w9d)

Six sites, four of which had become false:

- §3 table gains a `type` column; the claim "Nothing in the manifest
  records which one you picked" removed.
- §3.1 flips from "Why there is no `type` field" to "The `type` field",
  keeping the v1 history that motivated the decision. Anchor renamed, with
  all four call sites (§3, §4.2, §6.6, §7.1) updated.
- §4.2 stops claiming `name` is the only required field.
- §6.6 drops the "nothing restricts judgment SLOs" gap and replaces it with
  the limit that does remain: judgment SLOs arriving via a template are not
  type-checked, because a template has no required type and resolution
  happens outside validation.
- §7.1 migration row changes from "Removed" to "Moved".

Every path and value the guide asserts was checked mechanically -- link
targets exist, the ai-gate excerpt matches the fixture, the x- pattern is
quoted verbatim from schema.json, no dead in-document anchors.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Post-implementation

Not part of the four tasks, and not to be done by a task implementer:

1. **R5 review.** Run `/r5-supervise opensrm-6w9d` — four sequential passes in a fix-loop, never parallel. Pass explicit `--base`/`--head` rather than trusting auto-detection: every commit here carries `opensrm-6w9d`, but the design-doc commit `08af46f` also carries it and is not part of the implementation diff. `--base 08af46f` is the correct floor.
2. **Audit review.** `/audit-supervise opensrm-6w9d` if the R5 passes surface schema or doc-consistency concerns worth a second lens.
3. **Close the bead** only after all four R5 passes are clean.
4. **Unblock `opensrm-ih0v`** — it is marked as depending on `opensrm-6w9d`. Until it lands, `examples/services/{api,worker,stream}.yaml` remain unparseable by `nthlayer-common` for the same reason they are unparseable today; adding `type:` does not fix that, because the parser reads `metadata.labels.type`.

## Self-Review

**Spec coverage.** Every deliverable in the design doc maps to a task: schema's four edits → Task 1 Steps 3–6; the eight fixtures + `x-` positive + three negatives → Tasks 1–2; CORE-v2's four edits → Task 3; AUTHORING's five edits → Task 4, which also picks up the §7.1 table row at `:946` that the design doc missed (found while gathering line numbers — a fifth call site of the renamed anchor). The design doc's "known limit: template extension bypasses the conditional" is covered twice, normatively in Task 3 Step 4 and for authors in Task 4 Step 5. Out-of-scope items (`additionalProperties`, `api_ref` `oneOf`, `validate.sh` rejection reasons, `spec-conventions.md` SLO mappings) appear in no task, as intended.

**Placeholder scan.** No TBDs. One judgment call is delegated rather than specified: Task 2 Step 3's `type` value for `service-manifest-full.yaml`, `template-extension.yaml`, and `migration/api-full-v2.yaml`, where the instruction is to read the file's SLOs and contracts and default to `api`. That is a two-second read of a file the implementer has open, not deferred design work.

**Type consistency.** `spec.service.type` throughout — never `spec.type` except when quoting v1. Definition names stable: `ServiceType`, `TemplateServiceIdentity`, `ServiceIdentity`. The anchor is `#31-the-type-field` in all five call sites. Fixture counts are consistent: positives 17 → 18, negatives 12 → 15, and Task 1 Step 9 predicts exactly eight failing positives, which reconciles with Task 2's eight modified manifests.

# OpenSRM v2 schema

JSON Schema (draft-07) for OpenSRM **v2-draft** documents. It validates the
manifest format defined in [`../../OPENSRM-CORE-v2.md`](../../OPENSRM-CORE-v2.md).

> **Status: draft.** v2 is not yet stabilized. v1 remains canonical
> (`../v1/`). This schema exists so v2 manifests can be validated.

**Writing a manifest? Start with [`AUTHORING.md`](AUTHORING.md)** — the
practical guide to the format: block-by-block walkthrough, all eight
judgment SLO types worked, and v1→v2 migration. This README covers the
validator; that covers the format.

## What it validates

- `schema.json` — three document kinds, discriminated on `kind`:
  - **`ServiceManifest`** — the Backstage-style `apiVersion/kind/metadata/spec`
    envelope: `owner`, `service`, classical `slo`, `judgment_slo`, `contracts`,
    `dependencies`, `instrumentation`, `template`.
  - **`JudgmentSLO`** — a standalone judgment-SLO document. `spec.judgment_type`
    selects one of the **eight** standard types, each with its own required
    `measurement`/`sampling`/`probe`/`target` shape:
    `reversal_rate`, `high_confidence_failure`, `audit_sampling`, `outcomes`,
    `escalation`, `segments`, `stability`, `calibration`.
  - **`ServiceManifestTemplate`** — shared defaults a `ServiceManifest` extends.

Conventions enforced: ratios are `0.0–1.0` (not percentages); durations match
`^[0-9]+(ms|s|m|h|d|w)$`; throughput matches `^[0-9]+rps$`; owner/dependency
references use Backstage `<kind>:<namespace>/<name>` form.

**Out of scope (per spec §4.4):** embedded classical SLOs under `slo` are
OpenSLO v1 documents and are validated against the OpenSLO schema separately,
not here — this schema only checks they are a `$ref` or an OpenSLO-shaped
object.

## Layout

```
spec/v2/
├── AUTHORING.md                # how to WRITE a manifest (start here)
├── schema.json                 # the validator
├── validate.sh                 # asserts examples validate + invalid fixtures fail
├── examples/                   # valid fixtures — every file here must validate
│   ├── judgment-slos/01..08-*.yaml   # one JudgmentSLO per standard type
│   ├── services/{api,worker,stream,ai-gate}.yaml  # one per service archetype
│   ├── migration/api-full-v2.yaml    # the repo-root v1 manifest, migrated
│   ├── minimal.yaml            # smallest manifest the schema accepts
│   ├── service-manifest-full.yaml
│   ├── service-manifest-template.yaml
│   ├── template-extension.yaml # a manifest extending that template
│   └── x-service-type.yaml     # an implementation-specific `x-` service type
└── tests/invalid/              # negative fixtures that MUST be rejected
```

## Validate

```bash
# validate one manifest
uvx check-jsonschema --schemafile spec/v2/schema.json path/to/manifest.yaml

# run the full fixture suite (positives validate, negatives are rejected)
bash spec/v2/validate.sh
```

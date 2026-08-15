# OpenSRM v2 manifest authoring guide — design

**Bead:** opensrm-tu04.3 (P3-DOC.3, P2) — last child of epic opensrm-tu04.
**Date:** 2026-08-15
**Depends on:** opensrm-7774 (v2 spec docs on main), opensrm-k7xw (v2 schema.json) — both closed.

## Goal

A guide that takes an operator from "I have a service" to "I have a valid
OpenSRM v2 manifest", covering all eight judgment SLO types and the v1→v2
migration, with every example validated against `spec/v2/schema.json`.

## Scope decision: v2, not v1

Recorded on the bead 2026-08-14. `OPENSRM-CORE-v2.md` defines the full eight
judgment SLO types (`kind: JudgmentSLO` / `judgment_type`) plus the migration
story; v1 has only ~4 schematized judgment constructs and no migration. The
guide targets v2 and is explicit that v2 is draft while v1 remains canonical.

## Resolved question: "an example per service type"

The bead's acceptance criterion is v1-shaped. v1 had `spec.type` ∈ {`api`,
`worker`, `stream`, `ai-gate`} driving type-specific validation
(`spec/v1/specification.md` §3). **v2 dropped it** — `ServiceIdentity` in
`spec/v2/schema.json` carries only `name` and `description`, and
`OPENSRM-CORE-v2.md` never mentions service types.

**Decision (Rob, 2026-08-15): informal organising axis.** The four archetypes
structure the *documentation* only. No `type` field is reintroduced and
`schema.json` is unchanged. Each archetype is distinguished by which blocks it
uses, not by a discriminator field:

| Archetype | Characteristic blocks |
|---|---|
| `api` | availability + latency SLOs, contracts with `latency_p99`/`throughput` |
| `worker` | processing-time and success-rate SLOs, no inbound contract |
| `stream` | lag and throughput SLOs |
| `ai-gate` | the above plus `judgment_slo` |

A follow-up bead records the open question of whether v2 should reintroduce a
type discriminator. That is a spec change, out of scope here.

## Deliverables

`spec/v2/AUTHORING.md` — chosen over `docs/` so the guide sits beside the
schema, fixtures and validator it references, and so the existing forward
reference in `spec/v2/README.md` resolves locally.

Five new fixtures, picked up automatically by `validate.sh` (it globs
`examples/**/*.yaml` recursively — no wiring needed):

- `spec/v2/examples/services/{api,worker,stream,ai-gate}.yaml`
- `spec/v2/examples/migration/api-full-v2.yaml`

## Guide structure

1. Scope, audience, and the v2-draft status caveat.
2. The envelope — a minimal valid manifest; `apiVersion`/`kind`/`metadata`/`spec`.
3. Choosing a starting point — the four archetypes, each linking to its fixture.
4. Block-by-block — `owner`, `service`, `slo` (`$ref` vs inline OpenSLO),
   `judgment_slo`, `contracts`, `dependencies`, `instrumentation`, `template`.
5. The eight judgment SLO types. Per type: what it measures, when to reach for
   it, how to set the target, what a breach means, and the common mistake —
   wrapped around the existing k7xw fixtures.
6. Conventions and gotchas — ratios are 0.0–1.0 not percentages; duration
   suffixes; `rps`; Backstage entity refs; and the load-bearing `contracts`
   (external promise) vs `slo` (internal target) distinction.
7. Migrating from v1 — the five steps from `OPENSRM-CORE-v2.md` §12, worked
   side-by-side against the real existing `examples/api-full.yaml`.
8. Validating — `uvx check-jsonschema` and `bash spec/v2/validate.sh`.

## Example/fixture relationship

**Excerpt + link.** Complete manifests live only in `spec/v2/examples/`; the
guide shows short annotated excerpts of the block under discussion and links to
the full file. No complete manifest is duplicated in prose, so there is no
copy to drift out of sync. `validate.sh` is the enforcement point.

The one deliberate exception is the v1 "before" manifest in §7: it is v1 and
would be **rejected** by the v2 schema, so it cannot live under `examples/`. It
is quoted inline from the real `examples/api-full.yaml` at repo root; only the
migrated "after" becomes a validated fixture.

## Judgment SLO examples

Prose around the existing eight k7xw fixtures rather than eight new
scenario-based ones. The fixtures stay canonical; the guide adds the reasoning
a bare fixture cannot carry. Avoids doubling the fixture count and the
re-validation churn that comes with it.

## Verification

Baseline before this work: `validate.sh` green at 10 positive + 6 negative
fixtures. Target after: green at 15 positive + 6 negative. Each new fixture
must validate, and no existing fixture may regress.

## Checkpoint plan

Per the epic-checkpoint rule, work stops and asks at each boundary.

| CP | Deliverable | Gate |
|---|---|---|
| 1 | 4 archetype fixtures + migration fixture | `validate.sh` green at 15 positives |
| 2 | Guide §1–4 | excerpts match their fixtures |
| 3 | Guide §5–6 (all 8 judgment types) | all 8 covered |
| 4 | Guide §7–8 + worked migration | `validate.sh` green |
| 5 | 4 sequential R5 passes, fixes between passes, commit, `bd close` | all four clean |

## Out of scope

- Reintroducing `service.type` to the v2 spec or schema (follow-up bead).
- Hardening the v2 schema — tracked separately as opensrm-vquh.
- Any change to v1.

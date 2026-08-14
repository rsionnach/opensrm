# OpenSRM

The **OpenSRM specification** — an open standard for declaring
service reliability requirements (SLOs, contracts, dependencies,
notifications) in machine-readable form. Specification-only repo:
no code, no runtime. The implementation that consumes this spec is
NthLayer (see `../nthlayer/CLAUDE.md`).

## Stack

YAML + JSON Schema. The spec is at `spec/v1/specification.md`; the
schema at `spec/v1/schema.json`. Examples and templates live
alongside.

## Build / test / lint commands

Spec-only — no Python build, no test suite to run. AGENTS.md
captures the shell hygiene rules (non-interactive shell defaults)
and the beads workflow rules that apply when authoring spec PRs.

→ See `AGENTS.md`.

## Beads — the bead database lives in this repo

**All ecosystem beads live in `opensrm/`'s Dolt database.** Every
`bd` command in any of the seven member repos must run from this
directory:

```bash
cd opensrm
bd ready --json
bd show <id> --json
bd close <id> --reason "..." --json
```

Running `bd` from anywhere else hits a different (empty) database
and silently does the wrong thing. This is the canonical home for
all beads — do not create per-repo `.beads/` databases.

## Hard rules

These are load-bearing — wrong-side mistakes either invalidate
downstream NthLayer consumers, fork the spec, or violate the
shift-left contract.

1. **The spec is `opensrm/v1`.** All examples, the schema, and
   downstream consumers reference this exact API version (commit
   `df80f12` standardised it). Do not introduce ad-hoc version
   strings.

2. **Ratios in the spec are 0.0–1.0, NOT percentages.** This is the
   wire format. NthLayer's internal consumers convert to the 0–100
   percentage canonical at the manifest-load boundary
   (`nthlayer-common.manifest`). Keep the spec ratio-shaped — the
   conversion is one-direction at the consumer.

3. **Durations are numeric + unit suffix.** `"100ms"`, `"30d"` —
   never bare seconds, never ISO 8601 durations. Units: `ms`, `s`,
   `m`, `h`, `d`, `w`. The parser is a small lookup dict; new units
   require an explicit decision.

4. **`spec.contract` and `spec.slos` are distinct surfaces.**
   `contract` = external promises to dependents (what you guarantee
   to them). `slos` = internal targets (typically tighter than the
   contract). Conflating them silently weakens the dependency
   graph.

5. **`expects` declares dependency guarantees.** Use
   `expects.availability` (ratio) and `expects.latency.p99`
   (duration). Set `critical: true` when dependency failure
   propagates. The optional `manifest` URL points to the
   dependency's OpenSRM file — this is how blast-radius math finds
   it.

6. **Schemas before implementation.** Every component is defined by
   a specification first; implementation follows. The four-execution-
   model taxonomy (data sources / data primitives / tools / agents)
   is load-bearing — the test for which one a component is lives in
   `docs/spec-conventions.md`.

7. **Reasoning boundary.** Agent capabilities are reserved for
   components requiring interpretation. Deterministic operations
   (validation, generation, arithmetic) remain as tools that agents
   invoke. Do not insert LLM calls into the validator or compiler
   paths.

8. **No code, no runtime in this repo.** If you find yourself
   writing Python here, you are in the wrong repo. Implementation
   work goes to the relevant NthLayer component repo. The exception
   is `scripts/` utility shell — those are spec-authoring tools, not
   runtime.

## Where to find detail

- Full spec format conventions (service type mappings, SLO
  structure, judgment SLO structure for `ai-gate`, notifications,
  dependencies, design principles, component taxonomy, data flows,
  integration points): `docs/spec-conventions.md`.
- Authoritative specification:
  - `spec/v1/specification.md`.
  - `spec/v1/schema.json`.
- OpenSRM v2 spec docs at repo root (moved from ecosystem root under
  opensrm-hty.6):
  - `OPENSRM-CORE-v2.md` — v2-draft core spec (supersedes v1, dated
    2026-04-19).
  - `OPENSRM-RBAC-EXTENSION-v2.md` — RBAC extension v1.1-draft
    (supersedes `OPENSRM-RBAC-EXTENSION.md` v1.0-draft).
  - `OPENSRM-RBAC-EXTENSION.md` — legacy v1.0-draft, retained for
    reference.
- Ecosystem-level docs at repo root:
  - `README.md` — unified project overview with ecosystem diagram
    and quick-start examples.
  - `ARCHITECTURE.md` — comprehensive ecosystem architecture (design
    principles, component taxonomy, 4-layer system, agent
    communication, data flows, integration points).
  - `ECOSYSTEM.md` — how components compose, streaming layer
    discussion, deployment tiers, post-incident learning loop,
    security model.
  - `IMPLEMENTATION-PLAN.md`, `IMPLEMENTATIONS.md`, `STATUS.md` —
    rollout state.
  - `GOVERNANCE.md`, `CONTRIBUTING.md`, `CHANGELOG.md` — project
    metadata.
- NthLayer implementation that consumes the spec:
  `../nthlayer/CLAUDE.md` (front door + ecosystem hub).
- AGENTS.md (long form): shell hygiene rules + bd quick start +
  workflow for AI agents + landing-the-plane checklist.
- Beads (always from here): `bd ready --json`.

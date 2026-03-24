# Status

Last updated: March 2026

## Overview

| Component | Location | Status | Notes |
|-----------|----------|--------|-------|
| **Core Specification** | `spec/v1/specification.md` | ✅ Stable | Includes ai-gate type |
| **JSON Schema** | `spec/v1/schema.json` | ✅ Stable | Validation schema |
| **Judgment SLOs** | `spec/v1/judgment-slos.md` | ✅ Documented | Detailed reference |
| **GitHub Action** | `action/` | ✅ Available | CI/CD validation |
| **NthLayer** | External repo | 🟡 Alpha | Reliability-as-code CLI |
| **nthlayer-learn (Verdict)** | External repo | ✅ Implemented | Data primitive library |
| **nthlayer-measure** | External repo | ✅ Implemented | Quality measurement + governance |
| **nthlayer-correlate** | External repo | ✅ Implemented | Pre-correlation agent |
| **nthlayer-respond** | External repo | ✅ Implemented | Multi-agent incident response |
| **Change Events** | `conventions/change-events/` | 📝 Drafted | OTel proposal |
| **Decision Telemetry** | `conventions/decision-telemetry/` | 📝 Drafted | OTel proposal |

**Legend:**
- ✅ Stable / Implemented
- 🟡 Alpha / In Progress
- 📝 Drafted / Needs Review

---

## Specification (spec/)

### Core Specification
**Status:** ✅ Stable

The foundation. Defines ServiceReliabilityManifests including:
- Service metadata (name, tier, labels)
- Service types (api, worker, stream, ai-gate)
- SLO definitions (availability, latency, throughput)
- Dependencies (upstream/downstream, expectations)
- Ownership (team, contacts)
- Contracts (external promises)

**Location:** `spec/v1/specification.md`

### ai-gate Extension
**Status:** ✅ Stable

Extension for AI decision services. Included in core spec.
- `type: ai-gate` declaration
- Judgment SLO fields
- Instrumentation requirements

**Location:** `spec/v1/specification.md` (Section 5)

### Judgment SLOs Reference
**Status:** ✅ Documented

Detailed reference for judgment SLO metrics:
- Reversal rate
- High-confidence failure rate
- Calibration (ECE)
- Audit layers (proactive spot-checks)
- Maturity levels

**Location:** `spec/v1/judgment-slos.md`

### JSON Schema
**Status:** ✅ Stable

Machine-readable validation schema.

**Location:** `spec/v1/schema.json`

---

## Conventions (conventions/)

### Change Events
**Status:** 📝 Drafted

OTel semantic conventions for operational changes.

| Artifact | Status |
|----------|--------|
| Specification | Drafted |
| Implementation plan | Drafted |
| Examples | Drafted |

**Next steps:**
1. Engage OTel CI/CD SIG
2. Socialize in #cicd-o11y Slack
3. Submit PR to semantic-conventions repo

**Location:** `conventions/change-events/`

### Decision Telemetry
**Status:** 📝 Drafted

OTel semantic conventions for AI/human decisions.

| Artifact | Status |
|----------|--------|
| gen_ai.decision.* attributes | Drafted |
| gen_ai.reversal.* attributes | Drafted |
| gen_ai.outcome.* attributes | Drafted |
| Examples | Drafted |

**Next steps:**
1. Continue OTel GenAI SIG engagement
2. Align with genai-utils work
3. Submit PR

**Location:** `conventions/decision-telemetry/`

---

## Components (components/)

### NthLayer
**Status:** 🟡 Partial

Reference implementation of OpenSRM. Generates monitoring artifacts from manifests.

| Capability | Status |
|------------|--------|
| Manifest validation | ✅ Done |
| Prometheus rule generation | ✅ Done |
| Grafana dashboard generation | ✅ Done |
| PagerDuty config generation | ✅ Done |
| Topology export | 🟡 Partial |
| Judgment SLO alerting | ❌ Not started |

**Location:** External repo ([github.com/rsionnach/nthlayer](https://github.com/rsionnach/nthlayer))

**Next:** 
- Export topology for nthlayer-correlate consumption
- Add judgment SLO alert generation

### nthlayer-correlate
**Status:** ✅ Implemented (Phase 2 Tier 1)

Pre-correlation agent for AI-native observability.

| Artifact | Status |
|----------|--------|
| Proposal | Complete |
| Technical appendix | Complete |
| Snapshot schema | Complete |
| Correlation engine | Implemented |
| Ingestion layer | Implemented |
| State machine | Implemented |
| SQLite event store | Implemented |
| CLI (serve/status/replay) | Implemented |
| Tests (14 files, ~111 tests) | Passing |
| Synthetic scenarios (5) | Complete |

**Location:** External repo ([github.com/rsionnach/nthlayer-correlate](https://github.com/rsionnach/nthlayer-correlate))

**Package:** `pip install nthlayer-correlate` (0.1.0a1)

### nthlayer-respond
**Status:** ✅ Implemented (Phase 3 complete)

Multi-agent incident response system.

| Artifact | Status |
|----------|--------|
| Architecture | Complete |
| Coordinator (state machine) | Implemented |
| Triage agent | Implemented |
| Investigation agent | Implemented |
| Communication agent | Implemented |
| Remediation agent | Implemented |
| Safe actions registry | Implemented |
| Context store (SQLite) | Implemented |
| CLI (serve/status/replay/approve/reject) | Implemented |
| Tests (13 files, ~168 tests) | Passing |
| Synthetic scenarios (8) | Complete |

**Location:** External repo ([github.com/rsionnach/nthlayer-respond](https://github.com/rsionnach/nthlayer-respond))

**Package:** `pip install nthlayer-respond` (0.1.0a1)

---

## Tooling (action/)

### GitHub Action
**Status:** ✅ Available

Validates OpenSRM manifests in CI pipelines.

```yaml
- uses: rsionnach/opensrm@v1
  with:
    manifest: service.reliability.yaml
```

**Location:** `action/`, `action.yml`

---

## Current Focus

**Completed (Q1 2026):**
- [x] nthlayer-learn (Verdict) — Python library + CLI
- [x] nthlayer-measure — Phase 1 verdict integration, governance
- [x] nthlayer-correlate — Phase 2 Tier 1 implementation
- [x] nthlayer-respond — Phase 3 full implementation
- [x] nthlayer.io website with live topology demo

**Next:**
- [ ] OTel decision telemetry PR
- [ ] Change events OTel PR
- [ ] Production deployment hardening

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-20 | Expand opensrm to include ecosystem | Single repo for spec + vision |
| 2026-02-20 | Rename "Situations" to "nthlayer-correlate" | Avoid Moogsoft/BigPanda terminology |
| 2026-02-20 | Hybrid generation model for nthlayer-correlate | Batch + incident-triggered + refresh |
| 2026-02-16 | Add audit layer to judgment SLOs | Reversal rate alone misses unreversed bad decisions |
| 2026-01-23 | Use OpenSRM name | Follows OpenSLO, OpenTelemetry pattern |
| 2026-01-22 | Position change events as OTel extension | Complement CDEvents, not compete |

---

## Roadmap

### Phase 1: Specifications (Q1 2026) — Complete
- [x] Core OpenSRM spec
- [x] ai-gate extension
- [x] Judgment SLOs reference
- [x] Change events OTel proposal (drafted)
- [x] Decision telemetry OTel proposal (drafted)

### Phase 2: Core Implementations (Q1 2026) — Complete
- [x] nthlayer-learn (Verdict) — Python library + CLI
- [x] nthlayer-measure — evaluation pipeline + verdict integration + governance
- [x] nthlayer-correlate — correlation engine, ingestion, snapshots, state machine
- [x] nthlayer-respond — coordinator, 4 agents, safe actions, crash recovery

### Phase 3: Integration & Hardening (Q2 2026)
- [ ] OTel convention PRs (CI/CD SIG, GenAI SIG)
- [ ] NthLayer judgment SLO support
- [ ] End-to-end integration testing across components
- [ ] Production deployment guides

### Phase 4: Adoption (Q3-Q4 2026)
- [ ] Production deployments
- [ ] Community contributions
- [ ] Conference talks

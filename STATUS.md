# Status

Last updated: February 2026

## Overview

| Component | Location | Status | Notes |
|-----------|----------|--------|-------|
| **Core Specification** | `spec/v1/specification.md` | ✅ Stable | Includes ai-gate type |
| **JSON Schema** | `spec/v1/schema.json` | ✅ Stable | Validation schema |
| **Judgment SLOs** | `spec/v1/judgment-slos.md` | ✅ Documented | Detailed reference |
| **GitHub Action** | `action/` | ✅ Available | CI/CD validation |
| **NthLayer** | External repo | 🟡 Partial | Reference implementation |
| **Change Events** | `conventions/change-events/` | 📝 Drafted | OTel proposal |
| **Decision Telemetry** | `conventions/decision-telemetry/` | 📝 Drafted | OTel proposal |
| **nthlayer-correlate** | `components/sitrep/` | 📐 In design | Pre-correlation layer |
| **nthlayer-respond** | `components/mayday/` | 💭 Architecture | Multi-agent system |

**Legend:**
- ✅ Stable / Complete
- 🟡 Partial / In Progress  
- 📝 Drafted / Needs Review
- 📐 In Design
- 💭 Concept Only

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
**Status:** 📐 In design

Pre-correlation layer for AI-native observability.

| Artifact | Status |
|----------|--------|
| Proposal | Complete |
| Technical appendix | Complete |
| Snapshot schema | Complete |
| Correlation algorithms | Designed |
| Implementation | Not started |

**Location:** `components/sitrep/`

**Depends on:** NthLayer topology export, Change events spec

### nthlayer-respond
**Status:** 💭 Architecture only

Multi-agent incident response system.

| Artifact | Status |
|----------|--------|
| Architecture | Complete |
| Agent specs | Partial |
| Implementation | Not started |

**Location:** `components/mayday/`

**Depends on:** nthlayer-correlate

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

**This month (February 2026):**
- [ ] Judgment SLOs article (publish)
- [ ] Populate `conventions/` directory

**Next month (March 2026):**
- [ ] OTel decision telemetry PR
- [ ] NthLayer topology export

**Q2 2026:**
- [ ] nthlayer-correlate MVP
- [ ] Change events OTel PR

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

### Phase 1: Specifications (Q1 2026)
- [x] Core OpenSRM spec
- [x] ai-gate extension
- [x] Judgment SLOs reference
- [ ] Change events OTel proposal
- [ ] Decision telemetry OTel proposal
- [ ] Publish judgment SLOs article

### Phase 2: Implementations (Q2 2026)
- [ ] NthLayer judgment SLO support
- [ ] NthLayer topology export
- [ ] nthlayer-correlate MVP

### Phase 3: Integrations (Q3 2026)
- [ ] nthlayer-correlate + NthLayer integration
- [ ] nthlayer-respond consumer
- [ ] Keep extension (potential)

### Phase 4: Adoption (Q4 2026)
- [ ] Production deployments
- [ ] Community contributions
- [ ] Conference talks

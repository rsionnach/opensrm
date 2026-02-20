# OpenSRM Repository Expansion Specification

This document specifies the files needed to expand opensrm from a specification repository to a full ecosystem hub.

---

## Current Structure (Exists)

```
opensrm/
├── spec/
│   └── v1/
│       ├── specification.md      ✅ EXISTS
│       └── schema.json           ✅ EXISTS
├── examples/
│   ├── api-basic.yaml            ✅ EXISTS
│   ├── ai-gate-minimal.yaml      ✅ EXISTS
│   ├── ai-gate-full.yaml         ✅ EXISTS
│   └── ai-gate-security-scanner.yaml ✅ EXISTS
├── action/                       ✅ EXISTS (GitHub Action)
├── action.yml                    ✅ EXISTS
├── CHANGELOG.md                  ✅ EXISTS
├── CONTRIBUTING.md               ✅ EXISTS
├── GOVERNANCE.md                 ✅ EXISTS
├── IMPLEMENTATIONS.md            ✅ EXISTS
├── LICENSE                       ✅ EXISTS
└── README.md                     ✅ EXISTS (needs update)
```

## Target Structure (After Expansion)

```
opensrm/
│
├── README.md                     🔄 UPDATE
├── ARCHITECTURE.md               ✨ NEW
├── STATUS.md                     ✨ NEW
├── CONTRIBUTING.md               ✅ EXISTS
├── GOVERNANCE.md                 ✅ EXISTS
├── IMPLEMENTATIONS.md            ✅ EXISTS
├── CHANGELOG.md                  ✅ EXISTS
├── LICENSE                       ✅ EXISTS
│
├── spec/                         ✅ EXISTS - EXPAND
│   └── v1/
│       ├── specification.md      ✅ EXISTS
│       ├── schema.json           ✅ EXISTS
│       └── judgment-slos.md      ✨ NEW
│
├── conventions/                  ✨ NEW DIRECTORY
│   ├── README.md
│   ├── change-events/
│   │   ├── README.md
│   │   ├── SPEC.md
│   │   ├── IMPLEMENTATION.md
│   │   └── examples/
│   │       ├── deployment.json
│   │       ├── config-change.json
│   │       └── feature-flag.json
│   └── decision-telemetry/
│       ├── README.md
│       ├── decision.md
│       ├── reversal.md
│       ├── outcome.md
│       ├── IMPLEMENTATION.md
│       └── examples/
│           ├── code-review-decision.json
│           ├── incident-response.json
│           └── human-override.json
│
├── components/                   ✨ NEW DIRECTORY
│   ├── README.md
│   ├── nthlayer.md
│   ├── sitrep/
│   │   ├── README.md
│   │   ├── proposal.md
│   │   ├── technical-appendix.md
│   │   ├── schema.yaml
│   │   ├── correlation.md
│   │   ├── api.md
│   │   └── examples/
│   │       ├── batch-snapshot.json
│   │       └── incident-snapshot.json
│   └── incidenttown/
│       ├── README.md
│       └── architecture.md
│
├── articles/                     ✨ NEW DIRECTORY
│   ├── README.md
│   └── drafts/
│       └── judgment-slos.md
│
├── examples/                     ✅ EXISTS
│   ├── api-basic.yaml
│   ├── ai-gate-minimal.yaml
│   ├── ai-gate-full.yaml
│   └── ai-gate-security-scanner.yaml
│
├── action/                       ✅ EXISTS
└── action.yml                    ✅ EXISTS
```

---

## Files to Create

### Phase 1: Foundation (This Week)

| File | Priority | Status | Notes |
|------|----------|--------|-------|
| `README.md` | High | 🔄 Update | Add ecosystem vision |
| `ARCHITECTURE.md` | High | ✨ Create | Full stack diagram |
| `STATUS.md` | High | ✨ Create | Component tracking |
| `spec/v1/judgment-slos.md` | High | ✨ Create | Extract from spec, expand |

### Phase 2: Conventions (Week 2-3)

| File | Priority | Notes |
|------|----------|-------|
| `conventions/README.md` | High | Overview of OTel proposals |
| `conventions/change-events/README.md` | High | Overview |
| `conventions/change-events/SPEC.md` | High | Full specification |
| `conventions/change-events/IMPLEMENTATION.md` | Medium | OTel engagement plan |
| `conventions/change-events/examples/*.json` | Medium | 3-5 examples |
| `conventions/decision-telemetry/README.md` | High | Overview |
| `conventions/decision-telemetry/decision.md` | High | gen_ai.decision.* |
| `conventions/decision-telemetry/reversal.md` | High | gen_ai.reversal.* |
| `conventions/decision-telemetry/outcome.md` | High | gen_ai.outcome.* |
| `conventions/decision-telemetry/IMPLEMENTATION.md` | Medium | OTel engagement plan |
| `conventions/decision-telemetry/examples/*.json` | Medium | 3-5 examples |

### Phase 3: Components (Week 3-4)

| File | Priority | Notes |
|------|----------|-------|
| `components/README.md` | High | Overview of ecosystem |
| `components/nthlayer.md` | Medium | Link + overview |
| `components/sitrep/README.md` | High | Overview |
| `components/sitrep/proposal.md` | High | Move from outputs |
| `components/sitrep/technical-appendix.md` | High | Move from outputs |
| `components/sitrep/schema.yaml` | High | Extract from appendix |
| `components/sitrep/correlation.md` | Medium | Algorithm details |
| `components/sitrep/api.md` | Medium | API specification |
| `components/incidenttown/README.md` | Low | Overview |
| `components/incidenttown/architecture.md` | Low | Move from outputs |

### Phase 4: Articles (Ongoing)

| File | Priority | Notes |
|------|----------|-------|
| `articles/README.md` | Low | Index of content |
| `articles/drafts/judgment-slos.md` | High | Main article for publication |

---

## File Specifications

### README.md (Update)

**Purpose:** Entry point, ecosystem vision

**Changes needed:**
- Add ecosystem diagram
- Add component table with status
- Add links to new directories
- Keep existing quick start content

**Template:** See `/home/claude/opensrm/README.md`

---

### ARCHITECTURE.md

**Purpose:** Technical architecture documentation

**Contents:**
- Design principles
- System overview diagram
- Component details
- Data flows
- Integration points
- Deployment considerations

**Length:** ~500 lines

**Template:** See `/home/claude/opensrm/ARCHITECTURE.md`

---

### STATUS.md

**Purpose:** Track progress across all components

**Contents:**
- Component status table
- Detailed status per component
- Current focus
- Decisions log
- Roadmap

**Updates:** Monthly or on significant change

**Template:** See `/home/claude/opensrm/STATUS.md`

---

### spec/v1/judgment-slos.md

**Purpose:** Detailed reference for judgment SLO metrics

**Contents:**
- Overview of judgment vs operational SLOs
- Reversal rate (definition, calculation, targets, examples)
- High-confidence failure (definition, calculation, targets)
- Calibration / ECE (definition, calculation, targets)
- Audit layer (sample_rate, accuracy, coverage)
- Maturity levels (reactive → proactive → outcome → behavioral)
- Guidance on setting targets
- Integration with OpenSRM manifests

**Length:** ~400 lines

**Source:** Extract from existing spec + expand from chat discussions

---

### conventions/README.md

**Purpose:** Overview of OTel semantic convention proposals

**Contents:**
```markdown
# OpenSRM Semantic Conventions

OpenSRM proposes OpenTelemetry semantic conventions for operational signals
that are currently underspecified or missing.

## Proposals

| Convention | Purpose | Status |
|------------|---------|--------|
| [Change Events](change-events/) | Operational changes | Drafted |
| [Decision Telemetry](decision-telemetry/) | AI/human decisions | Drafted |

## Why OTel?

[Rationale for extending OTel rather than creating standalone specs]

## Engagement

[Links to OTel SIGs, how to participate]
```

---

### conventions/change-events/SPEC.md

**Purpose:** Full semantic convention specification

**Contents:**
- Abstract
- Motivation
- Required attributes (change.id, change.type, change.timestamp)
- Scope attributes (change.scope.*)
- Actor attributes (change.actor.*)
- Risk attributes (change.risk.*)
- Change types (deployment, configuration, feature_flag, etc.)
- Lifecycle (status values)
- Examples
- OTel integration

**Length:** ~600 lines

**Source:** Move from prior chat outputs

---

### conventions/decision-telemetry/decision.md

**Purpose:** gen_ai.decision.* attributes specification

**Contents:**
- Overview
- Attribute table
- Usage guidance
- Relationship to existing GenAI conventions
- Examples

**Length:** ~200 lines

**Source:** Extract from chat discussions

---

### components/sitrep/proposal.md

**Purpose:** Business/strategic proposal

**Source:** Move `sitrep-proposal-v2.docx` content (as markdown)

---

### components/sitrep/technical-appendix.md

**Purpose:** Technical deep-dive

**Source:** Move `situations-technical-appendix-v2.md`

---

### components/sitrep/schema.yaml

**Purpose:** Canonical snapshot schema

**Contents:** Extract from technical appendix, standalone YAML with comments

---

### articles/drafts/judgment-slos.md

**Purpose:** Main thought leadership article for publication

**Contents:**
- Hook: AI agents are making decisions, but how do you know they're good?
- Problem: Traditional SLOs measure system health, not judgment
- Solution: Four judgment SLO metrics
- Framework: Maturity levels
- Getting started: Practical guidance
- Call to action: OpenSRM

**Length:** ~2500 words

**Target:** Personal blog, dev.to, or CNCF blog

---

## Migration Checklist

### Existing Files to Move

| Source | Destination |
|--------|-------------|
| `sitrep-proposal-v2.docx` (convert to md) | `components/sitrep/proposal.md` |
| `situations-technical-appendix-v2.md` | `components/sitrep/technical-appendix.md` |
| `incidenttown-architecture.md` | `components/incidenttown/architecture.md` |
| `CHANGE_EVENT_SEMANTIC_CONVENTION.md` | `conventions/change-events/SPEC.md` |
| `CHANGE_EVENTS_IMPLEMENTATION_PLAN.md` | `conventions/change-events/IMPLEMENTATION.md` |

### Content to Extract

| Source | Extract | Destination |
|--------|---------|-------------|
| `spec/v1/specification.md` | Section 5 (Judgment SLOs) | `spec/v1/judgment-slos.md` (expand) |
| `technical-appendix.md` | Snapshot schema section | `components/sitrep/schema.yaml` |
| Chat discussions | Decision telemetry attributes | `conventions/decision-telemetry/*.md` |

---

## Validation

### CI Workflow Updates

Add to `.github/workflows/validate.yaml`:

```yaml
- name: Validate new examples
  run: |
    for f in conventions/*/examples/*.json; do
      echo "Validating $f"
      jq . "$f" > /dev/null
    done
```

### Link Checker

```bash
# Check for broken internal links
find . -name "*.md" -exec grep -l "\[.*\](.*)" {} \; | \
  xargs -I {} markdown-link-check {}
```

---

## Success Criteria

### Repository Health

- [ ] All new directories have README.md
- [ ] All specs have at least one example
- [ ] No broken internal links
- [ ] STATUS.md reflects actual state

### Adoption Signals (3 months)

- [ ] 10+ additional GitHub stars
- [ ] 3+ external issues or discussions
- [ ] 1+ article published
- [ ] 1+ OTel PR submitted

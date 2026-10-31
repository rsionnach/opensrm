# Decision Telemetry Semantic Convention

**Status:** Drafted

## Overview

A proposed OpenTelemetry semantic convention for AI and human decision events -- capturing decisions, reversals, and outcomes to enable judgment SLO measurement.

## Motivation

AI agents are making operational decisions (code reviews, incident response, security scanning), but there is no standard way to measure whether those decisions are good. This convention defines telemetry attributes that enable:

- Reversal rate tracking (how often humans override AI)
- High-confidence failure detection
- Outcome-based ground truth correlation
- Calibration measurement

These signals feed directly into OpenSRM [judgment SLOs](../../spec/v1/judgment-slos.md).

## Proposal form and wire form

The tables below are the **upstream proposal form**, the `gen_ai.*` names this convention proposes to OpenTelemetry. They are not emitted. Until upstream accepts them, OpenSRM applications emit the **wire form**: the same attributes with identical suffixes under `nthlayer.` (`gen_ai.decision.id` is emitted as `nthlayer.decision.id`). The wire form, which attributes are required, and the event definitions are normative in [Addendum A1](../../OPENSRM-TELEMETRY-ADDENDUM-v2.md) §4; where this page and A1 differ, A1 governs.

## Core Attribute Families

### Decision (`gen_ai.decision.*`)

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.decision.id` | string | Unique decision identifier |
| `gen_ai.decision.type` | string | The class of decision the gate makes (`triage`, `refund_approval`) |
| `gen_ai.decision.value` | string | The decision made (`approve`, `reject`, `escalate`) |
| `gen_ai.decision.confidence` | number | Model confidence (0.0-1.0) |
| `gen_ai.decision.autonomous` | boolean | Whether the decision took effect without a human approving it |
| `gen_ai.decision.reversible` | boolean | Whether the decision can be undone after taking effect |
| `gen_ai.decision.segment.<dimension>` | string | One per declared segment dimension (`gen_ai.decision.segment.customer_tier`) |

### Reversal (`gen_ai.reversal.*`)

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.reversal.decision_id` | string | Links to original decision |
| `gen_ai.reversal.type` | string | `human_override`, `self_reconsideration`, `automated`, `appeal` |
| `gen_ai.reversal.actor_type` | string | `human`, `service`, `policy` |
| `gen_ai.reversal.actor` | string | Who reversed it |
| `gen_ai.reversal.new_value` | string | The corrected decision |
| `gen_ai.reversal.reason` | string | Free text; opt-in content |

### Outcome (`gen_ai.outcome.*`)

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.outcome.decision_id` | string | Links to original decision |
| `gen_ai.outcome.value` | string | `correct`, `incorrect`, `indeterminate` |
| `gen_ai.outcome.type` | string | `incident`, `rollback`, `chargeback`, `defect`, `none` |
| `gen_ai.outcome.severity` | string | Impact severity |
| `gen_ai.outcome.source` | string | Which signal resolved the outcome (`incident_resolution`, `human_audit`) |

## Next Steps

1. Continue OTel GenAI SIG engagement
2. Align with existing genai-utils work
3. Submit PR to [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai), where the GenAI conventions now live. Open question (Addendum A1 §11): propose a top-level `decision.*` namespace rather than a `gen_ai.*` extension.

See [STATUS.md](../../STATUS.md) for current progress.

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

## Core Attribute Families

### Decision (`gen_ai.decision.*`)

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.decision.id` | string | Unique decision identifier |
| `gen_ai.decision.value` | string | The decision made (`approve`, `reject`, `escalate`) |
| `gen_ai.decision.confidence` | number | Model confidence (0.0-1.0) |

### Reversal (`gen_ai.reversal.*`)

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.reversal.decision_id` | string | Links to original decision |
| `gen_ai.reversal.type` | string | `human_override`, `automated`, `appeal` |
| `gen_ai.reversal.new_value` | string | The corrected decision |

### Outcome (`gen_ai.outcome.*`)

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.outcome.decision_id` | string | Links to original decision |
| `gen_ai.outcome.type` | string | `incident`, `rollback`, `chargeback`, `defect` |
| `gen_ai.outcome.severity` | string | Impact severity |

## Next Steps

1. Continue OTel GenAI SIG engagement
2. Align with existing genai-utils work
3. Submit PR to [semantic-conventions](https://github.com/open-telemetry/semantic-conventions) repo

See [STATUS.md](../../STATUS.md) for current progress.

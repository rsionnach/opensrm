# Change Events Semantic Convention

**Status:** Drafted

## Overview

A proposed OpenTelemetry semantic convention for operational change events -- deploys, configuration changes, feature flag toggles, and other modifications that affect running systems.

## Motivation

Change is the leading cause of incidents. Yet there is no standard way to represent operational changes in telemetry. CDEvents covers CI/CD pipeline events, but not the broader category of operational changes that affect reliability.

This convention defines attributes for change events that enable:
- Correlation between changes and incidents
- Change frequency and blast radius analysis
- Automated change-incident attribution (used by [Sitrep](../../components/sitrep/))

## Core Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `change.id` | string | Unique change identifier |
| `change.type` | string | `deployment`, `configuration`, `feature_flag`, `infrastructure`, `database` |
| `change.scope.service` | string | Affected service name |
| `change.timestamp` | string | ISO 8601 timestamp |
| `change.actor.id` | string | Who/what initiated the change |
| `change.risk.score` | number | Estimated risk (0.0-1.0) |

## Next Steps

1. Engage OTel CI/CD SIG
2. Socialize in #cicd-o11y Slack
3. Submit PR to [semantic-conventions](https://github.com/open-telemetry/semantic-conventions) repo

See [STATUS.md](../../STATUS.md) for current progress.

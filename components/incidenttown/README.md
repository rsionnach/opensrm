# IncidentTown

**Status:** Architecture only

## Overview

IncidentTown is a multi-agent incident response system that consumes Sitrep snapshots to coordinate automated and human incident response.

## Architecture

IncidentTown uses specialized AI agents that work together during incidents:
- Triage agent -- initial assessment and severity classification
- Investigation agent -- root cause analysis using telemetry correlation
- Communication agent -- stakeholder updates and status page management
- Remediation agent -- suggests and validates fixes

## Dependencies

- **Sitrep** -- provides pre-correlated telemetry snapshots
- **OpenSRM manifests** -- provides service topology, ownership, and SLO context
- **Decision telemetry** -- enables judgment SLO measurement for agent decisions

## Current State

Architecture and agent specifications are partially complete. Implementation has not started.

See [STATUS.md](../../STATUS.md) for current progress.

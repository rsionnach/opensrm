# OpenSRM Semantic Conventions

OpenSRM proposes OpenTelemetry semantic conventions for operational signals that are currently underspecified or missing.

## Proposals

| Convention | Purpose | Status |
|------------|---------|--------|
| [Change Events](change-events/) | Standardized schema for operational changes (deploys, config, feature flags) | Drafted |
| [Decision Telemetry](decision-telemetry/) | Standardized schema for AI/human decisions and outcomes | Drafted |

## Why OTel?

OpenTelemetry is the industry standard for observability instrumentation. Rather than inventing new telemetry formats, OpenSRM extends OTel with semantic conventions for signals that are critical to reliability but currently lack standardization:

- **Change events** enable correlation between operational changes and incidents
- **Decision telemetry** enables measurement of AI decision quality (judgment SLOs)

By proposing these as OTel semantic conventions, we enable interoperability across any OTel-compatible backend.

## Engagement

These conventions are being developed in collaboration with the OpenTelemetry community:

- **Change Events**: Targeting the [CI/CD SIG](https://github.com/open-telemetry/community#cicd)
- **Decision Telemetry**: Targeting the [GenAI SIG](https://github.com/open-telemetry/community#genai)

See [STATUS.md](../STATUS.md) for current progress and next steps.

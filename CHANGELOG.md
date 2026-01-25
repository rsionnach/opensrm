# Changelog

All notable changes to the Service Reliability Manifest specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-draft] - 2026-01-23

### Added
- Initial draft specification
- Core manifest structure (`apiVersion`, `kind`, `metadata`, `spec`)
- Metadata section with `name`, `team`, `tier`, `description`, `labels`, `annotations`
- SLO definitions: availability, latency, error_rate, throughput
- OpenSLO reference support
- Custom SLO types
- Dependencies section with criticality markers
- Ownership section with escalation and runbook links
- Observability section: metrics, dashboards, alerts, tracing
- Deployment section: environments, gates, rollback
- Extension points via annotations and `x-` prefixed custom gates
- JSON Schema for validation
- Example manifests

[Unreleased]: https://github.com/opensrm/opensrm/compare/v1.0.0-draft...HEAD
[1.0.0-draft]: https://github.com/opensrm/opensrm/releases/tag/v1.0.0-draft

# Changelog

All notable changes to the Service Reliability Manifest specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed — BREAKING (v2-draft)
- **Judgment error magnitudes are no longer SLOs** (decision 3c, opensrm-l33e).
  `segments`, `stability` and `calibration` leave `judgment_slo`, and
  `audit_sampling`'s `audit_backlog_maximum_age` leaves its target. All four
  move to the new `spec.judgment_threshold` list, which also gains
  `feedback_latency`. A breach is the measured value exceeding a declared bound;
  there is no error budget and no complement.

  Before:

  ```yaml
  judgment_slo:
    - judgment_type: calibration
      measurement: { bins: 10, window: 30d, method: brier_score }
      target: { maximum_brier_score: 0.05 }
  ```

  After:

  ```yaml
  judgment_threshold:
    - type: calibration
      measurement: { bins: 10, window: 30d }
      bounds: { maximum_brier_score: 0.05 }
  ```

  `target` becomes `bounds`, with the same field names, except that the backlog
  bound is `bounds.maximum_age` under `type: audit_backlog`. `measurement.method`
  is removed: declare either calibration bound, or both, and each is evaluated.
  `judgment_threshold` is inline-only and, like `judgment_slo`, only permitted on
  an `ai-gate` service.

### Changed
- Standardized `apiVersion` to `opensrm/v1` across spec, schema, and all examples (previously `opensrm.io/v1` in spec and `srm/v1` in schema/examples)
- Moved `judgment-slo-spec.md` to `spec/v1/judgment-slos.md` as canonical location
- Merged README drafts into single README.md with ecosystem overview

### Added
- Service Types field (`spec.type`) with values: `api`, `worker`, `stream`, `ai-gate`
- AI Gate support for AI-powered decision systems
- Judgment SLOs for AI gates:
  - `reversal_rate` - measures how often AI decisions are overridden
  - `high_confidence_failure` - measures failure rate of high-confidence decisions
  - `calibration` - measures whether confidence scores predict actual accuracy (ECE)
  - `feedback_latency` - measures time until decision quality can be assessed
- Instrumentation section for AI gate telemetry configuration
- Duration format now supports weeks (`w` suffix)
- Three new AI gate example manifests:
  - `ai-gate-minimal.reliability.yaml` - minimal AI gate configuration
  - `ai-gate-full.reliability.yaml` - complete AI gate with all judgment SLOs
  - `ai-gate-security-scanner.reliability.yaml` - security-focused AI gate

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

[Unreleased]: https://github.com/rsionnach/opensrm/compare/v1.0.0-draft...HEAD
[1.0.0-draft]: https://github.com/rsionnach/opensrm/releases/tag/v1.0.0-draft

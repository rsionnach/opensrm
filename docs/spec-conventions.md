# OpenSRM specification conventions

Rules for authoring `ServiceReliabilityManifest` / `Template`
documents. The `spec/v1/` specification itself is authoritative; this
file captures the conventions that previously lived in CLAUDE.md
AUTO-MANAGED blocks so they remain discoverable without bloating
every-turn context.

## Specification format

- **API version:** `opensrm/v1` (standardised across spec, schema,
  and all examples as of commit `df80f12`).
- **Kinds:** `ServiceReliabilityManifest` or `Template`.
- **Duration values:** numeric + unit suffix
  (`ms`, `s`, `m`, `h`, `d`, `w`) — e.g. `"100ms"`, `"30d"`.
- **Ratio values:** decimal 0.0–1.0, **NOT percentages**.
  `0.999`, not `99.9%`. `0.05`, not `5%`. **Note**: NthLayer internal
  consumers convert this to the 0–100 percentage convention at the
  manifest-load boundary (see `nthlayer-common/CLAUDE.md` and
  opensrm-5fff). The spec itself stays in ratio form.
- **Field requirements:** MUST (required), SHOULD (recommended),
  MAY (optional).

## Service type mappings

| `spec.type` | SLO kinds expected |
|---|---|
| `api` | availability, latency, error_rate, throughput |
| `worker` | availability, processing_time, success_rate |
| `stream` | availability, lag, throughput |
| `ai-gate` | extends `api` with judgment SLOs (reversal_rate, high_confidence_failure, calibration, feedback_latency) |
| `batch` | availability, duration, schedule_adherence, data_freshness |
| `database` | availability, query_latency, replication_lag, connection_availability, throughput |

## SLO structure

All SLOs require:

- `target`: ratio (0–1) for compliance.
- `window`: measurement duration (default varies by SLO type — 30d
  for api / database, 7d for worker / stream).

Latency / processing-time SLOs require at least one percentile (p50,
p90, p95, p99, p999) plus a target ratio.

### Judgment SLO structure (`ai-gate`)

Judgment SLOs are defined within `spec.slos.judgment`:

- `reversal_rate`: target, window, observation_period.
- `high_confidence_failure`: target, window, confidence_threshold.
- `calibration`: target (ECE), window.
- `feedback_latency`: percentiles (p50, p90).
- Requires `spec.instrumentation` section mapping event/attribute
  names.

## Contracts vs SLOs

- `spec.contract`: external promises to dependents (what you
  guarantee).
- `spec.slos`: internal targets (typically tighter than contract).
- Example: `contract.availability = 0.999`,
  `slos.availability.target = 0.9995`.
- Contract judgment: `spec.contract.judgment.max_reversal_rate`,
  `max_hcf_rate`.

## Notifications section (`spec.notifications`)

Optional manifest section separate from `spec.ownership` (ownership =
who owns; notifications = where alerts route):

- `spec.notifications.slack.channel_id`: Slack Web API channel ID for
  interactive messages (routing); `channel` is display name /
  fallback.
- `spec.notifications.events`: list of `{type, severity?}`. Types:
  breach / correlation / incident / remediation / verification /
  resolution. Severity filter [0–4] optional.
- Absent `notifications` section: all six lifecycle events notified
  (backward compatible).
- Channel resolution order:
  `spec.notifications.slack.channel_id`
  → `spec.ownership.slack_channel`
  → `SLACK_CHANNEL_ID` env
  → None.
- Schema designed for future `email` / `pagerduty` entries; only
  `slack` is implemented.
- `nthlayer validate` warns: unknown event type, `channel_id`
  starting with `#`, severity outside [0–4].

## Dependencies

- Use `expects` field to declare required guarantees from
  dependencies.
- Format: `expects.availability` (ratio), `expects.latency.p99`
  (duration).
- Set `critical: true` if dependency failure causes service failure.
- Optional `manifest` URL points to dependency's OpenSRM file.

## Design principles (from `ARCHITECTURE.md`)

1. **Schemas + Enforcement.** Every component is defined by a
   specification first; implementation follows.
2. **Shift-Left Reliability.** Reliability concerns move earlier in
   the lifecycle — manifests define SLOs before deployment.
3. **Operator-Agnostic.** Stack supports both human and AI
   operators (nthlayer-correlate outputs work for dashboards and
   LLMs).
4. **Open Standards.** Extend existing standards (OTel) rather than
   invent new ones.
5. **Reasoning Boundary.** Agent capabilities reserved for
   components requiring interpretation. Deterministic operations
   (validation, generation, arithmetic) remain as tools that agents
   invoke.

## Component taxonomy (from `ARCHITECTURE.md`)

Four execution models determine how components are built, deployed,
tested, and monitored:

- **Data Sources** — Static, queryable, no reasoning (OpenSRM
  manifests in Git, Prometheus metrics, change event logs).
- **Data Primitives** — Schema + transport library, no reasoning
  (Verdict — records AI judgments, sits below all other components
  in the dependency graph).
- **Tools** — Deterministic, invocable, no reasoning (NthLayer
  compiler, schema validator, dependency math engine).
- **Agents** — Reasoning, adaptive, judgment required
  (nthlayer-correlate, nthlayer-respond Triage / Investigation /
  Communication / Remediation, nthlayer-measure).

**Test:** does this component need to reason about ambiguous inputs?
If yes, it's an agent. If it does the same thing every time given
the same input, it's a tool. If it's queryable state, it's a data
source.

**Why this matters:** data and tool layers work without any AI.
Teams can adopt OpenSRM manifests and NthLayer today with zero
agents. The agent layer is additive, not foundational. The system
degrades gracefully if an agent fails.

## Data flows (from `ARCHITECTURE.md`)

- **Flow 1 — Manifest → Monitoring.**
  `service.reliability.yaml` → NthLayer (validate + generate) →
  Prometheus rules / Grafana dashboards / topology →
  nthlayer-correlate.
- **Flow 2 — Events → Verdicts (correlate loop).** Alerts / changes
  (webhook) + topology (NthLayer tool call) + nthlayer-measure
  quality verdicts → nthlayer-correlate correlates →
  `verdict.create()` correlation + snapshot verdicts with lineage →
  [OTel side-effect: `gen_ai.decision.*` per correlation].
- **Flow 3 — Decision → Verdict → Measurement.** Any agent
  `verdict.create()` → [OTel side-effect] → human/CI
  `verdict.resolve()` → [OTel side-effect] → nthlayer-measure
  `verdict.accuracy()` + `verdict.gaming-check()` → autonomy policy
  back to agents.
- **Flow 4 — Agent Tool Invocation.** Agent → `topology_query` to
  NthLayer → NthLayer reads manifest → returns `topology.json`.
  Agent → `check_deploy_gate` → pass/fail.
- **Flow 5 — Incident Lifecycle.** PagerDuty → nthlayer-correlate
  snapshot → Orchestrator creates context → Triage (severity /
  blast radius) → Investigation + Communication in parallel →
  Remediation → Communication update.

## Integration points

External systems:

- Prometheus (remote write, query).
- Alertmanager (webhook).
- GitHub / ArgoCD / LaunchDarkly (webhooks for change events).
- PagerDuty (API, webhook).
- Grafana (JSON import).
- OTel Collector (OTLP for logs / traces).

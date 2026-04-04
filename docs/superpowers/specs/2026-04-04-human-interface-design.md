# Human Interface — Notification Config + Verdict Metrics Panel

**Date:** 2026-04-04
**Bead:** opensrm-2gg (.1 and .3)
**Status:** Design approved, ready for implementation plan

## Problem

nthlayer-respond can send Slack notifications for the full incident lifecycle (6-message thread from breach to resolution), but there's no way to configure *which* events a team cares about or *where* they should go per-service. Notification routing is global (env vars only). And verdict accuracy — the core metric for whether NthLayer's AI agents are producing good judgments — isn't visible in Grafana.

## Part 1: Manifest Notification Config (opensrm-2gg.1)

### New `spec.notifications` Section

Optional section in ServiceReliabilityManifest, separate from `ownership`:

```yaml
spec:
  ownership:
    team: payments
    slack: "#payments-team"          # stays — human context, who owns this

  notifications:
    slack:
      channel_id: C0123PAYMENTS      # Slack Web API channel ID (routing)
      channel: "#payments-oncall"    # display name (fallback, logging)
    events:
      - type: breach
        severity: [1, 2]             # only P1/P2 breaches
      - type: correlation
      - type: incident
      - type: remediation
      - type: verification
      - type: resolution
```

**Design rationale:** `ownership` answers "who owns this service" — team name, escalation contacts, runbook links. `notifications` answers "where do alerts go and which ones" — channels, event filters, severity thresholds. These are different concerns that will diverge over time. A team might own a service but want P1 incidents in `#payments-incidents` and SLO warnings in `#payments-eng`. That doesn't fit in `ownership`.

### Behavior

- When `notifications.slack.channel_id` is set and `SLACK_BOT_TOKEN` is present, interactive messages (approval buttons) route to that channel via Web API
- When only `SLACK_WEBHOOK_URL` is set, incoming webhook notifications still work (channel determined by webhook config, not manifest)
- `events` is the filter — only matching verdict types trigger notifications
- Default when `events` is absent: all six lifecycle events (breach, correlation, incident, remediation, verification, resolution)
- `severity` filter is optional on any event type — when present, only verdicts matching those severity levels trigger. When absent, all severities trigger.
- Entire `notifications` section is optional — absent means "use env var defaults, notify on all events"

### Channel Resolution Order

Updates `resolve_slack_channel` in `notifications.py`:

1. `spec.notifications.slack.channel_id` from manifest
2. `spec.ownership.slack_channel` (backward compat with approval workflow)
3. `SLACK_CHANNEL_ID` env var
4. None (no interactive messages)

### Event Filtering

`send_slack_notification` gains optional `event_type: str` and `severity: int | None` parameters. Before sending, it loads the manifest's `notifications.events` filter from the incident context metadata:

- If `notifications.events` is defined and the event type isn't in the list, skip silently
- If the matching event entry has a `severity` filter and the verdict's severity doesn't match, skip silently
- If `notifications.events` is absent, send all events (backward compatible default)

### Extension Point

The `notifications` section is designed for future channels without overloading `ownership`:

```yaml
notifications:
  slack:
    channel_id: C0123PAYMENTS
  email:
    address: payments-oncall@example.com
    events:
      - type: resolution
  pagerduty:
    service_id: PXXXXXX
    events:
      - type: incident
        severity: [1]
```

Only `slack` is implemented in this spec. `email` and `pagerduty` are future work — the schema accommodates them but they are not built.

### Validation

`nthlayer validate` should warn:
- `events` contains unknown type names (not one of: breach, correlation, incident, remediation, verification, resolution)
- `channel_id` looks like a channel name (starts with `#`) rather than a Slack channel ID
- `severity` values outside 0-4 range

## Part 2: Prometheus Verdict Metrics (opensrm-2gg.3)

### `/metrics` Endpoint on ApprovalServer

New route on the existing starlette app (`nthlayer-respond serve`):

```
GET /metrics    Prometheus text exposition format
```

### Gauges Exposed

```
# Per-component accuracy (1.0 - reversal_rate)
nthlayer_verdict_accuracy{component="measure", verdict_type="evaluation", window="7d"} 0.92
nthlayer_verdict_accuracy{component="correlate", verdict_type="correlation", window="7d"} 0.87
nthlayer_verdict_accuracy{component="respond", verdict_type="triage", window="7d"} 0.91

# Total verdict count by component and type
nthlayer_verdicts_total{component="measure", verdict_type="evaluation"} 47
nthlayer_verdicts_total{component="correlate", verdict_type="correlation"} 23
nthlayer_verdicts_total{component="respond", verdict_type="incident"} 14

# Reversal rate (human overrides / total) per component
nthlayer_verdict_reversal_rate{component="measure", window="7d"} 0.031
nthlayer_verdict_reversal_rate{component="respond", window="7d"} 0.071
```

### Implementation

`VerdictMetricsCollector` class in `nthlayer-respond/src/nthlayer_respond/metrics.py`:

- Reads from the shared verdict store (same SQLite DB the coordinator uses)
- Computes aggregates on each Prometheus scrape — no caching, no background loop. The verdict store is small and local; a `SELECT COUNT(*) ... GROUP BY` per scrape is negligible.
- Renders Prometheus text exposition format directly — no `prometheus_client` dependency. Plain string formatting, same pattern as `test/fake-service.py`.
- `window` label values: `7d` and `30d` (two gauge sets per metric)
- Accuracy = `1.0 - (overridden_count / total_count)`. If total is 0, omit the gauge.
- Reversal rate = `overridden_count / total_count`. If total is 0, omit.
- `component` label derived from `verdict.producer.system` (e.g. `nthlayer-measure` → `measure`)
- `verdict_type` label from `verdict.subject.type`

### Route Wiring

Added to `ApprovalServer.build_app()` alongside the existing routes:

```python
Route("/metrics", self.handle_metrics, methods=["GET"])
```

Returns `Response(content=metrics_text, media_type="text/plain; version=0.0.4; charset=utf-8")`.

### Prometheus Scrape Config

Add to `test/prometheus.yml`:

```yaml
  - job_name: nthlayer-respond
    static_configs:
      - targets: ["host.docker.internal:8090"]
```

## Part 3: Grafana Dashboard

### Provisioned Dashboard

Static JSON file: `test/grafana/dashboards/nthlayer-verdict-accuracy.json`

**Two panel rows:**

**Row 1 (expanded): Verdict Accuracy**
- Time series panel, one line per component (measure, correlate, respond)
- Y-axis 0-1, thresholds at 0.8 (yellow) and 0.9 (green)
- PromQL: `nthlayer_verdict_accuracy{window="7d"}`

**Row 2 (collapsed by default): Reversal Rate**
- Time series panel, one line per component
- Y-axis 0-0.2 (reversal rates are small numbers)
- Thresholds at 0.05 (yellow) and 0.10 (red)
- PromQL: `nthlayer_verdict_reversal_rate{window="7d"}`

Teams think in reversal rate (that's the judgment SLO metric from the OpenSRM spec). Having both accuracy and reversal rate costs nothing and means the dashboard speaks the same language as the manifest.

### Provisioning

New files:
- `test/grafana/dashboards.yml` — provisioning config (tells Grafana to load from `/etc/grafana/provisioning/dashboards/`)
- `test/grafana/dashboards/nthlayer-verdict-accuracy.json` — the dashboard

Docker-compose additions:
- Mount `./grafana/dashboards.yml` into `/etc/grafana/provisioning/dashboards/dashboards.yml`
- Mount `./grafana/dashboards/` into `/etc/grafana/provisioning/dashboards/`

### What This Is NOT

- Not a full dashboard with variables, drill-downs, or per-service panels
- Not generated dynamically per-service (it's ecosystem-wide accuracy)
- Not dependent on any Grafana plugins

## Components

### New Files
- `nthlayer-respond/src/nthlayer_respond/metrics.py` — `VerdictMetricsCollector` class
- `test/grafana/dashboards.yml` — Grafana dashboard provisioning config
- `test/grafana/dashboards/nthlayer-verdict-accuracy.json` — dashboard JSON

### Modified Files
- `nthlayer-respond/src/nthlayer_respond/server.py` — add `/metrics` route, wire `VerdictMetricsCollector`
- `nthlayer-respond/src/nthlayer_respond/notifications.py` — update `resolve_slack_channel` resolution order, add event filtering to `send_slack_notification`
- `opensrm/spec/v1/specification.md` — document `spec.notifications` section
- `opensrm/examples/api-full.yaml` — add `notifications` example
- `test/prometheus.yml` — add `nthlayer-respond` scrape job
- `test/docker-compose.yml` — mount dashboard provisioning into Grafana

### Not Changed
- `nthlayer-common/` — no changes (SlackNotifier and SlackWebClient are sufficient)
- Existing block builders — unchanged
- `ownership.slack` — stays as-is for backward compatibility
- `SLACK_WEBHOOK_URL` path — unchanged, still works for incoming webhook users

## Verification

1. **Notification config:** Manifest with `notifications.events` filters breach-only → only breach notifications sent, correlation/triage/etc. skipped
2. **Channel routing:** Manifest with `notifications.slack.channel_id` → approval buttons route to that channel
3. **Metrics endpoint:** `curl localhost:8090/metrics` returns Prometheus text with `nthlayer_verdict_accuracy` and `nthlayer_verdicts_total` gauges
4. **Grafana panel:** Dashboard auto-provisions on `docker compose up`, shows accuracy lines when verdict data exists
5. **Backward compatibility:** Manifest without `notifications` section → all events notified, same as before
6. **Validation:** `nthlayer validate` warns on unknown event types and `#channel` in `channel_id`

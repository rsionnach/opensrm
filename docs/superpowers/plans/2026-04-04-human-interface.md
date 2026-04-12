# Human Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manifest notification config (event filtering + channel routing) and verdict accuracy metrics (Prometheus endpoint + Grafana dashboard).

**Architecture:** `spec.notifications` section in OpenSRM manifests drives which events trigger Slack messages per-service. `/metrics` endpoint on the existing ApprovalServer exposes verdict accuracy gauges. Grafana provisioned dashboard visualizes accuracy and reversal rate.

**Tech Stack:** starlette (existing), nthlayer-learn verdict store queries, Prometheus text exposition, Grafana JSON dashboard provisioning

---

### Task 1: Event Filtering in `send_slack_notification`

**Files:**
- Modify: `nthlayer-respond/src/nthlayer_respond/notifications.py`
- Create: `nthlayer-respond/tests/test_notifications_filtering.py`

- [ ] **Step 1: Write failing tests for event filtering**

Create `nthlayer-respond/tests/test_notifications_filtering.py`:

```python
"""Tests for notification event filtering."""
from __future__ import annotations

from unittest.mock import MagicMock

from nthlayer_respond.notifications import should_notify


def _make_context(events=None):
    """Build a mock context with notifications config."""
    ctx = MagicMock()
    if events is not None:
        ctx.metadata = {
            "service_context": {
                "spec": {
                    "notifications": {
                        "events": events,
                    }
                }
            }
        }
    else:
        ctx.metadata = {}
    return ctx


def test_should_notify_no_config_allows_all():
    """Without notifications config, all events are allowed."""
    ctx = _make_context(events=None)
    assert should_notify(ctx, "breach") is True
    assert should_notify(ctx, "correlation") is True
    assert should_notify(ctx, "verification") is True


def test_should_notify_filters_by_event_type():
    """Only listed event types are allowed."""
    ctx = _make_context(events=[
        {"type": "breach"},
        {"type": "resolution"},
    ])
    assert should_notify(ctx, "breach") is True
    assert should_notify(ctx, "resolution") is True
    assert should_notify(ctx, "correlation") is False
    assert should_notify(ctx, "incident") is False


def test_should_notify_severity_filter():
    """Event with severity filter only matches listed severities."""
    ctx = _make_context(events=[
        {"type": "breach", "severity": [1, 2]},
        {"type": "correlation"},
    ])
    assert should_notify(ctx, "breach", severity=1) is True
    assert should_notify(ctx, "breach", severity=2) is True
    assert should_notify(ctx, "breach", severity=3) is False
    assert should_notify(ctx, "correlation", severity=3) is True  # no severity filter


def test_should_notify_severity_none_matches_all():
    """When severity is None (not provided), it matches any severity filter."""
    ctx = _make_context(events=[
        {"type": "breach", "severity": [1, 2]},
    ])
    assert should_notify(ctx, "breach", severity=None) is True


def test_should_notify_all_six_defaults():
    """Default event set includes all six lifecycle events."""
    ctx = _make_context(events=None)
    for event_type in ("breach", "correlation", "incident", "remediation", "verification", "resolution"):
        assert should_notify(ctx, event_type) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_notifications_filtering.py -v`

Expected: FAIL — `should_notify` does not exist.

- [ ] **Step 3: Implement `should_notify`**

In `nthlayer-respond/src/nthlayer_respond/notifications.py`, add:

```python
def should_notify(context, event_type: str, severity: int | None = None) -> bool:
    """Check if an event should trigger a notification based on manifest config.

    Resolution:
    - No notifications config in context → allow all events
    - Events list defined → only listed types trigger
    - Severity filter on event entry → only matching severities trigger
    - Severity=None (not provided) → matches any severity filter
    """
    metadata = context.metadata if isinstance(context.metadata, dict) else {}
    service_ctx = metadata.get("service_context", {})
    spec = service_ctx.get("spec", {})
    notifications = spec.get("notifications", {})
    events = notifications.get("events")

    if events is None:
        return True  # no filter = allow all

    for entry in events:
        if entry.get("type") != event_type:
            continue
        # Type matches — check severity filter
        sev_filter = entry.get("severity")
        if sev_filter is None or severity is None:
            return True  # no severity filter or no severity provided
        return severity in sev_filter

    return False  # event type not in list
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_notifications_filtering.py -v`

Expected: All 5 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/notifications.py tests/test_notifications_filtering.py
git commit -m "feat: add should_notify event filter for manifest notifications config"
```

---

### Task 2: Update `resolve_slack_channel` for `notifications.slack.channel_id`

**Files:**
- Modify: `nthlayer-respond/src/nthlayer_respond/notifications.py`
- Modify: `nthlayer-respond/tests/test_notifications.py`

- [ ] **Step 1: Write failing test for new resolution order**

Add to `nthlayer-respond/tests/test_notifications.py`:

```python
def test_resolve_slack_channel_from_notifications_section():
    """resolve_slack_channel reads from spec.notifications.slack.channel_id first."""
    from nthlayer_respond.notifications import resolve_slack_channel

    context = MagicMock()
    context.metadata = {
        "service_context": {
            "spec": {
                "notifications": {
                    "slack": {"channel_id": "C-FROM-NOTIFICATIONS"},
                },
                "ownership": {"slack_channel": "C-FROM-OWNERSHIP"},
            }
        }
    }
    assert resolve_slack_channel(context) == "C-FROM-NOTIFICATIONS"


def test_resolve_slack_channel_falls_back_to_ownership():
    """resolve_slack_channel falls back to ownership.slack_channel when no notifications section."""
    from nthlayer_respond.notifications import resolve_slack_channel

    context = MagicMock()
    context.metadata = {
        "service_context": {
            "spec": {
                "ownership": {"slack_channel": "C-FROM-OWNERSHIP"},
            }
        }
    }
    assert resolve_slack_channel(context) == "C-FROM-OWNERSHIP"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_notifications.py::test_resolve_slack_channel_from_notifications_section -v`

Expected: FAIL — returns `C-FROM-OWNERSHIP` instead of `C-FROM-NOTIFICATIONS`.

- [ ] **Step 3: Update `resolve_slack_channel`**

In `nthlayer-respond/src/nthlayer_respond/notifications.py`, update `resolve_slack_channel`:

```python
def resolve_slack_channel(context, env_fallback: str | None = None) -> str | None:
    """Resolve Slack channel ID from manifest or env var.

    Resolution order:
    1. spec.notifications.slack.channel_id
    2. spec.ownership.slack_channel (backward compat)
    3. SLACK_CHANNEL_ID env var — or env_fallback if provided (empty string
       suppresses env var lookup and returns None)
    4. None (no channel configured)
    """
    service_ctx = context.metadata.get("service_context", {}) if isinstance(context.metadata, dict) else {}
    spec = service_ctx.get("spec", {})

    # 1. notifications.slack.channel_id
    notifications = spec.get("notifications", {})
    slack_config = notifications.get("slack", {})
    channel = slack_config.get("channel_id")
    if channel:
        return channel

    # 2. ownership.slack_channel (backward compat)
    ownership = spec.get("ownership", {})
    channel = ownership.get("slack_channel")
    if channel:
        return channel

    # 3. Env var fallback
    if env_fallback is not None:
        return env_fallback or None
    return os.environ.get("SLACK_CHANNEL_ID") or None
```

- [ ] **Step 4: Run all notification tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_notifications.py -v`

Expected: All pass (existing 7 + 2 new = 9).

- [ ] **Step 5: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/notifications.py tests/test_notifications.py
git commit -m "feat: update resolve_slack_channel to check notifications.slack.channel_id first"
```

---

### Task 3: VerdictMetricsCollector

**Files:**
- Create: `nthlayer-respond/src/nthlayer_respond/metrics.py`
- Create: `nthlayer-respond/tests/test_metrics.py`

- [ ] **Step 1: Write failing tests**

Create `nthlayer-respond/tests/test_metrics.py`:

```python
"""Tests for VerdictMetricsCollector — Prometheus metrics from verdict store."""
from __future__ import annotations

from datetime import datetime, timezone

from nthlayer_learn import MemoryStore, create as verdict_create

from nthlayer_respond.metrics import VerdictMetricsCollector


def _make_verdict(producer_system, subject_type, status="pending"):
    v = verdict_create(
        subject={"type": subject_type, "ref": "test-service", "summary": "test"},
        judgment={"action": "flag", "confidence": 0.9, "reasoning": "test"},
        producer={"system": producer_system},
    )
    return v


def test_empty_store_returns_no_gauges():
    """Empty verdict store produces valid but empty metrics."""
    store = MemoryStore()
    collector = VerdictMetricsCollector(store)
    text = collector.collect()
    assert "nthlayer_verdict" not in text
    assert text.startswith("# ")  # Has HELP/TYPE headers


def test_total_count_gauges():
    """Verdicts in store produce nthlayer_verdicts_total gauges."""
    store = MemoryStore()
    for _ in range(3):
        store.put(_make_verdict("nthlayer-measure", "evaluation"))
    for _ in range(2):
        store.put(_make_verdict("nthlayer-correlate", "correlation"))

    collector = VerdictMetricsCollector(store)
    text = collector.collect()
    assert 'nthlayer_verdicts_total{component="measure",verdict_type="evaluation"} 3' in text
    assert 'nthlayer_verdicts_total{component="correlate",verdict_type="correlation"} 2' in text


def test_accuracy_from_resolved_verdicts():
    """Accuracy gauge computed from resolved vs overridden verdicts."""
    store = MemoryStore()
    # 8 confirmed, 2 overridden = 0.8 accuracy, 0.2 reversal rate
    for i in range(10):
        v = _make_verdict("nthlayer-measure", "evaluation")
        store.put(v)
        if i < 8:
            store.resolve(v.id, "confirmed")
        else:
            store.resolve(v.id, "overridden", override={"by": "human", "reasoning": "wrong"})

    collector = VerdictMetricsCollector(store)
    text = collector.collect()
    # Check accuracy is present (exact value depends on window filtering)
    assert 'nthlayer_verdict_accuracy{component="measure",verdict_type="evaluation"' in text
    assert 'nthlayer_verdict_reversal_rate{component="measure"' in text


def test_component_label_strips_prefix():
    """'nthlayer-measure' becomes 'measure' in component label."""
    store = MemoryStore()
    store.put(_make_verdict("nthlayer-respond", "triage"))
    collector = VerdictMetricsCollector(store)
    text = collector.collect()
    assert 'component="respond"' in text


def test_metrics_text_format():
    """Output is valid Prometheus text exposition."""
    store = MemoryStore()
    store.put(_make_verdict("nthlayer-measure", "evaluation"))
    collector = VerdictMetricsCollector(store)
    text = collector.collect()
    # Must have HELP and TYPE lines
    assert "# HELP nthlayer_verdicts_total" in text
    assert "# TYPE nthlayer_verdicts_total gauge" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_metrics.py -v`

Expected: FAIL — `nthlayer_respond.metrics` does not exist.

- [ ] **Step 3: Implement VerdictMetricsCollector**

Create `nthlayer-respond/src/nthlayer_respond/metrics.py`:

```python
"""Prometheus metrics from the verdict store.

Exposes verdict accuracy, total counts, and reversal rates as gauges.
Plain text exposition format — no prometheus_client dependency.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from nthlayer_learn import VerdictFilter


def _component_label(producer_system: str) -> str:
    """Strip 'nthlayer-' prefix for the component label."""
    if producer_system.startswith("nthlayer-"):
        return producer_system[len("nthlayer-"):]
    return producer_system


class VerdictMetricsCollector:
    """Collect verdict metrics from the store and render as Prometheus text."""

    def __init__(self, verdict_store: Any) -> None:
        self._store = verdict_store

    def collect(self) -> str:
        """Query the verdict store and return Prometheus text exposition."""
        lines: list[str] = []

        # Header comments
        lines.append("# HELP nthlayer_verdicts_total Total number of verdicts by component and type")
        lines.append("# TYPE nthlayer_verdicts_total gauge")
        lines.append("# HELP nthlayer_verdict_accuracy Verdict accuracy (1 - reversal rate) by component")
        lines.append("# TYPE nthlayer_verdict_accuracy gauge")
        lines.append("# HELP nthlayer_verdict_reversal_rate Verdict reversal rate (overridden / total resolved) by component")
        lines.append("# TYPE nthlayer_verdict_reversal_rate gauge")

        # Query all verdicts (no time filter for totals)
        all_verdicts = self._store.query(VerdictFilter(limit=0))

        # Group by (producer_system, subject_type)
        groups: dict[tuple[str, str], list] = {}
        for v in all_verdicts:
            key = (v.producer.system, v.subject.type)
            groups.setdefault(key, []).append(v)

        now = datetime.now(tz=timezone.utc)
        windows = {"7d": timedelta(days=7), "30d": timedelta(days=30)}

        for (producer, subject_type), verdicts in sorted(groups.items()):
            component = _component_label(producer)

            # Total count (no window)
            lines.append(
                f'nthlayer_verdicts_total{{component="{component}",'
                f'verdict_type="{subject_type}"}} {len(verdicts)}'
            )

            # Accuracy and reversal rate per window
            for window_label, delta in windows.items():
                cutoff = now - delta
                windowed = [
                    v for v in verdicts
                    if v.timestamp and v.timestamp >= cutoff
                ]
                if not windowed:
                    continue

                resolved = [
                    v for v in windowed
                    if v.outcome and v.outcome.status in ("confirmed", "overridden", "partial")
                ]
                if not resolved:
                    continue

                overridden = sum(
                    1 for v in resolved if v.outcome.status == "overridden"
                )
                total_resolved = len(resolved)
                accuracy = 1.0 - (overridden / total_resolved)
                reversal = overridden / total_resolved

                lines.append(
                    f'nthlayer_verdict_accuracy{{component="{component}",'
                    f'verdict_type="{subject_type}",window="{window_label}"}} {accuracy:.4f}'
                )
                lines.append(
                    f'nthlayer_verdict_reversal_rate{{component="{component}",'
                    f'verdict_type="{subject_type}",window="{window_label}"}} {reversal:.4f}'
                )

        lines.append("")  # trailing newline
        return "\n".join(lines)
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_metrics.py -v`

Expected: All 5 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/metrics.py tests/test_metrics.py
git commit -m "feat: add VerdictMetricsCollector for Prometheus exposition"
```

---

### Task 4: Wire `/metrics` Route on ApprovalServer

**Files:**
- Modify: `nthlayer-respond/src/nthlayer_respond/server.py`
- Modify: `nthlayer-respond/tests/test_server.py`

- [ ] **Step 1: Write failing test**

Add to `nthlayer-respond/tests/test_server.py`:

```python
def test_metrics_endpoint(client, context_store):
    """GET /metrics returns Prometheus text with HELP headers."""
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert "text/plain" in resp.headers["content-type"]
    assert "# HELP nthlayer_verdicts_total" in resp.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_server.py::test_metrics_endpoint -v`

Expected: FAIL — 404 (no route).

- [ ] **Step 3: Add `/metrics` route to ApprovalServer**

In `nthlayer-respond/src/nthlayer_respond/server.py`:

Add import at top:
```python
from nthlayer_respond.metrics import VerdictMetricsCollector
```

In `__init__`, add after `self._timeouts`:
```python
        self._metrics = VerdictMetricsCollector(verdict_store) if verdict_store else None
```

Update `__init__` signature to accept `verdict_store`:
```python
    def __init__(
        self,
        coordinator: Any,
        context_store: Any,
        config: RespondConfig,
        verdict_store: Any = None,
    ) -> None:
```

Add route in `build_app()`:
```python
            Route("/metrics", self.handle_metrics, methods=["GET"]),
```

Add handler:
```python
    async def handle_metrics(self, request: Request) -> Response:
        """GET /metrics — Prometheus text exposition."""
        if self._metrics is None:
            return Response(content="", media_type="text/plain")
        text = self._metrics.collect()
        return Response(
            content=text,
            media_type="text/plain; version=0.0.4; charset=utf-8",
        )
```

- [ ] **Step 4: Update `_serve_command` in cli.py to pass verdict_store**

In `nthlayer-respond/src/nthlayer_respond/cli.py`, in `_serve_command`, the coordinator is built via `_make_coordinator` which creates a `SQLiteVerdictStore`. Extract it and pass to ApprovalServer:

```python
    coordinator, ctx_store = _make_coordinator(config)
    verdict_store = SQLiteVerdictStore(config.verdict_store_path)

    from nthlayer_respond.server import ApprovalServer

    server = ApprovalServer(coordinator, ctx_store, config, verdict_store=verdict_store)
```

- [ ] **Step 5: Update test fixtures to pass verdict_store**

In `tests/test_server.py`, update the `server` fixture:

```python
@pytest.fixture
def server(mock_coordinator, context_store, config):
    from nthlayer_learn import MemoryStore
    verdict_store = MemoryStore()
    return ApprovalServer(mock_coordinator, context_store, config, verdict_store=verdict_store)
```

And similarly for `server_with_slack`:

```python
@pytest.fixture
def server_with_slack(mock_coordinator, context_store, config_with_slack):
    from nthlayer_learn import MemoryStore
    verdict_store = MemoryStore()
    return ApprovalServer(mock_coordinator, context_store, config_with_slack, verdict_store=verdict_store)
```

- [ ] **Step 6: Run all server tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_server.py -v`

Expected: All pass (existing + 1 new metrics test).

- [ ] **Step 7: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/server.py src/nthlayer_respond/cli.py tests/test_server.py
git commit -m "feat: wire /metrics route on ApprovalServer"
```

---

### Task 5: Prometheus Scrape Config

**Files:**
- Modify: `test/prometheus.yml`

- [ ] **Step 1: Add nthlayer-respond scrape job**

In `/Users/robfox/Documents/GitHub/nthlayer-ecosystem/test/prometheus.yml`, add a new scrape job after the existing `fake-services` job:

```yaml
  - job_name: nthlayer-respond
    static_configs:
      - targets: ["host.docker.internal:8090"]
```

- [ ] **Step 2: Verify YAML is valid**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem && python3 -c "import yaml; yaml.safe_load(open('test/prometheus.yml')); print('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add ../test/prometheus.yml
git commit -m "chore: add nthlayer-respond scrape job to Prometheus config"
```

---

### Task 6: Grafana Dashboard Provisioning + Dashboard JSON

**Files:**
- Create: `test/grafana/dashboards.yml`
- Create: `test/grafana/dashboards/nthlayer-verdict-accuracy.json`
- Modify: `test/docker-compose.yml`

- [ ] **Step 1: Create dashboard provisioning config**

Create `test/grafana/dashboards.yml`:

```yaml
apiVersion: 1
providers:
  - name: nthlayer
    type: file
    options:
      path: /etc/grafana/provisioning/dashboards
      foldersFromFilesStructure: false
```

- [ ] **Step 2: Create dashboard JSON**

Create `test/grafana/dashboards/nthlayer-verdict-accuracy.json`:

```json
{
  "dashboard": {
    "id": null,
    "uid": "nthlayer-verdict-accuracy",
    "title": "NthLayer Verdict Accuracy",
    "tags": ["nthlayer"],
    "timezone": "utc",
    "refresh": "30s",
    "time": {"from": "now-7d", "to": "now"},
    "panels": [
      {
        "id": 1,
        "title": "Verdict Accuracy (7d window)",
        "type": "timeseries",
        "gridPos": {"h": 10, "w": 24, "x": 0, "y": 0},
        "datasource": {"type": "prometheus", "uid": "prometheus"},
        "targets": [
          {
            "expr": "nthlayer_verdict_accuracy{window=\"7d\"}",
            "legendFormat": "{{component}} — {{verdict_type}}"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "min": 0,
            "max": 1,
            "thresholds": {
              "mode": "absolute",
              "steps": [
                {"color": "red", "value": null},
                {"color": "yellow", "value": 0.8},
                {"color": "green", "value": 0.9}
              ]
            },
            "unit": "percentunit"
          }
        },
        "options": {
          "tooltip": {"mode": "multi"}
        }
      },
      {
        "id": 10,
        "title": "Reversal Rate",
        "type": "row",
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": 10},
        "collapsed": true,
        "panels": [
          {
            "id": 2,
            "title": "Verdict Reversal Rate (7d window)",
            "type": "timeseries",
            "gridPos": {"h": 10, "w": 24, "x": 0, "y": 11},
            "datasource": {"type": "prometheus", "uid": "prometheus"},
            "targets": [
              {
                "expr": "nthlayer_verdict_reversal_rate{window=\"7d\"}",
                "legendFormat": "{{component}} — {{verdict_type}}"
              }
            ],
            "fieldConfig": {
              "defaults": {
                "min": 0,
                "max": 0.2,
                "thresholds": {
                  "mode": "absolute",
                  "steps": [
                    {"color": "green", "value": null},
                    {"color": "yellow", "value": 0.05},
                    {"color": "red", "value": 0.10}
                  ]
                },
                "unit": "percentunit"
              }
            },
            "options": {
              "tooltip": {"mode": "multi"}
            }
          }
        ]
      }
    ],
    "schemaVersion": 39,
    "version": 1
  }
}
```

- [ ] **Step 3: Mount dashboards in docker-compose.yml**

In `test/docker-compose.yml`, add volumes to the grafana service:

```yaml
    volumes:
      - ./grafana/datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro
      - ./grafana/dashboards.yml:/etc/grafana/provisioning/dashboards/dashboards.yml:ro
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
```

(The first volume already exists; add the second and third.)

- [ ] **Step 4: Verify docker-compose YAML is valid**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/test && docker compose config --quiet 2>&1 && echo "OK" || echo "FAIL"`

Expected: `OK` (or just no error output)

- [ ] **Step 5: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add ../test/grafana/dashboards.yml ../test/grafana/dashboards/nthlayer-verdict-accuracy.json ../test/docker-compose.yml
git commit -m "feat: add Grafana verdict accuracy dashboard with provisioning"
```

---

### Task 7: Update OpenSRM Manifest Examples

**Files:**
- Modify: `opensrm/examples/api-full.yaml`

- [ ] **Step 1: Add `notifications` section to the full API example**

In `/Users/robfox/Documents/GitHub/nthlayer-ecosystem/opensrm/examples/api-full.yaml`, add a `notifications` section under `spec` (after `ownership`):

```yaml
  notifications:
    slack:
      channel_id: C0123PAYMENTS
      channel: "#payments-oncall"
    events:
      - type: breach
        severity: [1, 2]
      - type: correlation
      - type: incident
      - type: remediation
      - type: verification
      - type: resolution
```

- [ ] **Step 2: Verify YAML is valid**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem && python3 -c "import yaml; yaml.safe_load(open('opensrm/examples/api-full.yaml')); print('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/opensrm
git add examples/api-full.yaml
git commit -m "docs: add notifications section to api-full.yaml example"
```

---

### Task 8: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run nthlayer-respond full test suite**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/ -v`

Expected: All pass.

- [ ] **Step 2: Verify metrics endpoint**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev python -c "
from nthlayer_learn import MemoryStore, create as verdict_create
from nthlayer_respond.metrics import VerdictMetricsCollector
store = MemoryStore()
for i in range(5):
    v = verdict_create(
        subject={'type': 'evaluation', 'ref': 'fraud-detect', 'summary': 'test'},
        judgment={'action': 'flag', 'confidence': 0.9, 'reasoning': 'test'},
        producer={'system': 'nthlayer-measure'},
    )
    store.put(v)
    if i < 4:
        store.resolve(v.id, 'confirmed')
    else:
        store.resolve(v.id, 'overridden', override={'by': 'human', 'reasoning': 'wrong'})
collector = VerdictMetricsCollector(store)
print(collector.collect())
"`

Expected: Prometheus text with `nthlayer_verdicts_total`, `nthlayer_verdict_accuracy`, and `nthlayer_verdict_reversal_rate` gauges.

- [ ] **Step 3: Verify event filtering**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev python -c "
from unittest.mock import MagicMock
from nthlayer_respond.notifications import should_notify
ctx = MagicMock()
ctx.metadata = {'service_context': {'spec': {'notifications': {'events': [{'type': 'breach', 'severity': [1]}]}}}}
print('breach sev 1:', should_notify(ctx, 'breach', severity=1))
print('breach sev 3:', should_notify(ctx, 'breach', severity=3))
print('correlation:', should_notify(ctx, 'correlation'))
"`

Expected: `True`, `False`, `False`

- [ ] **Step 4: Verify existing replay still works**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev nthlayer-respond replay --scenario scenarios/synthetic/cascading-failure.yaml --no-model`

Expected: `final_state: resolved`

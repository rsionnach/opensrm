# Approval Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HTTP API and Slack interactive buttons for incident approval, replacing CLI-only approve/reject.

**Architecture:** Starlette ASGI server embedded in `nthlayer-respond serve`. Coordinator gains identity params (`approved_by`/`rejected_by`). SlackWebClient in nthlayer-common for Web API (buttons, message updates). Background asyncio tasks for approval timeouts.

**Tech Stack:** starlette, uvicorn, httpx (existing), Slack Web API (chat.postMessage, chat.update)

---

### Task 1: Add `approved_by`/`rejected_by` to Coordinator

**Files:**
- Modify: `nthlayer-respond/src/nthlayer_respond/coordinator.py`
- Modify: `nthlayer-respond/tests/test_coordinator.py`

- [ ] **Step 1: Write failing test for `approve()` with `approved_by`**

In `nthlayer-respond/tests/test_coordinator.py`, add after the existing `test_approve_executes_safe_action`:

```python
async def test_approve_records_approved_by(
    make_coordinator, context_store, verdict_store, triggered_context
):
    """approve(approved_by=...) stores identity in verdict metadata."""

    async def remediation_needs_approval(ctx):
        ctx.remediation = RemediationResult(
            proposed_action="rollback",
            target="payment-api",
            requires_human_approval=True,
            reasoning="needs approval",
        )
        ctx.verdict_chain.append("vrd-remediation")
        return ctx

    approval_agent = make_mock_agent(
        AgentRole.REMEDIATION, side_effect=remediation_needs_approval
    )
    mock_registry = AsyncMock()
    mock_registry.execute = AsyncMock(
        return_value={"success": True, "detail": "rolled back"}
    )
    approval_agent._registry = mock_registry

    coord = make_coordinator({AgentRole.REMEDIATION: approval_agent})
    await coord.run(triggered_context)

    result = await coord.approve("INC-2026-0001", approved_by="rob@nthlayer.com")
    assert result.state == IncidentState.RESOLVED

    # The last verdict in the chain should have approved_by in metadata
    last_verdict_id = result.verdict_chain[-1]
    verdict = verdict_store.get(last_verdict_id)
    custom = getattr(verdict.metadata, "custom", {}) or {}
    assert custom.get("approved_by") == "rob@nthlayer.com"
    assert "rob@nthlayer.com" in verdict.judgment.reasoning
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_coordinator.py::test_approve_records_approved_by -v`

Expected: FAIL — `approve()` doesn't accept `approved_by` parameter.

- [ ] **Step 3: Write failing test for `reject()` with `rejected_by`**

```python
async def test_reject_records_rejected_by(
    make_coordinator, context_store, verdict_store, triggered_context
):
    """reject(rejected_by=...) stores identity in verdict metadata."""
    v = verdict_create(
        subject={"type": "remediation", "ref": "INC-2026-0001", "summary": "rollback"},
        judgment={"action": "approve", "confidence": 0.8, "reasoning": "rollback recommended"},
        producer={"system": "nthlayer-respond"},
    )
    verdict_store.put(v)

    async def remediation_needs_approval(ctx):
        ctx.remediation = RemediationResult(
            proposed_action="rollback",
            target="payment-api",
            requires_human_approval=True,
            reasoning="needs approval",
        )
        ctx.verdict_chain.append(v.id)
        return ctx

    approval_agent = make_mock_agent(
        AgentRole.REMEDIATION, side_effect=remediation_needs_approval
    )
    coord = make_coordinator({AgentRole.REMEDIATION: approval_agent})
    await coord.run(triggered_context)

    result = await coord.reject(
        "INC-2026-0001", "Wrong service", rejected_by="rob@nthlayer.com"
    )
    assert result.state == IncidentState.ESCALATED

    resolved = verdict_store.get(v.id)
    assert "rob@nthlayer.com" in resolved.outcome.override.get("reasoning", "")
```

- [ ] **Step 4: Implement `approved_by` on `approve()`**

In `nthlayer-respond/src/nthlayer_respond/coordinator.py`, change the `approve` method signature and verdict creation:

```python
async def approve(self, incident_id: str, approved_by: str | None = None) -> IncidentContext:
```

In the verdict creation inside `approve()`, update `judgment.reasoning` and add `metadata`:

```python
            who = approved_by or "human"
            v = verdict_create(
                subject={
                    "type": "remediation",
                    "ref": context.id,
                    "summary": f"approved: {action} on {target}",
                },
                judgment={
                    "action": "approve",
                    "confidence": 1.0,
                    "reasoning": f"{who} approved {action} on {target}",
                },
                producer={"system": "nthlayer-respond", "instance": "coordinator"},
                metadata={"custom": {"approved_by": approved_by}} if approved_by else None,
            )
```

Apply the same pattern to the failure branch verdict in `approve()`:

```python
            v = verdict_create(
                subject={
                    "type": "remediation",
                    "ref": context.id,
                    "summary": f"approval failed: {action} on {target}",
                },
                judgment={
                    "action": "escalate",
                    "confidence": 0.0,
                    "reasoning": f"Approved action failed: {exc}",
                },
                producer={"system": "nthlayer-respond", "instance": "coordinator"},
                metadata={"custom": {"approved_by": approved_by}} if approved_by else None,
            )
```

- [ ] **Step 5: Implement `rejected_by` on `reject()`**

Change signature:

```python
async def reject(self, incident_id: str, reason: str, rejected_by: str | None = None) -> IncidentContext:
```

Update the `verdict_store.resolve()` call's `override` dict:

```python
                who = rejected_by or "human"
                self._verdict_store.resolve(
                    last_verdict_id,
                    "overridden",
                    override={
                        "by": who,
                        "reasoning": (
                            f"{who} rejected {proposed_action} of {target}: {reason}"
                        ),
                    },
                )
```

- [ ] **Step 6: Run all coordinator tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_coordinator.py -v`

Expected: All pass, including the two new tests. Existing tests unaffected (parameters default to `None`).

- [ ] **Step 7: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/coordinator.py tests/test_coordinator.py
git commit -m "feat: add approved_by/rejected_by identity to coordinator approve/reject"
```

---

### Task 2: Add Config Fields for Server, Approval Timeout, and Slack

**Files:**
- Modify: `nthlayer-respond/src/nthlayer_respond/config.py`
- Modify: `nthlayer-respond/tests/test_config.py`

- [ ] **Step 1: Write failing test for new config fields**

In `nthlayer-respond/tests/test_config.py`, add:

```python
def test_server_config_defaults():
    """RespondConfig has server/approval/slack defaults."""
    config = RespondConfig()
    assert config.server_host == "0.0.0.0"
    assert config.server_port == 8090
    assert config.approval_timeout_seconds == 900
    assert config.slack_signing_secret == ""
    assert config.slack_bot_token == ""


def test_load_config_server_section(tmp_path):
    """load_config reads server, approval, and slack sections."""
    cfg_path = tmp_path / "respond.yaml"
    cfg_path.write_text("""
server:
  host: "127.0.0.1"
  port: 9090
approval:
  timeout_seconds: 600
slack:
  signing_secret: "test-secret"
  bot_token: "xoxb-test-token"
""")
    config = load_config(str(cfg_path))
    assert config.server_host == "127.0.0.1"
    assert config.server_port == 9090
    assert config.approval_timeout_seconds == 600
    assert config.slack_signing_secret == "test-secret"
    assert config.slack_bot_token == "xoxb-test-token"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_config.py::test_server_config_defaults tests/test_config.py::test_load_config_server_section -v`

Expected: FAIL — `RespondConfig` has no `server_host` attribute.

- [ ] **Step 3: Add fields to RespondConfig and load_config**

In `nthlayer-respond/src/nthlayer_respond/config.py`, add to `RespondConfig`:

```python
    # Server
    server_host: str = "0.0.0.0"
    server_port: int = 8090
    # Approval
    approval_timeout_seconds: int = 900
    # Slack (interactive buttons)
    slack_signing_secret: str = ""
    slack_bot_token: str = ""
```

In `load_config()`, add parsing after the existing sections:

```python
    server = data.get("server", {})
    approval = data.get("approval", {})
    slack = data.get("slack", {})
```

And add to the `return RespondConfig(...)` call:

```python
        server_host=server.get("host", "0.0.0.0"),
        server_port=int(server.get("port", 8090)),
        approval_timeout_seconds=int(approval.get("timeout_seconds", 900)),
        slack_signing_secret=slack.get("signing_secret", ""),
        slack_bot_token=slack.get("bot_token", ""),
```

- [ ] **Step 4: Run all config tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_config.py -v`

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/config.py tests/test_config.py
git commit -m "feat: add server, approval, and slack config fields"
```

---

### Task 3: SlackWebClient in nthlayer-common

**Files:**
- Create: `nthlayer-common/src/nthlayer_common/slack_web.py`
- Create: `nthlayer-common/tests/test_slack_web.py`
- Modify: `nthlayer-common/src/nthlayer_common/__init__.py`

- [ ] **Step 1: Write failing tests for SlackWebClient**

Create `nthlayer-common/tests/test_slack_web.py`:

```python
"""Tests for SlackWebClient — Slack Web API for interactive messages."""
from __future__ import annotations

import hashlib
import hmac
import time
from unittest.mock import AsyncMock, patch

import pytest

from nthlayer_common.slack_web import SlackWebClient


@pytest.fixture
def client():
    return SlackWebClient("xoxb-test-token")


async def test_post_message_returns_ts(client):
    """post_message sends to Slack Web API and returns ts."""
    mock_response = AsyncMock()
    mock_response.json.return_value = {"ok": True, "ts": "1234567890.123456"}
    mock_response.raise_for_status = AsyncMock()

    with patch("nthlayer_common.slack_web.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_client

        ts = await client.post_message(
            channel="C12345",
            blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": "test"}}],
            text="test",
        )
        assert ts == "1234567890.123456"
        mock_client.post.assert_called_once()
        call_kwargs = mock_client.post.call_args
        assert "chat.postMessage" in call_kwargs[0][0]


async def test_post_message_with_thread_ts(client):
    """post_message includes thread_ts when provided."""
    mock_response = AsyncMock()
    mock_response.json.return_value = {"ok": True, "ts": "111.222"}
    mock_response.raise_for_status = AsyncMock()

    with patch("nthlayer_common.slack_web.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_client

        await client.post_message(
            channel="C12345",
            blocks=[],
            text="reply",
            thread_ts="999.888",
        )
        call_kwargs = mock_client.post.call_args
        payload = call_kwargs[1]["json"]
        assert payload["thread_ts"] == "999.888"


async def test_post_message_fail_open(client):
    """post_message returns None on error, never raises."""
    with patch("nthlayer_common.slack_web.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=Exception("network error"))
        mock_client_cls.return_value = mock_client

        ts = await client.post_message("C12345", [], "test")
        assert ts is None


async def test_update_message(client):
    """update_message calls chat.update."""
    mock_response = AsyncMock()
    mock_response.json.return_value = {"ok": True}
    mock_response.raise_for_status = AsyncMock()

    with patch("nthlayer_common.slack_web.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_client

        await client.update_message(
            channel="C12345",
            ts="1234567890.123456",
            blocks=[],
            text="updated",
        )
        call_kwargs = mock_client.post.call_args
        assert "chat.update" in call_kwargs[0][0]
        payload = call_kwargs[1]["json"]
        assert payload["ts"] == "1234567890.123456"


def test_verify_signature_valid():
    """verify_signature returns True for valid HMAC."""
    secret = "test-signing-secret"
    timestamp = str(int(time.time()))
    body = b'{"type":"block_actions"}'
    sig_basestring = f"v0:{timestamp}:{body.decode()}"
    expected = "v0=" + hmac.new(
        secret.encode(), sig_basestring.encode(), hashlib.sha256
    ).hexdigest()

    assert SlackWebClient.verify_signature(secret, timestamp, body, expected) is True


def test_verify_signature_invalid():
    """verify_signature returns False for tampered signature."""
    assert SlackWebClient.verify_signature(
        "secret", "12345", b"body", "v0=bad"
    ) is False


def test_verify_signature_stale_timestamp():
    """verify_signature returns False for timestamp older than 5 minutes."""
    secret = "secret"
    stale_ts = str(int(time.time()) - 600)
    body = b"body"
    sig_basestring = f"v0:{stale_ts}:{body.decode()}"
    sig = "v0=" + hmac.new(
        secret.encode(), sig_basestring.encode(), hashlib.sha256
    ).hexdigest()

    assert SlackWebClient.verify_signature(secret, stale_ts, body, sig) is False


async def test_empty_token_returns_none():
    """SlackWebClient with empty token returns None immediately."""
    client = SlackWebClient("")
    ts = await client.post_message("C12345", [], "test")
    assert ts is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-common && uv run --extra dev pytest tests/test_slack_web.py -v`

Expected: FAIL — `nthlayer_common.slack_web` does not exist.

- [ ] **Step 3: Implement SlackWebClient**

Create `nthlayer-common/src/nthlayer_common/slack_web.py`:

```python
"""Slack Web API client for interactive messages (buttons, message updates).

Complements SlackNotifier (incoming webhooks) with Web API features:
- chat.postMessage: send messages with interactive buttons
- chat.update: replace buttons after action taken
- Signature verification: validate Slack interaction callbacks

Fail-open: errors log warnings and return None, never raise.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

SLACK_API_BASE = "https://slack.com/api"


class SlackWebClient:
    """Slack Web API client for interactive messages."""

    def __init__(self, bot_token: str) -> None:
        self.bot_token = bot_token

    async def post_message(
        self,
        channel: str,
        blocks: list[dict[str, Any]],
        text: str,
        thread_ts: str | None = None,
    ) -> str | None:
        """Post via chat.postMessage. Returns message ts, or None on failure."""
        if not self.bot_token:
            return None

        payload: dict[str, Any] = {
            "channel": channel,
            "blocks": blocks,
            "text": text,
        }
        if thread_ts:
            payload["thread_ts"] = thread_ts

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{SLACK_API_BASE}/chat.postMessage",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.bot_token}",
                        "Content-Type": "application/json",
                    },
                    timeout=10.0,
                )
                resp.raise_for_status()
                data = resp.json()
                if not data.get("ok"):
                    logger.warning("Slack API error: %s", data.get("error"))
                    return None
                return data.get("ts")
        except Exception as exc:
            logger.warning("Slack post_message failed: %s", exc)
            return None

    async def update_message(
        self,
        channel: str,
        ts: str,
        blocks: list[dict[str, Any]],
        text: str,
    ) -> None:
        """Update a message via chat.update (e.g. remove buttons after action)."""
        if not self.bot_token:
            return

        payload: dict[str, Any] = {
            "channel": channel,
            "ts": ts,
            "blocks": blocks,
            "text": text,
        }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{SLACK_API_BASE}/chat.update",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.bot_token}",
                        "Content-Type": "application/json",
                    },
                    timeout=10.0,
                )
                resp.raise_for_status()
                data = resp.json()
                if not data.get("ok"):
                    logger.warning("Slack chat.update error: %s", data.get("error"))
        except Exception as exc:
            logger.warning("Slack update_message failed: %s", exc)

    @staticmethod
    def verify_signature(
        signing_secret: str, timestamp: str, body: bytes, signature: str
    ) -> bool:
        """Verify Slack request signature (HMAC-SHA256).

        Returns False if signature is invalid or timestamp is stale (>5 min).
        """
        # Reject stale timestamps (replay protection)
        try:
            ts = int(timestamp)
        except (ValueError, TypeError):
            return False
        if abs(time.time() - ts) > 300:
            return False

        sig_basestring = f"v0:{timestamp}:{body.decode()}"
        expected = "v0=" + hmac.new(
            signing_secret.encode(), sig_basestring.encode(), hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(expected, signature)
```

- [ ] **Step 4: Add re-export in `__init__.py`**

In `nthlayer-common/src/nthlayer_common/__init__.py`, add:

```python
from nthlayer_common.slack_web import SlackWebClient
```

And add `"SlackWebClient"` to the `__all__` list.

- [ ] **Step 5: Run all nthlayer-common tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-common && uv run --extra dev pytest tests/ -v`

Expected: All pass, including the 8 new slack_web tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-common
git add src/nthlayer_common/slack_web.py src/nthlayer_common/__init__.py tests/test_slack_web.py
git commit -m "feat: add SlackWebClient for interactive messages (buttons, updates)"
```

---

### Task 4: Add `build_approval_blocks` to notifications

**Files:**
- Modify: `nthlayer-respond/src/nthlayer_respond/notifications.py`
- Create: `nthlayer-respond/tests/test_notifications.py`

- [ ] **Step 1: Write failing tests for `build_approval_blocks`**

Create `nthlayer-respond/tests/test_notifications.py`:

```python
"""Tests for Slack block builders."""
from __future__ import annotations

from unittest.mock import MagicMock

from nthlayer_respond.notifications import (
    build_approval_blocks,
    build_remediation_blocks,
)


def _make_verdict(summary="rollback on fraud-detect", confidence=0.85, verdict_id="vrd-123"):
    v = MagicMock()
    v.id = verdict_id
    v.subject.summary = summary
    v.judgment.confidence = confidence
    return v


def test_build_approval_blocks_has_actions():
    """build_approval_blocks includes approve/reject buttons."""
    verdict = _make_verdict()
    blocks, text = build_approval_blocks(verdict, "INC-FRAUD-20260403")

    action_blocks = [b for b in blocks if b.get("type") == "actions"]
    assert len(action_blocks) == 1

    elements = action_blocks[0]["elements"]
    assert len(elements) == 2

    approve_btn = elements[0]
    assert approve_btn["action_id"] == "approve"
    assert approve_btn["value"] == "INC-FRAUD-20260403"
    assert approve_btn["style"] == "primary"

    reject_btn = elements[1]
    assert reject_btn["action_id"] == "reject"
    assert reject_btn["value"] == "INC-FRAUD-20260403"
    assert reject_btn["style"] == "danger"


def test_build_approval_blocks_includes_remediation_info():
    """build_approval_blocks includes the remediation summary."""
    verdict = _make_verdict(summary="rollback on fraud-detect (requires approval)")
    blocks, text = build_approval_blocks(verdict, "INC-FRAUD-20260403")

    section_texts = [
        b["text"]["text"]
        for b in blocks
        if b.get("type") == "section" and "text" in b
    ]
    assert any("rollback on fraud-detect" in t for t in section_texts)


def test_build_approval_blocks_block_id_contains_incident():
    """Actions block_id contains the incident ID for routing."""
    verdict = _make_verdict()
    blocks, _ = build_approval_blocks(verdict, "INC-FRAUD-20260403")

    action_blocks = [b for b in blocks if b.get("type") == "actions"]
    assert action_blocks[0]["block_id"] == "approval_INC-FRAUD-20260403"


def test_build_approval_blocks_fallback_text():
    """Fallback text is descriptive."""
    verdict = _make_verdict()
    _, text = build_approval_blocks(verdict, "INC-FRAUD-20260403")
    assert "APPROVAL REQUIRED" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_notifications.py -v`

Expected: FAIL — `build_approval_blocks` does not exist.

- [ ] **Step 3: Implement `build_approval_blocks`**

In `nthlayer-respond/src/nthlayer_respond/notifications.py`, add after `build_remediation_blocks`:

```python
def build_approval_blocks(verdict, incident_id: str, context=None) -> tuple[list[dict], str]:
    """Build Slack blocks for remediation approval request with interactive buttons."""
    summary = verdict.subject.summary or "Remediation proposed"
    first_sentence = summary.split(".")[0] if summary else "Remediation proposed"
    confidence = verdict.judgment.confidence

    text = f"\u2757 APPROVAL REQUIRED: {first_sentence}"

    blocks = [
        {"type": "section", "text": {"type": "mrkdwn", "text": "*\u2757 APPROVAL REQUIRED*"}},
        {"type": "section", "text": {"type": "mrkdwn", "text": first_sentence}},
        {"type": "context", "elements": [
            {"type": "mrkdwn", "text": f"nthlayer-respond \u00b7 confidence {confidence:.2f} \u00b7 {verdict.id}"},
        ]},
        {
            "type": "actions",
            "block_id": f"approval_{incident_id}",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Approve"},
                    "style": "primary",
                    "action_id": "approve",
                    "value": incident_id,
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Reject"},
                    "style": "danger",
                    "action_id": "reject",
                    "value": incident_id,
                },
            ],
        },
    ]
    return blocks, text
```

- [ ] **Step 4: Run all notification tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_notifications.py -v`

Expected: All 4 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/notifications.py tests/test_notifications.py
git commit -m "feat: add build_approval_blocks with approve/reject buttons"
```

---

### Task 5: Add starlette + uvicorn Dependencies

**Files:**
- Modify: `nthlayer-respond/pyproject.toml`

- [ ] **Step 1: Add dependencies**

In `nthlayer-respond/pyproject.toml`, add to the `dependencies` list:

```toml
    "starlette>=0.40",
    "uvicorn>=0.30",
```

- [ ] **Step 2: Sync dependencies**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv sync --extra dev`

Expected: Installs starlette and uvicorn successfully.

- [ ] **Step 3: Verify import works**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run python -c "from starlette.applications import Starlette; from starlette.responses import JSONResponse; print('OK')"`

Expected: Prints `OK`.

- [ ] **Step 4: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add pyproject.toml uv.lock
git commit -m "chore: add starlette and uvicorn dependencies"
```

---

### Task 6: ApprovalServer — HTTP Routes

**Files:**
- Create: `nthlayer-respond/src/nthlayer_respond/server.py`
- Create: `nthlayer-respond/tests/test_server.py`

- [ ] **Step 1: Write failing tests for HTTP approval routes**

Create `nthlayer-respond/tests/test_server.py`:

```python
"""Tests for ApprovalServer HTTP routes."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from nthlayer_respond.config import RespondConfig
from nthlayer_respond.context_store import SQLiteContextStore
from nthlayer_respond.server import ApprovalServer
from nthlayer_respond.types import (
    IncidentContext,
    IncidentState,
    RemediationResult,
)


@pytest.fixture
def context_store(tmp_path):
    s = SQLiteContextStore(str(tmp_path / "test.db"))
    yield s
    s.close()


@pytest.fixture
def mock_coordinator():
    coord = AsyncMock()
    return coord


@pytest.fixture
def config():
    return RespondConfig(approval_timeout_seconds=900)


@pytest.fixture
def server(mock_coordinator, context_store, config):
    return ApprovalServer(mock_coordinator, context_store, config)


@pytest.fixture
def client(server):
    return TestClient(server.build_app())


def _awaiting_context(incident_id="INC-TEST-001"):
    return IncidentContext(
        id=incident_id,
        state=IncidentState.AWAITING_APPROVAL,
        created_at="2026-04-03T10:00:00Z",
        updated_at="2026-04-03T10:00:00Z",
        trigger_source="nthlayer-correlate",
        trigger_verdict_ids=["vrd-trigger"],
        topology={},
        remediation=RemediationResult(
            proposed_action="rollback",
            target="fraud-detect",
            requires_human_approval=True,
            reasoning="needs approval",
        ),
        verdict_chain=["vrd-triage", "vrd-investigation", "vrd-remediation"],
    )


def test_approve_success(client, mock_coordinator, context_store):
    """POST /api/v1/incidents/{id}/approve calls coordinator.approve."""
    ctx = _awaiting_context()
    context_store.save(ctx)

    resolved_ctx = _awaiting_context()
    resolved_ctx.state = IncidentState.RESOLVED
    resolved_ctx.verdict_chain.append("vrd-approved")
    mock_coordinator.approve = AsyncMock(return_value=resolved_ctx)

    resp = client.post(
        "/api/v1/incidents/INC-TEST-001/approve",
        json={"approved_by": "rob@nthlayer.com"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["state"] == "resolved"
    assert data["approved_by"] == "rob@nthlayer.com"
    mock_coordinator.approve.assert_called_once_with(
        "INC-TEST-001", approved_by="rob@nthlayer.com"
    )


def test_approve_wrong_state(client, mock_coordinator, context_store):
    """POST approve on non-AWAITING_APPROVAL returns 409."""
    ctx = _awaiting_context()
    ctx.state = IncidentState.RESOLVED
    context_store.save(ctx)

    mock_coordinator.approve = AsyncMock(
        side_effect=ValueError("not AWAITING_APPROVAL")
    )

    resp = client.post(
        "/api/v1/incidents/INC-TEST-001/approve",
        json={"approved_by": "rob"},
    )
    assert resp.status_code == 409


def test_approve_not_found(client, mock_coordinator):
    """POST approve on nonexistent incident returns 404."""
    mock_coordinator.approve = AsyncMock(
        side_effect=ValueError("not found")
    )

    resp = client.post(
        "/api/v1/incidents/INC-MISSING/approve",
        json={},
    )
    assert resp.status_code == 404


def test_reject_success(client, mock_coordinator, context_store):
    """POST /api/v1/incidents/{id}/reject calls coordinator.reject."""
    ctx = _awaiting_context()
    context_store.save(ctx)

    escalated_ctx = _awaiting_context()
    escalated_ctx.state = IncidentState.ESCALATED
    mock_coordinator.reject = AsyncMock(return_value=escalated_ctx)

    resp = client.post(
        "/api/v1/incidents/INC-TEST-001/reject",
        json={"reason": "Wrong target", "rejected_by": "rob@nthlayer.com"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["state"] == "escalated"
    mock_coordinator.reject.assert_called_once_with(
        "INC-TEST-001", "Wrong target", rejected_by="rob@nthlayer.com"
    )


def test_reject_missing_reason(client, mock_coordinator, context_store):
    """POST reject without reason returns 400."""
    ctx = _awaiting_context()
    context_store.save(ctx)

    resp = client.post(
        "/api/v1/incidents/INC-TEST-001/reject",
        json={},
    )
    assert resp.status_code == 400


def test_get_incident_status(client, context_store):
    """GET /api/v1/incidents/{id} returns incident state."""
    ctx = _awaiting_context()
    context_store.save(ctx)

    resp = client.get("/api/v1/incidents/INC-TEST-001")
    assert resp.status_code == 200
    data = resp.json()
    assert data["incident_id"] == "INC-TEST-001"
    assert data["state"] == "awaiting_approval"
    assert data["proposed_action"] == "rollback"
    assert data["target"] == "fraud-detect"


def test_get_incident_not_found(client):
    """GET nonexistent incident returns 404."""
    resp = client.get("/api/v1/incidents/INC-MISSING")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_server.py -v`

Expected: FAIL — `nthlayer_respond.server` does not exist.

- [ ] **Step 3: Implement ApprovalServer**

Create `nthlayer-respond/src/nthlayer_respond/server.py`:

```python
"""HTTP server for incident approval workflows.

Starlette ASGI app with routes for approve, reject, status, and
Slack interaction callbacks. Embedded in `nthlayer-respond serve`.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from nthlayer_respond.config import RespondConfig
from nthlayer_respond.types import IncidentState

logger = logging.getLogger(__name__)


class ApprovalServer:
    """HTTP server for incident approval workflows."""

    def __init__(
        self,
        coordinator: Any,
        context_store: Any,
        config: RespondConfig,
    ) -> None:
        self._coordinator = coordinator
        self._context_store = context_store
        self._config = config
        self._timeouts: dict[str, asyncio.Task] = {}

    def build_app(self) -> Starlette:
        """Build the Starlette ASGI application."""
        routes = [
            Route(
                "/api/v1/incidents/{incident_id}/approve",
                self.handle_approve,
                methods=["POST"],
            ),
            Route(
                "/api/v1/incidents/{incident_id}/reject",
                self.handle_reject,
                methods=["POST"],
            ),
            Route(
                "/api/v1/incidents/{incident_id}",
                self.handle_status,
                methods=["GET"],
            ),
            Route(
                "/api/v1/slack/interactions",
                self.handle_slack_interaction,
                methods=["POST"],
            ),
        ]
        return Starlette(routes=routes)

    # ------------------------------------------------------------------ #
    # Route handlers                                                       #
    # ------------------------------------------------------------------ #

    async def handle_approve(self, request: Request) -> JSONResponse:
        """POST /api/v1/incidents/{id}/approve"""
        incident_id = request.path_params["incident_id"]
        body = await request.json() if await request.body() else {}
        approved_by = body.get("approved_by")

        try:
            ctx = await self._coordinator.approve(
                incident_id, approved_by=approved_by
            )
        except ValueError as exc:
            msg = str(exc)
            if "not found" in msg.lower():
                return JSONResponse({"error": msg}, status_code=404)
            return JSONResponse({"error": msg}, status_code=409)

        self.cancel_timeout(incident_id)

        return JSONResponse({
            "incident_id": ctx.id,
            "state": ctx.state.value,
            "action": ctx.remediation.proposed_action if ctx.remediation else None,
            "target": ctx.remediation.target if ctx.remediation else None,
            "approved_by": approved_by,
            "execution_result": ctx.remediation.execution_result if ctx.remediation else None,
            "verdict_id": ctx.verdict_chain[-1] if ctx.verdict_chain else None,
        })

    async def handle_reject(self, request: Request) -> JSONResponse:
        """POST /api/v1/incidents/{id}/reject"""
        incident_id = request.path_params["incident_id"]
        body = await request.json() if await request.body() else {}
        reason = body.get("reason")
        rejected_by = body.get("rejected_by")

        if not reason:
            return JSONResponse(
                {"error": "reason is required"}, status_code=400
            )

        try:
            ctx = await self._coordinator.reject(
                incident_id, reason, rejected_by=rejected_by
            )
        except ValueError as exc:
            msg = str(exc)
            if "not found" in msg.lower():
                return JSONResponse({"error": msg}, status_code=404)
            return JSONResponse({"error": msg}, status_code=409)

        self.cancel_timeout(incident_id)

        return JSONResponse({
            "incident_id": ctx.id,
            "state": ctx.state.value,
            "rejected_by": rejected_by,
            "reason": reason,
        })

    async def handle_status(self, request: Request) -> JSONResponse:
        """GET /api/v1/incidents/{id}"""
        incident_id = request.path_params["incident_id"]
        ctx = self._context_store.load(incident_id)

        if ctx is None:
            return JSONResponse(
                {"error": f"Incident {incident_id!r} not found"}, status_code=404
            )

        result: dict[str, Any] = {
            "incident_id": ctx.id,
            "state": ctx.state.value,
            "created_at": ctx.created_at,
            "updated_at": ctx.updated_at,
            "trigger_source": ctx.trigger_source,
        }
        if ctx.remediation:
            result["proposed_action"] = ctx.remediation.proposed_action
            result["target"] = ctx.remediation.target
            result["requires_human_approval"] = ctx.remediation.requires_human_approval
            result["executed"] = ctx.remediation.executed
        if ctx.triage:
            result["severity"] = ctx.triage.severity
        return JSONResponse(result)

    async def handle_slack_interaction(self, request: Request) -> Response:
        """POST /api/v1/slack/interactions — Slack callback endpoint.

        Placeholder — full implementation in Task 7.
        """
        return Response(status_code=200)

    # ------------------------------------------------------------------ #
    # Timeout management                                                   #
    # ------------------------------------------------------------------ #

    def start_timeout(self, incident_id: str) -> None:
        """Start a background timeout task for an incident."""
        self.cancel_timeout(incident_id)
        task = asyncio.create_task(self._timeout_task(incident_id))
        self._timeouts[incident_id] = task

    def cancel_timeout(self, incident_id: str) -> None:
        """Cancel the timeout task for an incident if active."""
        task = self._timeouts.pop(incident_id, None)
        if task and not task.done():
            task.cancel()

    async def _timeout_task(self, incident_id: str) -> None:
        """Wait for timeout, then auto-reject if still awaiting approval."""
        try:
            await asyncio.sleep(self._config.approval_timeout_seconds)
        except asyncio.CancelledError:
            return

        ctx = self._context_store.load(incident_id)
        if ctx is None or ctx.state != IncidentState.AWAITING_APPROVAL:
            return

        try:
            await self._coordinator.reject(
                incident_id,
                f"Approval timed out after {self._config.approval_timeout_seconds}s",
                rejected_by="system/timeout",
            )
            logger.info("Approval timed out", incident_id=incident_id)
        except Exception as exc:
            logger.warning("Timeout reject failed: %s", exc)
        finally:
            self._timeouts.pop(incident_id, None)

    async def recover_pending_approvals(self) -> None:
        """On startup, scan for AWAITING_APPROVAL incidents and start timeouts.

        Calculates remaining time from context.updated_at.
        """
        import time as _time
        from datetime import datetime, timezone

        active = self._context_store.list_active()
        for incident_id in active:
            ctx = self._context_store.load(incident_id)
            if ctx is None or ctx.state != IncidentState.AWAITING_APPROVAL:
                continue

            try:
                updated = datetime.fromisoformat(ctx.updated_at)
                elapsed = _time.time() - updated.replace(tzinfo=timezone.utc).timestamp()
                remaining = self._config.approval_timeout_seconds - elapsed
            except (ValueError, TypeError):
                remaining = self._config.approval_timeout_seconds

            if remaining <= 0:
                # Already expired — reject immediately
                try:
                    await self._coordinator.reject(
                        incident_id,
                        f"Approval timed out (expired during server downtime)",
                        rejected_by="system/timeout",
                    )
                except Exception as exc:
                    logger.warning("Timeout recovery reject failed: %s", exc)
            else:
                self.cancel_timeout(incident_id)
                task = asyncio.create_task(self._timeout_with_delay(incident_id, remaining))
                self._timeouts[incident_id] = task

    async def _timeout_with_delay(self, incident_id: str, delay: float) -> None:
        """Like _timeout_task but with a custom delay (for recovery)."""
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return

        ctx = self._context_store.load(incident_id)
        if ctx is None or ctx.state != IncidentState.AWAITING_APPROVAL:
            return

        try:
            await self._coordinator.reject(
                incident_id,
                f"Approval timed out after {self._config.approval_timeout_seconds}s",
                rejected_by="system/timeout",
            )
        except Exception as exc:
            logger.warning("Timeout reject failed: %s", exc)
        finally:
            self._timeouts.pop(incident_id, None)
```

- [ ] **Step 4: Run server tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_server.py -v`

Expected: All 8 pass.

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/ -v`

Expected: All existing + new tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/server.py tests/test_server.py
git commit -m "feat: add ApprovalServer with HTTP routes and timeout management"
```

---

### Task 7: Slack Interaction Handler

**Files:**
- Modify: `nthlayer-respond/src/nthlayer_respond/server.py`
- Modify: `nthlayer-respond/tests/test_server.py`

- [ ] **Step 1: Write failing tests for Slack interaction handler**

Add to `nthlayer-respond/tests/test_server.py`:

```python
import hashlib
import hmac
import time
import urllib.parse


def _make_slack_signature(secret: str, body: bytes) -> tuple[str, str]:
    """Generate a valid Slack signature and timestamp."""
    timestamp = str(int(time.time()))
    sig_basestring = f"v0:{timestamp}:{body.decode()}"
    sig = "v0=" + hmac.new(
        secret.encode(), sig_basestring.encode(), hashlib.sha256
    ).hexdigest()
    return timestamp, sig


@pytest.fixture
def config_with_slack():
    return RespondConfig(
        approval_timeout_seconds=900,
        slack_signing_secret="test-signing-secret",
        slack_bot_token="xoxb-test-token",
    )


@pytest.fixture
def server_with_slack(mock_coordinator, context_store, config_with_slack):
    return ApprovalServer(mock_coordinator, context_store, config_with_slack)


@pytest.fixture
def client_with_slack(server_with_slack):
    return TestClient(server_with_slack.build_app())


def test_slack_approve_interaction(
    client_with_slack, mock_coordinator, context_store
):
    """Slack approve button triggers coordinator.approve."""
    ctx = _awaiting_context()
    context_store.save(ctx)

    resolved_ctx = _awaiting_context()
    resolved_ctx.state = IncidentState.RESOLVED
    mock_coordinator.approve = AsyncMock(return_value=resolved_ctx)

    payload = json.dumps({
        "type": "block_actions",
        "user": {"id": "U12345", "name": "rob"},
        "actions": [{"action_id": "approve", "value": "INC-TEST-001"}],
        "channel": {"id": "C12345"},
        "message": {"ts": "1234567890.123456"},
    })
    body = f"payload={urllib.parse.quote(payload)}".encode()
    timestamp, signature = _make_slack_signature("test-signing-secret", body)

    resp = client_with_slack.post(
        "/api/v1/slack/interactions",
        content=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Slack-Request-Timestamp": timestamp,
            "X-Slack-Signature": signature,
        },
    )
    assert resp.status_code == 200
    mock_coordinator.approve.assert_called_once_with(
        "INC-TEST-001", approved_by="rob"
    )


def test_slack_reject_interaction(
    client_with_slack, mock_coordinator, context_store
):
    """Slack reject button triggers coordinator.reject."""
    ctx = _awaiting_context()
    context_store.save(ctx)

    escalated_ctx = _awaiting_context()
    escalated_ctx.state = IncidentState.ESCALATED
    mock_coordinator.reject = AsyncMock(return_value=escalated_ctx)

    payload = json.dumps({
        "type": "block_actions",
        "user": {"id": "U12345", "name": "rob"},
        "actions": [{"action_id": "reject", "value": "INC-TEST-001"}],
        "channel": {"id": "C12345"},
        "message": {"ts": "1234567890.123456"},
    })
    body = f"payload={urllib.parse.quote(payload)}".encode()
    timestamp, signature = _make_slack_signature("test-signing-secret", body)

    resp = client_with_slack.post(
        "/api/v1/slack/interactions",
        content=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Slack-Request-Timestamp": timestamp,
            "X-Slack-Signature": signature,
        },
    )
    assert resp.status_code == 200
    mock_coordinator.reject.assert_called_once_with(
        "INC-TEST-001", "Rejected via Slack by rob", rejected_by="rob"
    )


def test_slack_interaction_invalid_signature(client_with_slack):
    """Invalid Slack signature returns 401."""
    payload = json.dumps({"type": "block_actions", "actions": []})
    body = f"payload={urllib.parse.quote(payload)}".encode()

    resp = client_with_slack.post(
        "/api/v1/slack/interactions",
        content=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Slack-Request-Timestamp": str(int(time.time())),
            "X-Slack-Signature": "v0=invalid",
        },
    )
    assert resp.status_code == 401


def test_slack_interaction_no_signing_secret(client, mock_coordinator):
    """Without signing_secret configured, Slack endpoint returns 404-like or skips verification."""
    payload = json.dumps({
        "type": "block_actions",
        "user": {"name": "rob"},
        "actions": [{"action_id": "approve", "value": "INC-TEST-001"}],
    })
    body = f"payload={urllib.parse.quote(payload)}".encode()

    resp = client.post(
        "/api/v1/slack/interactions",
        content=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    # Without signing secret, Slack interactions are disabled
    assert resp.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_server.py::test_slack_approve_interaction tests/test_server.py::test_slack_interaction_invalid_signature -v`

Expected: FAIL — handler returns 200 without processing.

- [ ] **Step 3: Implement Slack interaction handler**

Replace the placeholder `handle_slack_interaction` in `nthlayer-respond/src/nthlayer_respond/server.py`:

```python
    async def handle_slack_interaction(self, request: Request) -> Response:
        """POST /api/v1/slack/interactions — Slack callback endpoint."""
        signing_secret = self._config.slack_signing_secret
        if not signing_secret:
            return Response(
                content=json.dumps({"error": "Slack signing secret not configured"}),
                status_code=403,
                media_type="application/json",
            )

        body = await request.body()
        timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
        signature = request.headers.get("X-Slack-Signature", "")

        from nthlayer_common.slack_web import SlackWebClient

        if not SlackWebClient.verify_signature(signing_secret, timestamp, body, signature):
            return Response(status_code=401)

        # Slack sends payload as form-encoded
        form = await request.form()
        payload_str = form.get("payload", "")
        try:
            payload = json.loads(payload_str)
        except (json.JSONDecodeError, TypeError):
            return Response(status_code=400)

        actions = payload.get("actions", [])
        if not actions:
            return Response(status_code=200)

        action = actions[0]
        action_id = action.get("action_id")
        incident_id = action.get("value")
        user_name = payload.get("user", {}).get("name", "unknown")
        channel_id = payload.get("channel", {}).get("id")
        message_ts = payload.get("message", {}).get("ts")

        try:
            if action_id == "approve":
                ctx = await self._coordinator.approve(
                    incident_id, approved_by=user_name
                )
            elif action_id == "reject":
                ctx = await self._coordinator.reject(
                    incident_id,
                    f"Rejected via Slack by {user_name}",
                    rejected_by=user_name,
                )
            else:
                return Response(status_code=200)
        except ValueError as exc:
            logger.warning("Slack interaction failed: %s", exc)
            return Response(status_code=200)  # Slack expects 200

        self.cancel_timeout(incident_id)

        # Update original message to remove buttons (fire-and-forget)
        if self._config.slack_bot_token and channel_id and message_ts:
            asyncio.create_task(
                self._update_slack_message(
                    channel_id, message_ts, action_id, user_name, ctx
                )
            )

        return Response(status_code=200)

    async def _update_slack_message(
        self,
        channel_id: str,
        message_ts: str,
        action_id: str,
        user_name: str,
        ctx: Any,
    ) -> None:
        """Replace buttons with confirmation text in the original Slack message."""
        from nthlayer_common.slack_web import SlackWebClient

        client = SlackWebClient(self._config.slack_bot_token)

        if action_id == "approve":
            status_text = f"\u2705 Approved by @{user_name}"
        else:
            status_text = f"\u274c Rejected by @{user_name}"

        blocks = [
            {"type": "section", "text": {"type": "mrkdwn", "text": f"*{status_text}*"}},
            {"type": "context", "elements": [
                {"type": "mrkdwn", "text": f"State: {ctx.state.value} \u00b7 nthlayer-respond"},
            ]},
        ]

        try:
            await client.update_message(channel_id, message_ts, blocks, status_text)
        except Exception as exc:
            logger.warning("Slack message update failed: %s", exc)
```

Note: add `import json` to the imports at the top of `server.py` if not already present (it is from Step 3 of Task 6).

- [ ] **Step 4: Run all server tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_server.py -v`

Expected: All pass (original 8 + 4 new Slack tests = 12).

- [ ] **Step 5: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/server.py tests/test_server.py
git commit -m "feat: add Slack interaction handler with signature verification"
```

---

### Task 8: Wire `serve` Command to ApprovalServer

**Files:**
- Modify: `nthlayer-respond/src/nthlayer_respond/cli.py`

- [ ] **Step 1: Replace `_serve_command` stub**

In `nthlayer-respond/src/nthlayer_respond/cli.py`, replace:

```python
def _serve_command(config_path: str) -> None:
    """Start the polling loop (stub)."""
    print(f"[nthlayer-respond serve] Not yet implemented. Config: {config_path}")
    sys.exit(0)
```

With:

```python
def _serve_command(config_path: str) -> None:
    """Start the approval server."""
    import uvicorn

    config = load_config(config_path)
    coordinator, ctx_store = _make_coordinator(config)

    from nthlayer_respond.server import ApprovalServer

    server = ApprovalServer(coordinator, ctx_store, config)
    app = server.build_app()

    # Recover pending approvals on startup
    @app.on_event("startup")
    async def startup():
        await server.recover_pending_approvals()

    print(f"[nthlayer-respond serve] Starting on {config.server_host}:{config.server_port}")
    uvicorn.run(
        app,
        host=config.server_host,
        port=config.server_port,
        log_level="info",
    )
```

- [ ] **Step 2: Add `--host` and `--port` CLI overrides to `serve` subparser**

In `build_parser()`, update the serve subparser:

```python
    # serve
    serve = sub.add_parser("serve", help="Start approval server")
    serve.add_argument("--config", default="respond.yaml", help="Config file path")
    serve.add_argument("--host", default=None, help="Override server host")
    serve.add_argument("--port", type=int, default=None, help="Override server port")
```

Update `_serve_command` to accept and apply overrides. Change the `main()` serve branch:

```python
    if args.command == "serve":
        _serve_command(args.config, host=args.host, port=args.port)
```

Update `_serve_command` signature:

```python
def _serve_command(config_path: str, host: str | None = None, port: int | None = None) -> None:
    """Start the approval server."""
    import uvicorn

    config = load_config(config_path)
    if host:
        config.server_host = host
    if port:
        config.server_port = port

    coordinator, ctx_store = _make_coordinator(config)

    from nthlayer_respond.server import ApprovalServer

    server = ApprovalServer(coordinator, ctx_store, config)
    app = server.build_app()

    @app.on_event("startup")
    async def startup():
        await server.recover_pending_approvals()

    print(f"[nthlayer-respond serve] Starting on {config.server_host}:{config.server_port}")
    uvicorn.run(
        app,
        host=config.server_host,
        port=config.server_port,
        log_level="info",
    )
```

- [ ] **Step 3: Run existing CLI tests to verify nothing breaks**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_cli.py -v`

Expected: All existing CLI tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/cli.py
git commit -m "feat: wire serve command to ApprovalServer with uvicorn"
```

---

### Task 9: Approval Timeout Tests

**Files:**
- Modify: `nthlayer-respond/tests/test_server.py`

- [ ] **Step 1: Write timeout tests**

Add to `nthlayer-respond/tests/test_server.py`:

```python
async def test_timeout_auto_rejects():
    """Timeout task calls coordinator.reject with system/timeout."""
    mock_coord = AsyncMock()
    escalated_ctx = _awaiting_context()
    escalated_ctx.state = IncidentState.ESCALATED
    mock_coord.reject = AsyncMock(return_value=escalated_ctx)

    store = MagicMock()
    ctx = _awaiting_context()
    store.load.return_value = ctx

    config = RespondConfig(approval_timeout_seconds=0)  # immediate timeout
    server = ApprovalServer(mock_coord, store, config)

    server.start_timeout("INC-TEST-001")
    await asyncio.sleep(0.1)  # Let the task fire

    mock_coord.reject.assert_called_once()
    call_args = mock_coord.reject.call_args
    assert call_args[0][0] == "INC-TEST-001"
    assert "timed out" in call_args[0][1].lower()
    assert call_args[1]["rejected_by"] == "system/timeout"


async def test_cancel_timeout_prevents_reject():
    """Cancelling timeout before it fires prevents rejection."""
    mock_coord = AsyncMock()
    store = MagicMock()
    store.load.return_value = _awaiting_context()

    config = RespondConfig(approval_timeout_seconds=10)
    server = ApprovalServer(mock_coord, store, config)

    server.start_timeout("INC-TEST-001")
    server.cancel_timeout("INC-TEST-001")
    await asyncio.sleep(0.1)

    mock_coord.reject.assert_not_called()


async def test_timeout_skips_already_resolved():
    """Timeout does nothing if incident is no longer AWAITING_APPROVAL."""
    mock_coord = AsyncMock()
    store = MagicMock()

    resolved_ctx = _awaiting_context()
    resolved_ctx.state = IncidentState.RESOLVED
    store.load.return_value = resolved_ctx

    config = RespondConfig(approval_timeout_seconds=0)
    server = ApprovalServer(mock_coord, store, config)

    server.start_timeout("INC-TEST-001")
    await asyncio.sleep(0.1)

    mock_coord.reject.assert_not_called()
```

Add `import asyncio` to the test file imports if not already present.

- [ ] **Step 2: Run timeout tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_server.py::test_timeout_auto_rejects tests/test_server.py::test_cancel_timeout_prevents_reject tests/test_server.py::test_timeout_skips_already_resolved -v`

Expected: All 3 pass.

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/ -v`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add tests/test_server.py
git commit -m "test: add approval timeout tests"
```

---

### Task 10: Integration — Approval Notification Sends Buttons When Appropriate

**Files:**
- Modify: `nthlayer-respond/src/nthlayer_respond/notifications.py`
- Modify: `nthlayer-respond/tests/test_notifications.py`

- [ ] **Step 1: Write test for channel resolution from manifest**

Add to `nthlayer-respond/tests/test_notifications.py`:

```python
def test_resolve_slack_channel_from_context():
    """resolve_slack_channel reads from service context manifest ownership."""
    from nthlayer_respond.notifications import resolve_slack_channel

    context = MagicMock()
    context.metadata = {
        "service_context": {
            "spec": {
                "ownership": {"slack_channel": "C-PAYMENTS"},
            }
        }
    }
    assert resolve_slack_channel(context) == "C-PAYMENTS"


def test_resolve_slack_channel_fallback_to_env(monkeypatch):
    """resolve_slack_channel falls back to SLACK_CHANNEL_ID env var."""
    from nthlayer_respond.notifications import resolve_slack_channel

    monkeypatch.setenv("SLACK_CHANNEL_ID", "C-DEFAULT")
    context = MagicMock()
    context.metadata = {}
    assert resolve_slack_channel(context) == "C-DEFAULT"


def test_resolve_slack_channel_returns_none():
    """resolve_slack_channel returns None when no channel configured."""
    from nthlayer_respond.notifications import resolve_slack_channel

    context = MagicMock()
    context.metadata = {}
    # No env var set
    assert resolve_slack_channel(context, env_fallback="") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_notifications.py::test_resolve_slack_channel_from_context -v`

Expected: FAIL — `resolve_slack_channel` does not exist.

- [ ] **Step 3: Implement `resolve_slack_channel`**

Add to `nthlayer-respond/src/nthlayer_respond/notifications.py`:

```python
def resolve_slack_channel(context, env_fallback: str | None = None) -> str | None:
    """Resolve Slack channel ID from service manifest or env var.

    Resolution order:
    1. Manifest metadata.service_context.spec.ownership.slack_channel
    2. SLACK_CHANNEL_ID env var (or env_fallback if provided)
    3. None (no channel configured)
    """
    # Try manifest ownership
    service_ctx = context.metadata.get("service_context", {}) if isinstance(context.metadata, dict) else {}
    spec = service_ctx.get("spec", {})
    ownership = spec.get("ownership", {})
    channel = ownership.get("slack_channel")
    if channel:
        return channel

    # Fallback to env var
    if env_fallback is not None:
        return env_fallback or None
    return os.environ.get("SLACK_CHANNEL_ID") or None
```

- [ ] **Step 4: Run all notification tests**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/test_notifications.py -v`

Expected: All pass (4 approval blocks tests + 3 channel resolution tests = 7).

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/ -v`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond
git add src/nthlayer_respond/notifications.py tests/test_notifications.py
git commit -m "feat: add resolve_slack_channel with manifest ownership + env fallback"
```

---

### Task 11: Final Verification — Full Test Suites

**Files:** None (verification only)

- [ ] **Step 1: Run nthlayer-common full test suite**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-common && uv run --extra dev pytest tests/ -v`

Expected: All pass.

- [ ] **Step 2: Run nthlayer-respond full test suite**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev pytest tests/ -v`

Expected: All pass.

- [ ] **Step 3: Verify serve command starts (smoke test)**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && timeout 3 uv run --extra dev nthlayer-respond serve --port 18090 2>&1 || true`

Expected: Prints `[nthlayer-respond serve] Starting on 0.0.0.0:18090` and uvicorn startup message before timing out.

- [ ] **Step 4: Verify existing replay still works**

Run: `cd /Users/robfox/Documents/GitHub/nthlayer-ecosystem/nthlayer-respond && uv run --extra dev nthlayer-respond replay --scenario scenarios/synthetic/cascading-failure.yaml --no-model`

Expected: Replay completes with `final_state: resolved`.

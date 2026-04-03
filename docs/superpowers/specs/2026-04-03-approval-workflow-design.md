# Approval Workflow — HTTP API + Slack Interactive Buttons

**Date:** 2026-04-03
**Bead:** opensrm-9sv.4
**Status:** Design approved, ready for implementation plan

## Problem

nthlayer-respond has approval gates — the coordinator pauses at `AWAITING_APPROVAL` when a high-risk safe action needs human sign-off. But the only way to approve or reject is via CLI (`nthlayer-respond approve <id>` / `reject <id> --reason`). There's no API, no interactive Slack flow, and no timeout. An incident that needs approval at 3am sits until someone opens a terminal.

## Design

### HTTP Server in `serve`

`nthlayer-respond serve` becomes a starlette ASGI app on uvicorn. The server holds a single `Coordinator` instance (same construction as `_make_coordinator` today). Four routes:

```
POST /api/v1/incidents/{id}/approve     body: {"approved_by": "rob@nthlayer.com"}
POST /api/v1/incidents/{id}/reject      body: {"reason": "...", "rejected_by": "rob@nthlayer.com"}
GET  /api/v1/incidents/{id}             read-only incident status
POST /api/v1/slack/interactions         Slack callback endpoint
```

Approve/reject routes call `coordinator.approve()` / `coordinator.reject()` directly. Response payload includes the full updated incident state:

```json
{
  "incident_id": "INC-FRAUD-20260403",
  "state": "resolved",
  "action": "rollback",
  "target": "fraud-detect",
  "approved_by": "rob@nthlayer.com",
  "execution_result": "HTTP 200 — rollback initiated",
  "verdict_id": "v-abc123"
}
```

On error (wrong state, incident not found), returns 409/404 with detail.

### Coordinator Signature Change

`approve()` and `reject()` gain optional identity parameters:

```python
async def approve(self, incident_id: str, approved_by: str | None = None) -> IncidentContext:
async def reject(self, incident_id: str, reason: str, rejected_by: str | None = None) -> IncidentContext:
```

Identity is threaded into the emitted verdict's `metadata.custom.approved_by` / `metadata.custom.rejected_by` and into `judgment.reasoning`. Fully backward compatible — defaults to `None`, existing CLI callers unchanged.

### Slack Interactive Buttons

When the coordinator pauses at `AWAITING_APPROVAL`, the remediation notification includes approve/reject buttons — but only when all three conditions are met:

1. `SLACK_BOT_TOKEN` is set (Web API available)
2. `requires_human_approval` is true on the remediation result
3. State is `AWAITING_APPROVAL`

New block builder:

```python
def build_approval_blocks(verdict, incident_id, context=None) -> tuple[list[dict], str]:
```

Produces the same content as `build_remediation_blocks` plus an actions block:

```json
{
  "type": "actions",
  "block_id": "approval_INC-FRAUD-20260403",
  "elements": [
    {"type": "button", "text": {"type": "plain_text", "text": "Approve"},
     "style": "primary", "action_id": "approve", "value": "INC-FRAUD-20260403"},
    {"type": "button", "text": {"type": "plain_text", "text": "Reject"},
     "style": "danger", "action_id": "reject", "value": "INC-FRAUD-20260403"}
  ]
}
```

#### Slack Interaction Handler

`POST /api/v1/slack/interactions` receives Slack's interaction payload when a button is clicked:

1. Verifies request signature using `SLACK_SIGNING_SECRET` (HMAC-SHA256 of timestamp + body)
2. Parses `action_id` (approve/reject) and `value` (incident ID) from the payload
3. Calls `coordinator.approve(id, approved_by=payload.user.name)` or `coordinator.reject(id, reason="Rejected via Slack", rejected_by=payload.user.name)`
4. Updates the original message via `chat.update` — replaces buttons with a context block: "Approved by @rob · 14:32"
5. Posts a threaded follow-up with verification/resolution blocks as appropriate
6. Returns 200 immediately (Slack requires < 3s response)

For reject via Slack, a default reason is used ("Rejected via Slack by {user}"). If richer reject reasons are needed later, a modal dialog can be added — out of scope for this cut.

#### Channel Resolution

Interactive messages require a channel ID. Resolution order:

1. Manifest `metadata.ownership.slack_channel` for the affected service (from `context.metadata.service_context.spec`)
2. `SLACK_CHANNEL_ID` env var (global fallback)
3. Neither set → no interactive message (graceful degradation, notification-only via incoming webhook if configured)

Different services route to different incident channels based on their manifest ownership block.

#### SlackWebClient

New class in `nthlayer-common/slack_web.py`, alongside the existing `SlackNotifier`:

```python
class SlackWebClient:
    """Slack Web API client for interactive messages."""

    def __init__(self, bot_token: str) -> None: ...

    async def post_message(
        self, channel: str, blocks: list[dict], text: str, thread_ts: str | None = None
    ) -> str | None:
        """Post via chat.postMessage. Returns message ts."""

    async def update_message(
        self, channel: str, ts: str, blocks: list[dict], text: str
    ) -> None:
        """Update a message via chat.update (e.g. remove buttons after action)."""

    @staticmethod
    def verify_signature(signing_secret: str, timestamp: str, body: bytes, signature: str) -> bool:
        """Verify Slack request signature (HMAC-SHA256)."""
```

Same fail-open pattern as `SlackNotifier`. The two classes coexist:
- `SlackNotifier` — incoming webhook notifications (when only `SLACK_WEBHOOK_URL` is set)
- `SlackWebClient` — interactive messages with buttons (when `SLACK_BOT_TOKEN` is set)

### Approval Timeout

When the coordinator sets state to `AWAITING_APPROVAL`, the server starts a background `asyncio.Task`:

1. Sleep for `approval.timeout_seconds` (default 900s / 15 min)
2. On wake: check if incident is still `AWAITING_APPROVAL`
3. If still pending: call `coordinator.reject(id, reason="Approval timed out", rejected_by="system/timeout")`
4. Post Slack thread update: "Approval expired after 15m — escalated to human"
5. Remove buttons from original message via `chat.update`

Tracking: `dict[str, asyncio.Task]` on the server, keyed by incident ID. Cleaned up on approve/reject/timeout. On server restart, scan context store for `AWAITING_APPROVAL` incidents and calculate remaining time from `context.updated_at`.

No timeout in CLI mode — timeouts only run when `serve` is active.

**Follow-up: escalation runner wiring.** The current design treats `ESCALATED` as a terminal state with a Slack notification. Future work (depends on on-call infrastructure not yet built): when `rejected_by="system/timeout"`, the escalation runner advances one step in the on-call rotation — next person gets fresh buttons with their own timeout window. Each escalation target gets `approval.timeout_seconds`. If the roster exhausts, then it's a true terminal `ESCALATED` with an `@here` in the channel. This plugs in without changing the timeout logic designed here.

### Config

New fields in `RespondConfig`, loaded from `respond.yaml`:

```yaml
server:
  host: "0.0.0.0"
  port: 8090

approval:
  timeout_seconds: 900

slack:
  signing_secret: "${SLACK_SIGNING_SECRET}"
  bot_token: "${SLACK_BOT_TOKEN}"
```

Env var resolution: `${VAR}` in config values resolved from `os.environ` at load time (same pattern as webhook binding secrets).

Defaults: host `0.0.0.0`, port `8090`, timeout `900`. Slack fields default to empty — no Slack integration unless configured.

## Components

### New Files

**`nthlayer-respond/src/nthlayer_respond/server.py`** — Starlette app, routes, Slack interaction handler, timeout tracker.

```python
class ApprovalServer:
    """HTTP server for incident approval workflows."""

    def __init__(self, coordinator: Coordinator, context_store, config: RespondConfig): ...

    def build_app(self) -> Starlette: ...

    async def handle_approve(self, request: Request) -> JSONResponse: ...
    async def handle_reject(self, request: Request) -> JSONResponse: ...
    async def handle_status(self, request: Request) -> JSONResponse: ...
    async def handle_slack_interaction(self, request: Request) -> Response: ...

    def start_timeout(self, incident_id: str) -> None: ...
    def cancel_timeout(self, incident_id: str) -> None: ...
    async def _timeout_task(self, incident_id: str) -> None: ...
    async def _recover_pending_approvals(self) -> None: ...
```

**`nthlayer-common/src/nthlayer_common/slack_web.py`** — SlackWebClient (Web API: post_message, update_message, verify_signature).

### Modified Files

**`coordinator.py`** — `approve(id, approved_by=None)` and `reject(id, reason, rejected_by=None)` gain optional identity params. Identity stored in verdict `metadata.custom` and `judgment.reasoning`.

**`notifications.py`** — Add `build_approval_blocks(verdict, incident_id)`. Existing builders unchanged.

**`config.py`** — `RespondConfig` gains `server_host`, `server_port`, `approval_timeout_seconds`, `slack_signing_secret`, `slack_bot_token`. `load_config` reads from `server:`, `approval:`, `slack:` sections.

**`cli.py`** — `_serve_command` imports `ApprovalServer`, builds coordinator, launches uvicorn. Replaces the current stub.

**`nthlayer-common/__init__.py`** — Re-export `SlackWebClient`.

**`pyproject.toml` (nthlayer-respond)** — Add `starlette>=0.40`, `uvicorn>=0.30` to dependencies.

### Not Changed

- `safe_actions/` — registry, webhook dispatcher, actions all untouched
- Agent code — no changes to triage/investigation/remediation/communication agents
- Existing `SlackNotifier` — stays as-is for incoming webhook users
- Existing CLI approve/reject commands — still work, no server required

## What Doesn't Change

- Approval ratchet — model can escalate, never downgrade
- Cooldown tracking — checked before every execution
- Blast radius check — pre-handler validation unchanged
- Pipeline sequencing — coordinator gates at step 2, same as today
- Verdict schema — `metadata.custom` extended, no structural changes
- Incoming webhook notifications — `SLACK_WEBHOOK_URL` path unchanged

## Verification

1. **HTTP API:** `curl -X POST localhost:8090/api/v1/incidents/INC-FRAUD/approve -d '{"approved_by":"rob"}'` → 200 with updated state
2. **Slack buttons:** Remediation message in Slack has Approve/Reject buttons; clicking Approve calls the interaction handler; buttons replaced with "Approved by @rob"
3. **Timeout:** Incident sits in `AWAITING_APPROVAL` for 15m → auto-rejects with `rejected_by="system/timeout"` → Slack message "Approval expired"
4. **Graceful degradation:** No `SLACK_BOT_TOKEN` → no buttons, notifications still work via incoming webhook; no Slack at all → API-only approvals; no server (`serve` not running) → CLI approve/reject still work
5. **Backward compatibility:** All existing tests pass; CLI commands unchanged; `replay --no-model` unchanged
6. **Channel routing:** Two services with different `ownership.slack_channel` in manifests → approval messages route to correct channels

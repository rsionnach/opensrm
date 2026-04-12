# Phase 3: Mayday Implementation — Design Spec

**Date:** 2026-03-19
**Status:** Approved
**Depends on:** Phase 2 (SitRep) complete, Phase 1 (Arbiter verdict integration) complete, Phase 0 (verdict library + CLI) complete
**Accept criteria:** `mayday replay --scenario scenarios/synthetic/cascading-failure.yaml` produces expected verdicts with full lineage back to SitRep's correlation verdicts
**Beads epic:** `opensrm-m50` (centralized in opensrm repo; supersedes `mayday-bel` from the archived per-repo beads)

---

## 1. Overview

Mayday is the Response Layer of the OpenSRM ecosystem — a multi-agent incident response system coordinated by a deterministic state machine. It consumes SitRep's correlation verdicts as trigger input and produces triage, investigation, communication, and remediation verdicts linked through lineage.

Naming: the repo, code, CLI, and all internal references use `mayday`. "Response Layer" appears only in user-facing documentation and help text.

### Core Design Principles

- **ZFC (Zero Framework Cognition):** The coordinator and agent base class are transport. `build_prompt()` and `parse_response()` are judgment. Transport is code; judgment is model. No exceptions.
- **Verdict lineage:** Every Mayday verdict links back to SitRep correlation verdicts (via `lineage.context`) and chains to the previous Mayday verdict (via `lineage.parent`). One human override at any point calibrates every component upstream.
- **Approval ratchet:** The model can escalate approval requirements (request human sign-off) but never downgrade them. If a safe action's default is `requires_approval=True`, the model cannot override it to False. Same principle as the Arbiter's autonomy ratchet.
- **Degraded mode:** Model failure produces a low-confidence verdict with `action="escalate"` and `tags=["degraded", "human-takeover-required"]`. Never silence, never guessing.
- **Crash recovery:** `IncidentContext` persisted to SQLite after every pipeline step. Coordinator resumes from `last_completed_step_index`.

---

## 2. Package Structure

```
mayday/
├── pyproject.toml
├── src/mayday/
│   ├── __init__.py               # Minimal — no re-exports
│   ├── types.py                  # IncidentContext, IncidentState, AgentRole, result dataclasses
│   ├── config.py                 # MaydayConfig loaded from mayday.yaml
│   ├── coordinator.py            # Deterministic state machine — pure transport
│   ├── context_store.py          # ContextStore Protocol + SQLite implementation
│   ├── agents/
│   │   ├── base.py               # AgentBase ABC
│   │   ├── triage.py             # TriageAgent
│   │   ├── investigation.py      # InvestigationAgent
│   │   ├── communication.py      # CommunicationAgent
│   │   └── remediation.py        # RemediationAgent
│   ├── safe_actions/
│   │   ├── registry.py           # SafeActionRegistry — closed callable registry
│   │   └── actions.py            # Built-in safe actions
│   ├── cli.py                    # mayday serve | status | replay | approve | reject | resume
│   └── __main__.py               # python -m mayday
├── tests/
│   ├── conftest.py               # Shared fixtures (context_store, verdict_store, sample contexts)
│   ├── test_types.py             # Core type construction and validation
│   ├── test_coordinator.py       # State machine, pipeline sequencing, crash recovery
│   ├── test_context_store.py     # SQLite persistence, load/save/list
│   ├── test_agent_base.py        # Template method, verdict emission, degraded mode, JSON parsing
│   ├── test_triage.py            # Triage prompt, parsing, autonomy reduction trigger
│   ├── test_investigation.py     # Investigation prompt, parsing, root cause threshold
│   ├── test_communication.py     # Communication prompt (both phases), parsing, statefulness
│   ├── test_remediation.py       # Remediation prompt, parsing, safe action validation, post-execute
│   ├── test_safe_actions.py      # Registry, cooldown, blast radius, approval ratchet
│   ├── test_replay.py            # CLI replay command — primary acceptance criterion
│   └── test_cli.py               # serve, status, approve, reject, resume commands
└── scenarios/synthetic/
    ├── cascading-failure.yaml
    ├── sitrep-unavailable.yaml
    ├── model-unavailable.yaml
    ├── human-override.yaml
    ├── low-confidence-escalation.yaml
    ├── remediation-approval.yaml
    ├── autonomy-reduction.yaml
    └── crash-recovery.yaml
```

Dependencies (pyproject.toml):
- `pyyaml>=6.0.1` — config and scenario parsing
- `structlog>=24.1` — structured logging
- `anthropic>=0.39` — LLM API client
- `verdict` — path-based: `verdict @ file:///../nthlayer-learn/lib/python`

SitRep is NOT a package dependency. Mayday imports SitRep's replay logic optionally (`try/except ImportError`) for sitrep-triggered scenarios only. Components communicate through the shared verdict store, not package imports.

---

## 3. Core Types (`types.py`)

### Enums

```python
class IncidentState(str, Enum):
    TRIGGERED = "triggered"
    TRIAGING = "triaging"
    INVESTIGATING = "investigating"
    REMEDIATING = "remediating"
    AWAITING_APPROVAL = "awaiting_approval"
    RESOLVED = "resolved"
    ESCALATED = "escalated"
    FAILED = "failed"

class AgentRole(str, Enum):
    TRIAGE = "triage"
    INVESTIGATION = "investigation"
    COMMUNICATION = "communication"
    REMEDIATION = "remediation"
```

Terminal states: `RESOLVED`, `ESCALATED`, `FAILED`.

### Result Dataclasses

Each agent writes to its own typed result section on `IncidentContext`.

```python
@dataclass
class TriageResult:
    severity: int                    # 0-4 (P0-P4)
    blast_radius: list[str]          # affected service names
    affected_slos: list[str]         # SLO names breached
    assigned_team: str | None
    reasoning: str

@dataclass
class Hypothesis:
    description: str
    confidence: float                # 0.0-1.0
    evidence: list[str]
    change_candidate: str | None     # ref to SitRep ChangeCandidate

@dataclass
class InvestigationResult:
    hypotheses: list[Hypothesis]
    root_cause: str | None           # set only when confidence > root_cause_threshold
    root_cause_confidence: float
    reasoning: str

@dataclass
class CommunicationUpdate:
    channel: str
    timestamp: str                   # ISO 8601
    update_type: str                 # "initial" or "resolution"
    content: str

@dataclass
class CommunicationResult:
    updates_sent: list[CommunicationUpdate] = field(default_factory=list)
    reasoning: str = ""

@dataclass
class RemediationResult:
    proposed_action: str | None      # safe action name from registry
    target: str | None               # service or resource
    risk_assessment: str = ""
    requires_human_approval: bool = True
    executed: bool = False
    execution_result: str | None = None
    autonomy_reduced: bool = False
    autonomy_target: str | None = None
    previous_autonomy_level: str | None = None
    new_autonomy_level: str | None = None
    reasoning: str = ""
```

### IncidentContext

```python
@dataclass
class IncidentContext:
    id: str                          # INC-YYYY-NNNN format
    state: IncidentState
    created_at: str                  # ISO 8601
    updated_at: str
    trigger_source: str              # "sitrep", "pagerduty", "manual"
    trigger_verdict_ids: list[str]   # SitRep verdict IDs (empty if no SitRep)
    topology: dict                   # from SitRep or OpenSRM manifests
    triage: TriageResult | None = None
    investigation: InvestigationResult | None = None
    communication: CommunicationResult | None = None
    remediation: RemediationResult | None = None
    verdict_chain: list[str] = field(default_factory=list)
    last_completed_step_index: int | None = None  # pipeline step index (0-3)
    error: str | None = None                       # for FAILED incidents
    metadata: dict = field(default_factory=dict)
```

`trigger_source` tells the triage agent what level of pre-correlated context to expect. `trigger_verdict_ids` is empty when triggered by raw PagerDuty webhook (degraded path). `verdict_chain` is the ordered list of Mayday verdict IDs — each new verdict's `lineage.context` includes the SitRep trigger IDs, and `lineage.parent` points to the previous Mayday verdict in the chain.

`last_completed_step_index` is a pipeline step index (0-3), not an `AgentRole`. This resolves two ambiguities: (1) parallel steps — the index is set after the entire `asyncio.gather` completes, not after each individual agent, so a crash mid-parallel-step causes both agents to re-run; (2) `COMMUNICATION` appears at step index 1 (parallel with investigation) and step index 3 (resolution update) — the index disambiguates which occurrence completed.

`error` stores the error message when the coordinator transitions to FAILED. The context store extracts this into a separate SQLite column for queryability without deserialising the full JSON blob.

---

## 4. Agent Base Class (`agents/base.py`)

ABC with template method pattern. Transport methods on the base, judgment methods abstract on subclasses.

### ZFC Boundary (Method Level)

| Method | Type | Location |
|--------|------|----------|
| `_call_model()` | Transport | Base class |
| `_emit_verdict()` | Transport | Base class |
| `_degraded_verdict()` | Transport | Base class |
| `_request_autonomy_reduction()` | Transport | Base class |
| `_parse_json()` | Transport | Base class |
| `_apply_result()` | Transport | Subclass (abstract) — mechanical field assignment, not judgment |
| `build_prompt()` | Judgment | Subclass (abstract) |
| `parse_response()` | Judgment | Subclass (abstract) |

### Interface

```python
class AgentBase(ABC):
    role: AgentRole  # class attribute, set by each subclass

    def __init__(
        self,
        model: str,
        max_tokens: int,
        verdict_store: VerdictStore,
        config: dict,
        timeout: int | None = None,  # per-agent, overrides default_timeout
    ):
        self._model = model
        self._max_tokens = max_tokens
        self._verdict_store = verdict_store
        self._config = config
        self._timeout = timeout or self.default_timeout
        self._client = None  # lazy Anthropic init

    default_timeout: int = 30  # overridden per subclass

    # --- Transport (base class) ---

    async def _call_model(self, system_prompt: str, user_prompt: str) -> str:
        """Call Anthropic API via asyncio.to_thread with per-agent timeout.
        Returns response text. Raises on failure."""

    def _emit_verdict(
        self,
        context: IncidentContext,
        subject_summary: str,
        action: str,
        confidence: float,
        reasoning: str,
        tags: list[str] | None = None,
        dimensions: dict[str, float] | None = None,
    ) -> Verdict:
        """Create verdict with correct lineage and persist to store.

        Lineage wiring:
        - lineage.context = context.trigger_verdict_ids
        - lineage.parent = context.verdict_chain[-1] if non-empty, else None

        Subject:
        - type = self.role.value
        - service = primary affected service from context
        - ref = context.id (incident ID)

        Producer:
        - system = "mayday"
        - model = self._model

        Side effects:
        - verdict_store.put(verdict)
        - context.verdict_chain.append(verdict.id)
        """

    def _degraded_verdict(self, context: IncidentContext, reason: str) -> Verdict:
        """Emit confidence=0.0 verdict for human takeover.
        action="escalate", tags=["degraded", "human-takeover-required"].
        Note: does NOT set last_completed_step_index — that is the coordinator's
        responsibility after the full pipeline step completes (including parallel agents)."""

    async def _request_autonomy_reduction(
        self,
        agent_name: str,
        arbiter_url: str,
        reason: str,
    ) -> dict:
        """HTTP POST to Arbiter governance API. Transport operation.
        Fire-and-forget with 3 retries on failure.
        Returns response dict."""

    def _parse_json(self, response: str) -> dict:
        """Parse model JSON response. Handles common failure modes:
        - Markdown fence wrapping (```json ... ```)
        - Preamble text before JSON
        - Invalid JSON (raises ValueError with context)
        Same pattern as SitRep's ModelInterface._parse_response()."""

    # --- Judgment (subclasses implement) ---

    @abstractmethod
    def build_prompt(self, context: IncidentContext) -> tuple[str, str]:
        """Return (system_prompt, user_prompt). Judgment — each agent's unique contribution."""

    @abstractmethod
    def parse_response(self, response: str, context: IncidentContext):
        """Parse model response into typed result dataclass. Judgment."""

    @abstractmethod
    def _apply_result(self, context: IncidentContext, result) -> IncidentContext:
        """Apply parsed result to context. Sets the agent's result field.
        Can also use setattr(context, self.role.value, result) if field names
        match role values exactly."""

    # --- Template method ---

    async def _post_execute(self, context: IncidentContext, result) -> IncidentContext:
        """Override point for post-judgment transport actions. Default: no-op.
        Remediation overrides this for safe action execution and autonomy reduction.
        Triage overrides this for autonomy reduction on agent-caused incidents."""
        return context

    async def execute(self, context: IncidentContext) -> IncidentContext:
        """Template method — standard workflow for all agents.

        1. build_prompt(context)                    # judgment
        2. _call_model(system, user)                # transport
        3. parse_response(response, context)        # judgment
        4. _apply_result(context, result)           # transport (field assignment)
        5. _emit_verdict(context, ...)              # transport
        6. _post_execute(context, result)           # transport (hook)
        7. return context

        Note: last_completed_step_index is set by the COORDINATOR after the
        full pipeline step completes, not by the agent. This ensures parallel
        steps (investigation + communication) are checkpointed atomically.

        On model failure:
        1. _degraded_verdict(context, reason)       # transport
        2. return context unchanged (except verdict_chain updated by _degraded_verdict)
        """
```

---

## 5. Individual Agents

### 5.1 Triage Agent (`agents/triage.py`)

```python
class TriageAgent(AgentBase):
    role = AgentRole.TRIAGE
    default_timeout = 15  # fast — blocking the pipeline
```

**`build_prompt()`:** System prompt includes the agent's constraints and judgment SLO target (<10% severity reversal rate). User prompt built from:
- SitRep correlation verdicts (queried from verdict_store via `trigger_verdict_ids`): confidence, affected services, change candidates, reasoning
- Topology from context
- `trigger_source` adjusts the prompt: `"sitrep"` → "You have pre-correlated context"; `"pagerduty"/"manual"` → "No pre-correlation available. Raw alert only."

**`parse_response()`:** Parses JSON into `TriageResult`. Expected model output:
```json
{
    "severity": 1,
    "blast_radius": ["payment-api", "checkout-service"],
    "affected_slos": ["availability", "latency_p99"],
    "assigned_team": "payments-oncall",
    "reasoning": "..."
}
```
Validates: severity 0-4, blast_radius non-empty.

**`_post_execute()`:** Checks for autonomy reduction trigger. Condition: if any `change_candidate` in the SitRep correlation verdicts is of type `agent_model_update` (not a config change, not a dependency failure) AND `triage_severity <= 2` (P0, P1, or P2), then call `_request_autonomy_reduction()` for the agent named in the change candidate. This is explicitly documented because it's a triage-specific transport action — the judgment to call it is deterministic based on structured fields, not model interpretation.

### 5.2 Investigation Agent (`agents/investigation.py`)

```python
class InvestigationAgent(AgentBase):
    role = AgentRole.INVESTIGATION
    default_timeout = 60  # deeper reasoning
```

**`build_prompt()`:** System prompt includes constraints (MUST NOT execute remediation) and judgment SLO target (70% post-incident agreement). Crucially includes the `root_cause_threshold` from config: "Only declare root_cause if your confidence exceeds 0.7. Otherwise leave it null and list hypotheses." This keeps judgment in one place — the model calibrates its confidence against a known threshold, rather than the parser overriding the model's decision.

User prompt built from: `context.triage` (severity, blast radius, affected SLOs), SitRep correlation verdicts (change candidates are key — the model evaluates whether temporal proximity implies causality), and topology.

**`parse_response()`:** Parses JSON into `InvestigationResult`. Expected model output:
```json
{
    "hypotheses": [
        {
            "description": "payment-api deploy v2.3.1 removed connection pooling",
            "confidence": 0.87,
            "evidence": ["latency spike 12m after deploy", "connection pool metric dropped to 0"],
            "change_candidate": "payment-api deploy v2.3.1"
        }
    ],
    "root_cause": "payment-api deploy v2.3.1 removed connection pooling",
    "root_cause_confidence": 0.87,
    "reasoning": "..."
}
```
If model sets `root_cause` but `root_cause_confidence < root_cause_threshold`, parser clears `root_cause` to `None`. This is the only case where the parser overrides the model — and it's a mechanical threshold check, not a judgment call.

**No `_post_execute()` override.** Investigation produces hypotheses and optionally declares root cause. No side effects beyond the verdict.

### 5.3 Communication Agent (`agents/communication.py`)

```python
class CommunicationAgent(AgentBase):
    role = AgentRole.COMMUNICATION
    default_timeout = 20
```

**`build_prompt()`:** System prompt includes constraints (MUST NOT contradict investigation findings, MUST NOT communicate resolution until remediation is confirmed) and judgment SLO (<15% human edit rate).

User prompt varies by phase — determined by reading context:
- **Phase 1** (parallel with investigation, `context.remediation is None`): "Draft an initial status update. We know: [triage summary]. Investigation is ongoing."
- **Phase 2** (post-remediation, `context.remediation is not None`): "Draft a resolution update. Root cause: [investigation]. Remediation: [remediation]. Outcome: [execution_result]."

**`parse_response()`:** Parses JSON into `CommunicationResult`. Expected model output:
```json
{
    "updates": [
        {"channel": "slack", "update_type": "initial", "content": "..."}
    ],
    "reasoning": "..."
}
```
Converts each update dict to a `CommunicationUpdate` dataclass with timestamp set to now.

**Statefulness between runs:** The second run reads `context.communication.updates_sent` to see what was previously sent and builds on it (appends, not replaces). If the first run degraded (model failed), `updates_sent` is an empty list (default) — the second run still works, drafting a resolution update with no prior context.

### 5.4 Remediation Agent (`agents/remediation.py`)

```python
class RemediationAgent(AgentBase):
    role = AgentRole.REMEDIATION
    default_timeout = 30

    def __init__(self, *args, safe_action_registry: SafeActionRegistry, **kwargs):
        super().__init__(*args, **kwargs)
        self._registry = safe_action_registry
```

**`build_prompt()`:** System prompt includes constraints (ONLY actions from the safe action registry, MUST assess blast radius) and judgment SLO (80% fix success rate). Includes the list of available safe actions with names and descriptions (from `registry.list_actions()`).

User prompt built from: `context.investigation` (root cause, hypotheses, confidence), `context.triage` (severity, blast radius), available safe actions, and topology.

**`parse_response()`:** Parses JSON into `RemediationResult`. Expected model output:
```json
{
    "proposed_action": "rollback",
    "target": "payment-api",
    "risk_assessment": "Low risk — rolling back to known-good v2.3.0",
    "requires_human_approval": true,
    "autonomy_reduction": {
        "recommended": true,
        "target_agent": "deployment-bot",
        "reason": "agent caused the incident"
    },
    "reasoning": "..."
}
```

**Validation:** If `proposed_action` is not in the registry, set to `None`, force `requires_human_approval=True`, and log a warning metric (hallucinated action name — calibration signal for the remediation agent's judgment SLO).

**Approval ratchet enforcement:** If the safe action's default `requires_approval` is `True`, the model's `requires_human_approval=False` is ignored. The model can only escalate, never downgrade.

**`_post_execute()`:** Post-judgment transport in strict order:

1. **Safe action execution** (if `not requires_human_approval` and `proposed_action is not None`):
   - Call `registry.execute(proposed_action, target, context)`
   - Update `result.executed`, `result.execution_result`
   - If execution fails, update `result.execution_result` with error

2. **Autonomy reduction** (if recommended in model response):
   - Call `_request_autonomy_reduction(target_agent, arbiter_url, reason)`
   - Update `result.autonomy_reduced`, `result.autonomy_target`, etc.
   - Urgency is informed by step 1: if safe action failed, autonomy reduction is more critical (logged in verdict tags)

If `requires_human_approval` is True, `_post_execute()` does NOT execute the safe action. The coordinator detects this and transitions to `AWAITING_APPROVAL`.

---

## 6. Safe Action Registry (`safe_actions/`)

### Registry (`registry.py`)

```python
@dataclass
class SafeAction:
    name: str
    description: str              # included in remediation agent's prompt
    target_type: str              # "service", "agent", "feature_flag", "arbiter"
    requires_approval: bool       # default policy — model can escalate, never downgrade
    cooldown_seconds: int         # minimum between executions on same target
    blast_radius_check: Callable[[str, dict], bool] | None = None
    handler: Callable  # async (target, context, **kwargs) -> dict

class SafeActionRegistry:
    def __init__(self, cooldown_store_path: str | None = None):
        self._actions: dict[str, SafeAction] = {}
        # Cooldown tracking persists across restarts via SQLite
        # (in-memory list would reset on crash, allowing re-execution within cooldown)
        self._cooldown_db: str | None = cooldown_store_path

    def register(self, action: SafeAction) -> None: ...
    def get(self, name: str) -> SafeAction: ...  # KeyError if not registered
    def list_actions(self) -> list[dict]: ...     # name + description for prompts

    async def execute(self, name: str, target: str, context: IncidentContext) -> dict:
        """1. Validate name (KeyError if not registered)
        2. Check cooldown (CooldownError if too recent on same target)
        3. Run blast_radius_check if defined (BlastRadiusError if fails)
        4. Call action.handler(target, context)
        5. Log execution (persisted for cooldown tracking)
        Returns: {"success": bool, "detail": str, "timestamp": str}"""

    def check_cooldown(self, name: str, target: str) -> bool: ...
```

Cooldown tracking uses a SQLite table (or the context store DB) to persist execution history across restarts. This prevents a crash-recovered coordinator from re-executing an action within its cooldown window.

### Built-in Actions (`actions.py`)

All actions are Tier 1 stubs — they log intent and return simulated success. The registry pattern and coordinator contract are the value; real infrastructure calls (kubectl, ArgoCD, LaunchDarkly APIs) come in Tier 2.

| Action | target_type | requires_approval | Description |
|--------|-------------|-------------------|-------------|
| `rollback` | service | True | Rollback to previous version |
| `scale_up` | service | False | Increase replica count |
| `disable_feature_flag` | feature_flag | True | Disable a feature flag |
| `reduce_autonomy` | arbiter | False | Request Arbiter to reduce agent autonomy |
| `pause_pipeline` | service | True | Pause CI/CD pipeline |

`reduce_autonomy` is unique: it targets the Arbiter (not infrastructure), takes `arbiter_url` in kwargs, and leverages the Arbiter's one-way safety ratchet (can only tighten; restoration requires separate human action). `requires_approval=False` because the autonomy ratchet is itself a safety mechanism — reducing autonomy is always safe.

---

## 7. Coordinator (`coordinator.py`)

Deterministic state machine. Pure transport.

### State Machine

```
TRIGGERED → TRIAGING → INVESTIGATING → REMEDIATING → RESOLVED
                                            ↓
                                    AWAITING_APPROVAL
                                      ↓           ↓
                                  RESOLVED     ESCALATED

Any state → ESCALATED (low confidence / human takeover)
Any state → FAILED (unrecoverable error)
```

### Pipeline Sequencing

```python
PIPELINE = [
    [AgentRole.TRIAGE],                              # serial
    [AgentRole.INVESTIGATION, AgentRole.COMMUNICATION],  # parallel
    [AgentRole.REMEDIATION],                          # serial
    [AgentRole.COMMUNICATION],                        # serial (resolution update)
]
```

`_next_step()` returns `list[AgentRole]`. Length 1 = serial, length 2+ = parallel via `asyncio.gather(..., return_exceptions=True)`.

### Interface

```python
class Coordinator:
    def __init__(
        self,
        agents: dict[AgentRole, AgentBase],
        context_store: ContextStore,
        verdict_store: VerdictStore,
        config: MaydayConfig,
    ): ...

    async def run(self, context: IncidentContext) -> IncidentContext:
        """Execute full pipeline from current state.

        Crash recovery: if context.last_completed_step_index is set,
        resume from step index + 1. For parallel steps, a crash mid-step
        causes the entire parallel group to re-run (both agents).

        After each pipeline step:
        1. context.last_completed_step_index = step_index
        2. context_store.save(context)  — crash recovery checkpoint
        3. _check_escalation()          — any verdict action=escalate
                                          with confidence < threshold
        4. Check approval gate          — remediation.requires_human_approval
                                          → AWAITING_APPROVAL, return

        Guard on second communication run (step 3): skip if state is
        ESCALATED or FAILED.
        """

    async def resume(self, incident_id: str) -> IncidentContext:
        """Load context from store, call run()."""

    async def approve(self, incident_id: str) -> IncidentContext:
        """Human approves pending remediation.
        1. Load context (must be AWAITING_APPROVAL)
        2. Execute safe action via registry
        3. On success: emit confirmation verdict, transition to RESOLVED
        4. On failure: emit failure verdict, transition to ESCALATED
        """

    async def reject(self, incident_id: str, reason: str) -> IncidentContext:
        """Human rejects pending remediation.
        1. Load context (must be AWAITING_APPROVAL)
        2. Resolve the remediation verdict via verdict_store.resolve(
               remediation_verdict_id, "overridden",
               override={"by": "human", "reasoning":
                   "Human rejected {proposed_action} of {target}: {reason}"})
           This resolves the EXISTING verdict — does NOT create a new one.
           The override includes the original proposed action for calibration:
           remediation agent accuracy = proposed actions humans accepted.
        3. Transition to ESCALATED
        """
```

### Parallel Step Failure Isolation

Investigation and communication run via `asyncio.gather(..., return_exceptions=True)`. Each result is handled independently:
- **Communication fails:** annoying but not blocking. Coordinator continues to remediation. Communication gets a degraded verdict.
- **Investigation fails:** critical. Coordinator emits degraded verdict and checks escalation threshold. If investigation degraded, the pipeline likely escalates (no root cause means remediation can't proceed meaningfully).

### Escalation Check

Transport operation — reads structured verdict fields, doesn't interpret them:
```python
def _check_escalation(self, context: IncidentContext) -> bool:
    """True if any verdict in the chain has action="escalate"
    and confidence < escalation_threshold (config, default 0.3)."""
```

---

## 8. Context Store (`context_store.py`)

Protocol-based, matching SitRep's store pattern.

```python
class ContextStore(Protocol):
    def save(self, context: IncidentContext) -> None: ...
    def load(self, incident_id: str) -> IncidentContext | None: ...
    def list_active(self) -> list[str]: ...
    def list_all(self, limit: int = 50) -> list[IncidentContext]: ...
    def get_metadata(self, key: str) -> str | None: ...
    def set_metadata(self, key: str, value: str) -> None: ...
```

### SQLite Implementation

```python
class SQLiteContextStore:
    """Schema:
        incidents(
            id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            error TEXT,              -- nullable, for FAILED incidents
            data TEXT NOT NULL,      -- full JSON blob
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    Indexes: (state), (updated_at DESC)
    WAL mode, busy_timeout=5000.

    Additional table for serve polling state:
        metadata(
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    Used for last_poll_timestamp and other coordinator state.
    """
```

Full serialisation on every `save()`. `IncidentContext` is small (< 10KB) — no need for incremental updates at Tier 1. `list_active()` returns incident IDs where state is not in terminal states (`RESOLVED`, `ESCALATED`, `FAILED`). The `error` column stores the error message for FAILED incidents — queryable without deserialising the full JSON blob, used by `mayday status`.

---

## 9. CLI (`cli.py`)

Entry point: `mayday` (pyproject.toml `[project.scripts]`) or `python -m mayday`. Argparse, matching SitRep pattern.

### Commands

**`mayday serve [--config mayday.yaml]`**
Start the full pipeline. Poll `verdict_store` for new SitRep correlation verdicts at `poll_interval_seconds`.

Trigger dedup: the coordinator persists a `last_poll_timestamp` in the context store (metadata table). Each poll cycle queries `VerdictFilter(producer_system="sitrep", subject_type="correlation", from_time=last_poll_timestamp)`. After processing, `last_poll_timestamp` is updated to the latest verdict's timestamp. On first startup (no persisted timestamp), look back `poll_interval_seconds * 2` to catch recent verdicts without reprocessing history.

Action filtering: `VerdictFilter` does not support filtering by `judgment.action`. Mayday queries all SitRep correlation verdicts in the window, then filters in Python for `action in ("escalate", "flag")`. Verdicts with `action="defer"` are skipped.

Incident dedup: before creating a new `IncidentContext`, check `context_store.list_active()` for existing incidents with overlapping `trigger_verdict_ids` or affecting the same services. If an active incident already covers the same correlation, skip. Full incident dedup (merging overlapping incidents) is a Tier 2 concern.

Handle SIGINT/SIGTERM for graceful shutdown.

**`mayday status [--config mayday.yaml]`**
Show active incidents, their states, last action taken, and error messages for failed incidents. Reads from `context_store.list_active()` and `list_all()`.

**`mayday replay --scenario <path> [--config mayday.yaml] [--no-model]`**
Primary acceptance criterion. Steps:
1. Load scenario YAML
2. Based on `trigger.source`:
   - `"sitrep"`: import SitRep's replay logic (optional dependency: `try/except ImportError` with clear message "SitRep must be installed for sitrep-triggered scenarios: `pip install -e ../sitrep`"), run correlation pipeline, capture verdicts
   - `"pagerduty"/"manual"`: load pre-built verdicts or raw alert from scenario
3. Create `IncidentContext` from trigger
4. Run coordinator with real model or mock responses (`--no-model` reads `mock_responses` from scenario YAML)
5. For scenarios with `interactions` (approve/reject events): inject at specified timestamps
6. Print full incident timeline + verdict chain with lineage

**`mayday approve <incident-id> [--config mayday.yaml]`**
Approve pending remediation for an `AWAITING_APPROVAL` incident.

**`mayday reject <incident-id> --reason <reason> [--config mayday.yaml]`**
Reject pending remediation. Reason is required.

**`mayday resume <incident-id> [--config mayday.yaml]`**
Resume a crashed incident from last checkpoint.

---

## 10. Scenario Fixtures

### Schema

```yaml
scenario:
  id: string
  description: string
  trigger:
    source: "sitrep" | "pagerduty" | "manual"
    sitrep_scenario: "path/to/sitrep/scenario.yaml"  # for source: sitrep
    verdicts: [...]                                     # for pre-built verdicts
    alert: {service, severity, description}             # for raw alert

  mock_responses:
    triage: { ... }
    investigation: { ... }
    communication_initial: { ... }
    communication_resolution: { ... }
    remediation: { ... }

  interactions:
    - at: "after:triage"                # after triage completes
    - at: "after:investigation"         # after investigation completes
    - at: "after:remediation_proposed"  # after model proposes, BEFORE execution
    - at: "after:remediation"           # after execution completes
      action: "approve" | "reject"
      reason: "..."                     # required for reject

  expected_outcomes:
    final_state: "resolved" | "escalated" | "awaiting_approval"
    verdict_count: int
    root_cause: string | null
    remediation_executed: bool
    autonomy_reduced: bool
```

The `at` field uses `"after:<step>"` syntax. `"after:remediation_proposed"` is distinct from `"after:remediation"` — the former fires after the remediation agent runs but before safe action execution (the AWAITING_APPROVAL pause point); the latter fires after execution completes.

### Eight Scenarios

| Scenario | Trigger | Tests | Expected State |
|----------|---------|-------|----------------|
| `cascading-failure.yaml` | sitrep | End-to-end integration, full verdict lineage back to SitRep | resolved |
| `sitrep-unavailable.yaml` | pagerduty | Degraded path — raw alert, no pre-correlation, triage with minimal context | resolved |
| `model-unavailable.yaml` | sitrep | All agents degrade — `_degraded_verdict()` across every agent, escalate to human | escalated |
| `human-override.yaml` | sitrep + interaction | On-call rejects triage severity via interaction, override verdict emitted | escalated |
| `low-confidence-escalation.yaml` | sitrep | Investigation returns low confidence, coordinator escalates | escalated |
| `remediation-approval.yaml` | sitrep + interaction | Safe action proposed → AWAITING_APPROVAL → human approves → RESOLVED | resolved |
| `autonomy-reduction.yaml` | sitrep | Agent model update caused incident, remediation requests Arbiter downgrade | resolved |
| `crash-recovery.yaml` | sitrep | Coordinator state persisted after triage, "restarts", resumes from investigation | resolved |

---

## 11. Configuration (`mayday.yaml`)

```yaml
coordinator:
  poll_interval_seconds: 30
  escalation_threshold: 0.3

agents:
  model: claude-sonnet-4-20250514
  triage:
    timeout: 15
  investigation:
    timeout: 60
    root_cause_threshold: 0.7
  communication:
    timeout: 20
  remediation:
    timeout: 30

safe_actions:
  cooldown_seconds: 300
  arbiter_url: http://localhost:8080

verdict:
  store:
    backend: sqlite
    path: verdicts.db

context_store:
  backend: sqlite
  path: mayday-incidents.db

topology:
  manifests_dir: null
```

**Shared verdict store is required, not optional.** `verdicts.db` must be the same file used by SitRep and Arbiter. This is how lineage works — all components write to one store. If components use separate stores, verdict chains break. Document this explicitly in README and config comments.

---

## 12. SitRep Verdict Consumption

Mayday consumes SitRep's actual implemented verdict format (source of truth: `sitrep/src/sitrep/snapshot/model.py`).

### What SitRep Produces

Per-correlation child verdicts:
```python
subject={"type": "correlation", "service": "payment-api", "ref": "cg-xxx", "summary": "..."}
judgment={"action": "flag|escalate|defer", "confidence": 0.0-1.0, "reasoning": "...", "tags": [...]}
producer={"system": "sitrep", "model": "claude-sonnet-4-20250514"}
```

Parent snapshot verdict:
```python
subject={"type": "correlation", "service": None, "ref": "snapshot", "summary": "Snapshot: N group(s)..."}
lineage.children = [child_verdict_ids]
```

### What Mayday Reads

Mayday queries the shared verdict store:
```python
verdicts = verdict_store.query(VerdictFilter(
    producer_system="sitrep",
    subject_type="correlation",
    from_time=<lookback window>,
))
```

From each verdict, Mayday extracts:
- `subject.service` — affected service
- `subject.ref` — correlation group ID
- `subject.summary` — template-generated description
- `judgment.action` — flag/escalate/defer (determines whether to trigger)
- `judgment.confidence` — 0.0-1.0
- `judgment.reasoning` — model's causal assessment
- `judgment.tags` — change candidates, state transitions
- `lineage.children` — parent links to per-correlation children

No translation layer. Mayday reads verdict fields directly.

Note: `VerdictFilter` does not support filtering by `judgment.action` or `judgment.tags`. Action-based filtering (e.g., only trigger on `"escalate"` or `"flag"`, skip `"defer"`) is done in Python after the verdict store query.

---

## 13. Verdict Output

Each Mayday agent emits one verdict per execution via `_emit_verdict()`.

| Agent | subject.type | Typical action | Links to |
|-------|-------------|----------------|----------|
| Triage | `"triage"` | `"flag"` or `"escalate"` | SitRep correlation verdicts (context) |
| Investigation | `"investigation"` | `"flag"` or `"defer"` | Triage verdict (parent) + SitRep (context) |
| Communication | `"communication"` | `"approve"` | Investigation verdict (parent) + SitRep (context) |
| Remediation | `"remediation"` | `"approve"` or `"escalate"` | Communication verdict (parent) + SitRep (context) |

Verdict chain example for `cascading-failure.yaml`:
```
SitRep correlation verdict (cg-xxx, payment-api deploy)
  └── Mayday triage verdict (P1, blast: payment-api + checkout-service)
        └── Mayday investigation verdict (root cause: deploy v2.3.1)
              └── Mayday communication verdict (initial status update)
                    └── Mayday remediation verdict (rollback payment-api)
                          └── Mayday communication verdict (resolution update)
```

Human override at any point resolves that verdict as `"overridden"` and the accuracy signal propagates through `verdict.accuracy(producer="mayday", subject_type=<role>)`.

---

## 14. Beads Task Mapping

| Beads ID | Task | Spec Section |
|----------|------|-------------|
| `opensrm-m50.1` | Coordinator + crash recovery | 7, 8 |
| `opensrm-m50.2` | Triage agent | 4, 5.1 |
| `opensrm-m50.3` | Investigation agent | 4, 5.2 |
| `opensrm-m50.4` | Communication agent | 4, 5.3 |
| `opensrm-m50.5` | Remediation agent | 4, 5.4 |
| `opensrm-m50.6` | Safe Action Registry | 6 |
| `opensrm-m50.7` | Verdict integration | 12, 13 (already closed) |
| `opensrm-m50.8` | Human override flow | 7 (approve/reject) |
| `opensrm-m50.9` | Mayday CLI | 9 |
| `opensrm-m50.10` | mayday replay | 9, 10 |
| `opensrm-m50.11` | Mayday tests | All sections |

---

## 15. Deferred / Out of Scope

These features are mentioned in `IMPLEMENTATION-PLAN.md` Phase 3.5 or `mayday/CLAUDE.md` but are explicitly deferred from this spec:

- **Post-incident verdict resolution:** When an incident reaches a terminal state, resolve all pending Mayday verdicts in the chain. Deferred to a follow-up task — the verdict chain is complete without this, and manual resolution via `verdict` CLI works in the interim.
- **Scenario export:** Export a resolved incident's verdict chain + context as a replayable scenario YAML. Deferred — replay works from pre-authored scenarios for now.
- **Channel integrations (Slack, PagerDuty, email):** Communication agent drafts messages; actual sending is Tier 2 glue code. The agent produces the content, infrastructure delivers it.
- **Full incident dedup/merging:** Merging overlapping incidents when multiple SitRep correlations identify the same root cause. Tier 1 uses simple dedup (skip if active incident covers same services).
- **OpenSRM manifest-driven safe actions:** Tier 2 — safe actions are currently defined in code (`actions.py`), not read from manifests.

---

## 16. Files Changed / Created

All files are new (no existing Mayday code).

**Created:**
- `mayday/pyproject.toml`
- `mayday/src/mayday/__init__.py`
- `mayday/src/mayday/__main__.py`
- `mayday/src/mayday/types.py`
- `mayday/src/mayday/config.py`
- `mayday/src/mayday/coordinator.py`
- `mayday/src/mayday/context_store.py`
- `mayday/src/mayday/agents/base.py`
- `mayday/src/mayday/agents/triage.py`
- `mayday/src/mayday/agents/investigation.py`
- `mayday/src/mayday/agents/communication.py`
- `mayday/src/mayday/agents/remediation.py`
- `mayday/src/mayday/safe_actions/registry.py`
- `mayday/src/mayday/safe_actions/actions.py`
- `mayday/src/mayday/cli.py`
- `mayday/tests/conftest.py`
- `mayday/tests/test_types.py`
- `mayday/tests/test_coordinator.py`
- `mayday/tests/test_context_store.py`
- `mayday/tests/test_agent_base.py`
- `mayday/tests/test_triage.py`
- `mayday/tests/test_investigation.py`
- `mayday/tests/test_communication.py`
- `mayday/tests/test_remediation.py`
- `mayday/tests/test_safe_actions.py`
- `mayday/tests/test_replay.py`
- `mayday/tests/test_cli.py`
- `mayday/scenarios/synthetic/` (8 scenario files)

**Updated:**
- `mayday/CLAUDE.md` — add autonomy reduction as first-class concept, update implementation phases to reference this spec

# OpenSRM RBAC Extension — v1.1-draft

**Status:** Draft for implementation
**Supersedes:** OPENSRM-RBAC-EXTENSION.md v1.0-draft
**Date:** 2026-04-19

---

## Delta Summary

This revision adopts established OSS primitives in place of several hand-rolled components proposed in v1.0. The architectural model (unified human/agent authorisation, capability-based execution, signed one-shot tokens, policy evaluation layered over per-service action declarations) is unchanged. What changes is the implementation substrate:

| v1.0 (hand-rolled) | v1.1 (delegated) | Rationale |
|---|---|---|
| Custom YAML policy DSL with bespoke evaluator | **Rego** via **Regorus** (Microsoft, Rust+PyO3) | OPA-compatible, CNCF-graduated ecosystem, mature tooling |
| Bespoke capability token format | **Biscuit** (Eclipse Foundation, `biscuit-python`) | Datalog-based attenuation, exactly matches one-shot-signed-authorisation semantics |
| Unspecified change-freeze signal | **ChangeFreeze** first-class OpenSRM document kind | Declarative model consistent with rest of ecosystem |
| Fixed precondition vocabulary | **Standard Rego modules** NthLayer ships + custom Rego | OPA is the plugin mechanism; custom preconditions don't need bespoke support |
| Identity handling TBD | **SPIFFE** workload identity via `py-spiffe` (optional) | Authenticates who the caller is; Biscuit authorises what they may do |
| Decision logs TBD | **OTel logs + CloudEvents envelope**, OPA-decision-log format borrowed for field names | Borrow the schema, reject the OPA-specific wire format |

Key consequences: the YAML policy DSL in §5 becomes sugar that compiles to Rego; the capability token schema in §6 becomes Biscuit-specific with documented Datalog checks; ChangeFreeze is formally introduced in §7 as a new kind; §8 is new and covers workload identity.

---

## 1. Motivation

Unchanged from v1.0.

AI agents executing actions against production infrastructure require the same authorisation rigour as human operators, yet existing systems treat these as separate problems. The RBAC extension models humans and agents as instances of a single principal type, subject to the same authorisation flow, producing identical audit trails.

The extension solves three specific problems:

1. **Unified audit trail.** A single verdict stream records who (human or agent) requested what action, who (human or system) authorised it, and what outcome resulted. Compliance-grade audit trails do not bifurcate by principal kind.

2. **No ambient authority.** No component except the executor holds production credentials. Agents and humans alike must obtain signed, short-lived, parameter-bound capabilities before any action touches a target system.

3. **Declarative authorisation policy.** The rules governing who may do what, under which preconditions, with which approvals, live as declarative documents in the ecosystem — not as code paths buried in an incident-response orchestrator.

## 2. Scope

Unchanged from v1.0. This extension covers authorisation decisions and their execution. It does not cover identity provider integration, secret management, or credential provisioning for target systems — these are deployment concerns.

## 3. Principals

A **Principal** is the actor requesting an action. Principals have a kind, an identity, and zero or more attributes.

```yaml
principal:
  kind: human | agent | system
  id: string           # stable identifier
  attributes:
    team: string
    role: string
    on_call: boolean
    mfa_verified: boolean
    # ... arbitrary additional attributes
```

### 3.1 Human principals

Identity resolution for human principals is delegation to an identity provider (OIDC, SAML, or platform-specific). The deployment configures how principal attributes populate; common patterns include group-to-team mapping, on-call status from PagerDuty, and MFA verification from the session's authentication context.

### 3.2 Agent principals

Agents are AI components (incident-response agents, remediation agents, observation agents). Agent identity is established via **SPIFFE** (SPIFFE Verifiable Identity Document) where a SPIRE infrastructure exists; otherwise by static agent certificates provisioned at deployment time. Agent attributes include:

- `agent.type` (triage | investigation | communication | remediation | ...)
- `agent.version` (semver; policies can require minimum versions)
- `agent.model` (LLM model identifier; policies can restrict by model)
- `agent.autonomy_level` (set by nthlayer-measure's one-way ratchet; policies can reduce allowed action scope as autonomy drops)

### 3.3 System principals

System principals are automated components that are not AI agents: CI pipelines, scheduled jobs, platform automation. They require their own identity (typically SPIFFE) and are subject to the same authorisation flow. System principals generally have wider preconditions (allowed during change freezes for rollbacks, for example) but narrower action scope (cannot escalate to emergency-level actions without paired human approval).

### 3.4 Workload identity (new in v1.1)

Where **SPIFFE/SPIRE** is deployed, principal identity is established via SVID (X.509 or JWT). nthlayer-authorise consumes SVIDs via `py-spiffe` (`spiffe` and `spiffe-tls` packages, HewlettPackard/py-spiffe, Apache-2.0). This gives cryptographically verifiable workload identity without reinventing certificate management.

For deployments without SPIRE, the v1.0 model (static certificates or bearer tokens from the platform) remains valid. SPIFFE adoption is an operational choice, not a spec requirement.

## 4. Actions

Unchanged from v1.0.

An **Action** is a declared operation a service permits. Actions live in the service manifest and specify their parameter schema, blast radius, preconditions, and required approval level.

```yaml
actions:
  - id: rollback-deployment
    description: "Roll back to the previous known-good deployment"
    parameters:
      schema: { $ref: "#/schemas/RollbackParams" }
    blast_radius: production
    preconditions:
      - no-change-freeze
      - rate-limit: { max: 3, window: 1h }
    approval_level: single-human
    execution:
      binding: kubernetes-rollout
      target: "deployment/payment-service"
```

### 4.1 Action identity

Actions are identified by `{service}.{action_id}`, scoped to the service manifest they're declared in.

### 4.2 Parameters

Actions declare their parameter schema (JSON Schema). Parameter validation happens at capability-issuance time; invalid parameters fail closed.

### 4.3 Blast radius

Enumerated values: `ephemeral`, `dev`, `staging`, `production`. Blast radius is used by policy rules to scope privilege (agents may execute in `dev` without approval but require human approval in `production`).

### 4.4 Preconditions

Preconditions are **Rego predicates** evaluated at authorisation time. v1.1 ships a standard vocabulary as Rego modules; organisations extend with custom Rego as needed.

**Standard preconditions (ships with NthLayer):**

| Name | Rego module | Purpose |
|---|---|---|
| `no-change-freeze` | `data.nthlayer.preconditions.no_change_freeze` | Rejects if an active ChangeFreeze covers the target |
| `rate-limit` | `data.nthlayer.preconditions.rate_limit` | Rejects if action executed more than `max` times in `window` |
| `error-budget-available` | `data.nthlayer.preconditions.error_budget` | Rejects if specified SLO's error budget is below threshold |
| `no-active-incident` | `data.nthlayer.preconditions.no_active_incident` | Rejects if an active incident exists on the target service |
| `slo-healthy` | `data.nthlayer.preconditions.slo_healthy` | Rejects if the specified SLO is currently breaching |
| `principal-attribute` | `data.nthlayer.preconditions.principal_attribute` | Rejects if the principal lacks a specified attribute value |
| `time-window` | `data.nthlayer.preconditions.time_window` | Rejects outside a time window |
| `approval-required` | implicit in `approval_level` | Rejects until approval recorded |

**Custom preconditions.** Organisations define additional Rego rules under their own namespace (`data.org.acme.preconditions.*`). nthlayer-authorise loads custom modules at startup via OPA's bundle format or filesystem paths.

### 4.5 Approval levels

Unchanged from v1.0.

- `none` — no approval required (agent or system can execute directly)
- `single-human` — one human approval required
- `dual-human` — two human approvals required, with distinct principals
- `emergency` — single-human approval with MFA, generates elevated audit record

### 4.6 Execution bindings

Unchanged from v1.0. Bindings are the mechanism by which the executor invokes the action: `webhook`, `kubernetes-rollout`, `command`, etc. Each binding has its own schema and credential requirements.

## 5. Authorisation Policies

AuthorisationPolicy documents are cross-service rules layered over per-service action declarations. v1.1 specifies these as Rego, with a YAML DSL as the accessible authoring surface.

### 5.1 YAML DSL (authoring surface)

The YAML DSL is the primary authoring surface for operators who don't know Rego:

```yaml
apiVersion: opensrm/v1
kind: AuthorisationPolicy
metadata:
  name: production-tightening
spec:
  rules:
    - match:
        action.blast_radius: production
        principal.kind: agent
      effect:
        require_approval: dual-human
        require_attributes:
          principal.team: sre
    - match:
        action.blast_radius: production
        principal.attributes.on_call: false
      effect:
        deny: "Production actions require on-call principal"
```

### 5.2 Rego compilation target

The YAML DSL compiles to Rego for evaluation. The compilation is deterministic and documented; operators can inspect the compiled Rego. Advanced users can author Rego directly, bypassing the YAML.

```rego
package nthlayer.authorisation

# Compiled from the YAML above
import future.keywords.if
import future.keywords.in

default allow := false

# Rule: production actions by agents require dual-human approval and SRE team
require_dual_human_approval if {
    input.action.blast_radius == "production"
    input.principal.kind == "agent"
}

deny[msg] if {
    input.action.blast_radius == "production"
    not input.principal.attributes.on_call
    msg := "Production actions require on-call principal"
}

# ... and so on
```

### 5.3 Policy evaluation

**Engine:** Regorus (microsoft/regorus, MIT/Apache-2.0 dual-licensed, Rust core with PyO3 bindings). As of regorus-v0.9.1 (February 2026), Regorus passes OPA's v1.2 conformance suite minus the crypto builtins. All standard precondition Rego modules use only supported builtins.

**Fallback:** Where regorus wheels are unavailable on the target platform, `regopy` (C++ rego implementation, precompiled wheels for cp3.6-cp3.14) is the fallback. Both evaluate the same Rego source.

**Policy distribution:** OPA bundle format. Policies are packaged as `.tar.gz` bundles with `data.json` (external facts like principal→team mappings) and `*.rego` (policy modules). Bundle distribution is GitOps-native; nthlayer-authorise polls a bundle source (HTTPS, S3, git) and hot-reloads on change.

**Input shape.** The evaluation input document includes:

```json
{
  "principal": { /* Principal object from §3 */ },
  "action": { /* Action declaration from §4 */ },
  "request": {
    "parameters": { /* validated per action.parameters.schema */ },
    "target": "...",
    "timestamp": "2026-04-19T..."
  },
  "state": {
    "incidents": [...],       // from nthlayer-respond verdicts
    "slo_status": {...},      // from nthlayer-observe
    "error_budgets": {...},   // from nthlayer-observe
    "change_freezes": [...],  // from ChangeFreeze documents (§7)
    "rate_limits": {...}      // computed from execution verdicts
  }
}
```

### 5.4 Evaluation order

Rules evaluate as **all-match with deny-wins**: all rules evaluate; any `deny` verdict wins; then `require_*` constraints compose additively; default is allow only if no rule produced a deny.

(v1.0 left this open; v1.1 commits to all-match because it composes more cleanly than first-match when multiple policies layer — organisation-wide policy plus team-level policy plus service-level policy.)

### 5.5 Decision output

Regorus returns a structured decision object which nthlayer-authorise translates into a verdict:

```json
{
  "allow": true | false,
  "required_approvals": ["single-human"],
  "required_attributes": { "principal.team": "sre" },
  "deny_reasons": [],
  "matched_rules": ["production-tightening.rules[0]"],
  "evaluation_trace": {...}  // optional, for debugging
}
```

The `matched_rules` and `evaluation_trace` fields feed the decision log (§9).

## 6. Capability Tokens

Capability Tokens are the signed one-shot authorisations issued by nthlayer-authorise and consumed by nthlayer-executor. v1.1 specifies these as **Biscuit** tokens.

### 6.1 Why Biscuit

Biscuit (Eclipse Foundation governance, `biscuit-python` 0.4.0 September 2025, Apache-2.0) is a capability-token format designed exactly for this use case: the token carries embedded Datalog checks that the verifier evaluates against runtime facts. This gives NthLayer three properties the v1.0 bespoke format couldn't cleanly provide:

1. **Attenuation.** A capability can be further restricted by the holder without re-contacting the issuer (e.g., a broad rollback capability can be attenuated to a specific deployment).
2. **Embedded checks.** The token itself declares what must be true for it to be valid (time window, target service, parameter bounds). The verifier's job is to inject runtime facts, not to re-derive constraints.
3. **Offline verification.** The executor validates the token locally using the issuer's public key — no round-trip to authorise on the hot path.

### 6.2 Token structure

A Biscuit capability token carries:

**Authority block (signed by nthlayer-authorise):**
```
// Principal identity
principal_kind("agent");
principal_id("triage-agent-01");

// Action grant
action("payments.rollback-deployment");
target("deployment/payment-service");

// Parameter binding
parameter_hash("sha256:abcd1234...");

// Validity window
valid_from(2026-04-19T09:00:00Z);
valid_until(2026-04-19T09:10:00Z);

// Checks the verifier must satisfy
check if time($t), $t >= 2026-04-19T09:00:00Z, $t <= 2026-04-19T09:10:00Z;
check if target_exists($tgt), target($tgt);
check if current_freeze_status($s), $s == "no_freeze" or allowed_during_freeze("payments.rollback-deployment");
```

**Attenuation blocks (optional, added by the holder):**

A holder can attach further restrictions without invalidating the signature:
```
// Restrict this capability to a specific namespace
check if target_namespace($ns), $ns == "production-eu";
```

### 6.3 Issuance

nthlayer-authorise generates tokens using the organisation's Ed25519 signing key. Key management is deployment-specific; for v1.1 we specify:

- Signing key is Ed25519 generated at deployment time
- Key rotation: keys have `not_before` and `not_after` validity; multiple keys may be active for rotation; tokens carry a `key_id` block identifying which key signed
- Signing is in-process using PyNaCl (PyCA-maintained, 2025 updates for libsodium 1.0.20)
- Optionally: key material may be held in HashiCorp Vault (via `hvac`) with signing delegated to Vault's Transit engine; tokens carry the same key_id

### 6.4 Verification

nthlayer-executor verifies tokens locally using the issuer's public key distributed at deployment time. Verification includes:

1. Signature validation (PyNaCl / biscuit-python)
2. Time-window check (injected runtime fact: current time)
3. Target-existence check (injected runtime fact: target resource exists)
4. Change-freeze check (injected runtime fact: current freeze status from §7)
5. Any attenuation-block checks (evaluated with injected facts as above)
6. Parameter-hash check (parameters passed separately must match the hash in the token)

A capability is **single-use**. The executor writes an `execution` verdict upon use, and a Bloom-filter-backed replay protection prevents re-use of the same token signature within its validity window.

### 6.5 Revocation

Tokens are short-lived (typical TTL: 5-10 minutes) so revocation is usually achieved by waiting. For emergency revocation, nthlayer-authorise maintains a revocation list (token hashes) that nthlayer-executor polls. Revocation is best-effort within 30 seconds.

## 7. ChangeFreeze (new in v1.1)

ChangeFreeze is a first-class OpenSRM document kind that declares a freeze on changes to specified scope. It's consumed by the `no-change-freeze` precondition.

### 7.1 Rationale

v1.0 left change-freeze handling unspecified ("integrates with change-management system"). The honest architectural answer is that change freezes originate from many sources (platform team announcements, ServiceNow records, incident-commander declarations, calendar events, GitOps files, CI/CD gates) and NthLayer should not integrate with each one. Instead, external systems **publish ChangeFreeze documents into NthLayer**, and the authorisation component evaluates against the local store.

This inverts the integration direction correctly: NthLayer doesn't reach out to ServiceNow; ServiceNow publishes into NthLayer when relevant. Three ingestion paths are supported:

- **GitOps path.** ChangeFreeze documents as YAML in a git repository; a sync process mirrors them into the local store.
- **API path.** HTTPS endpoint on nthlayer-authorise (`POST /change-freezes`) accepts ChangeFreeze documents from arbitrary publishers.
- **CRD path (future).** ChangeFreeze as a Kubernetes CRD with a controller, for K8s-heavy environments.

All three paths produce the same local artifact; the authorisation logic doesn't care where it came from.

### 7.2 Schema

```yaml
apiVersion: opensrm/v1
kind: ChangeFreeze
metadata:
  name: 2026-q4-holiday-freeze
  declared_by: "platform-team@example.com"
  declared_at: "2026-11-15T00:00:00Z"
spec:
  reason: "End-of-year holiday freeze. All non-emergency changes prohibited."
  active_from: "2026-12-20T00:00:00Z"
  active_until: "2027-01-03T23:59:59Z"
  scope:
    environments: [production]
    services: []           # empty = all services
    action_ids: []         # empty = all actions
  exceptions:
    # Action types that remain permitted during the freeze
    - action_ids: [rollback-deploy, scale-up]
      reason: "Remediation actions remain permitted."
    - approval_levels: [emergency]
      reason: "Emergency break-glass remains available with MFA + elevated audit."
  lifted_at: null          # populated when freeze is cancelled early
  lifted_by: null
```

### 7.3 Incident-driven freezes

When nthlayer-respond opens an incident, it automatically writes a ChangeFreeze document scoped to the affected services with `active_until` initially set to 24h (extended as needed). The freeze's exceptions list includes the remediation action types appropriate to the incident, so remediation isn't blocked by the freeze meant to protect users of the failing service. When the incident resolves, nthlayer-respond writes `lifted_at`.

This produces a nice emergent property: incident-driven and human-declared freezes use the same mechanism, with no special-casing in authorise.

### 7.4 Rego evaluation

The `no-change-freeze` precondition is implemented as:

```rego
package nthlayer.preconditions.no_change_freeze

import future.keywords.if
import future.keywords.in

default allowed := false

allowed if {
    count(blocking_freezes) == 0
}

blocking_freezes contains freeze if {
    freeze := input.state.change_freezes[_]
    freeze_active(freeze)
    freeze_covers_action(freeze, input.action)
    not action_excepted(freeze, input.action, input.principal)
}

freeze_active(freeze) if {
    time.now_ns() >= time.parse_rfc3339_ns(freeze.spec.active_from)
    time.now_ns() <= time.parse_rfc3339_ns(freeze.spec.active_until)
    is_null(freeze.spec.lifted_at)
}

freeze_covers_action(freeze, action) if {
    # Environment match or empty (all envs)
    count(freeze.spec.scope.environments) == 0
} else if {
    action.blast_radius in freeze.spec.scope.environments
}

# ... similar for services and action_ids

action_excepted(freeze, action, principal) if {
    some exception in freeze.spec.exceptions
    action.id in exception.action_ids
} else if {
    some exception in freeze.spec.exceptions
    action.approval_level in exception.approval_levels
}
```

### 7.5 Storage

ChangeFreeze documents are stored in the serve-mode store's `change_freezes` table. Retention follows the broader retention policy (§3.7 of serve-mode spec): active freezes are retained indefinitely; lifted freezes are retained for the audit retention period (default 90 days) then purged.

## 8. Workload Identity (new in v1.1)

### 8.1 SPIFFE integration

Where **SPIRE** (spiffe/spire, CNCF-graduated) is deployed, nthlayer components consume SPIFFE SVIDs as their workload identity:

- nthlayer-authorise authenticates incoming action_request verdicts by validating the originating agent's SVID
- nthlayer-executor authenticates its connection to target systems using its own SVID (where targets support SPIFFE)
- Agent-to-agent calls within nthlayer-respond use mTLS with SVIDs

The `py-spiffe` library (HewlettPackard/py-spiffe, Apache-2.0, `spiffe` 0.2.3 January 2026, `spiffe-tls` 0.3.1 March 2026) provides the Python integration.

### 8.2 Without SPIFFE

Deployments without SPIRE use:

- Static agent certificates provisioned at deployment time
- Bearer tokens from the platform (OIDC for humans, service-account tokens for workloads)
- Principal identity populated from the request's authentication context

This is the v1.0 model and remains fully supported. SPIFFE adoption is an operational improvement, not a correctness requirement.

## 9. Decision Logs and Audit Trail

### 9.1 Decision log schema

Borrowing OPA's decision-log field vocabulary (not its wire format):

```json
{
  "decision_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "timestamp": "2026-04-19T09:32:15Z",
  "principal": { "kind": "agent", "id": "triage-agent-01" },
  "action": "payments.rollback-deployment",
  "request_parameters_hash": "sha256:...",
  "decision": "allow",
  "matched_rules": ["production-tightening.rules[0]"],
  "required_approvals": ["single-human"],
  "deny_reasons": [],
  "evaluation_duration_ms": 12,
  "bundle_revision": "acme-policies-v2.3.1",
  "labels": {
    "environment": "production",
    "nthlayer_instance": "eu-west"
  }
}
```

### 9.2 Wire format

Decision logs are emitted as **OTel log records** wrapped in **CloudEvents v1.0 envelopes** (CNCF-graduated). This aligns with the ecosystem's broader telemetry approach and gives SIEM-integration paths via the standard OTel Collector log receivers.

```
CloudEvent:
  specversion: 1.0
  type: io.nthlayer.authorisation.decision.v1
  source: urn:nthlayer:authorise:eu-west
  id: 01ARZ3NDEKTSV4RRFFQ69G5FAV
  time: 2026-04-19T09:32:15Z
  datacontenttype: application/json
  data: { ... decision log schema above ... }
```

### 9.3 Relationship to verdicts

Decision logs are an additional audit artifact, linked to but distinct from the capability/denial verdicts written to nthlayer-learn. Decision logs are for compliance replay; verdicts are for ecosystem state. A denial produces:

- A `denial` verdict (in nthlayer-learn)
- A decision log entry (in OTel logs / SIEM)

Both reference the same `decision_id` for correlation.

## 10. Verdict Types (updated from v1.0)

Unchanged from v1.0 structurally; the wire format adopts CloudEvents + OTel `gen_ai.*`:

| Type | Producer | Consumer | OTel event |
|---|---|---|---|
| `action_request` | Agent (respond) or human (Bench/CLI) | authorise | `io.nthlayer.verdict.action_request.v1` |
| `approval` | Human (Bench, Slack) | authorise | `io.nthlayer.verdict.approval.v1` |
| `capability` | authorise | executor | `io.nthlayer.verdict.capability.v1` |
| `denial` | authorise | audit / Bench | `io.nthlayer.verdict.denial.v1` |
| `execution` | executor | learn | `io.nthlayer.verdict.execution.v1` |
| `operator_note` | Human (Bench) | audit / learn | `io.nthlayer.verdict.operator_note.v1` |

Verdicts are hash-chained using content-addressed identifiers. The content-addressing uses **IPLD CIDs** (via `libipld`, MarshalX/python-libipld, Rust+PyO3, MIT); daily Merkle roots are anchored to **Sigstore Rekor** for third-party-verifiable tamper evidence. See nthlayer-learn spec for details.

## 11. Component Responsibilities

### 11.1 nthlayer-authorise

- Consumes `action_request` and `approval` verdicts from the store
- Loads AuthorisationPolicy bundles from configured source (git, S3, HTTPS)
- Loads ChangeFreeze documents from the store
- Evaluates policies via Regorus (or regopy fallback)
- Issues Biscuit `capability` verdicts or `denial` verdicts
- Emits decision logs via OTel

### 11.2 nthlayer-executor

- Consumes `capability` verdicts from the store
- Verifies Biscuit tokens (signature, embedded checks, attenuation)
- Dispatches to execution binding (webhook, kubernetes, command)
- Runs post-execution verification (where configured)
- Writes `execution` verdicts
- Triggers rollback bindings on verification failure

## 12. Worked Example

An agent wants to roll back a deployment. Trace through v1.1:

1. **Agent emits action_request.** Triage agent determines the payment-service failure correlates with a recent deployment. It emits an `action_request` verdict referencing `payments.rollback-deployment`.

2. **authorise receives, evaluates.** nthlayer-authorise picks up the request, constructs the Rego input document (principal: agent, action: rollback-deployment, state: { incidents: [...], change_freezes: [active-incident-freeze], slo_status: {...} }), invokes Regorus.

3. **Policy evaluation.** The production-tightening policy requires dual-human approval for agent-initiated production actions. The `no-change-freeze` precondition checks ChangeFreeze documents — finds the incident-driven freeze, which has `rollback-deploy` in its exceptions, so the precondition passes. Evaluation returns `{ allow: false, required_approvals: ["dual-human"], matched_rules: [...] }`.

4. **authorise writes pending state.** Since approval is required, authorise writes a pending-approval record (not a full capability yet). The Bench surfaces this as a case.

5. **Operators approve.** Two human operators approve via the Bench; approval verdicts accumulate in the store.

6. **authorise re-evaluates.** With both approvals recorded, authorise re-evaluates. Policy now passes (required_approvals satisfied). authorise generates a Biscuit capability token: signs the authority block with the org's Ed25519 key, includes checks for time-window, target-exists, parameter-hash. Writes a `capability` verdict.

7. **executor consumes.** nthlayer-executor picks up the capability, verifies locally (signature valid, current time within window, target exists, current change-freeze status allows the action since it's in the exceptions list, parameter hash matches). Dispatches to kubernetes-rollout binding.

8. **Execution.** The rollback is performed. Post-execution verification checks that the deployment's replica count returned to expected. executor writes `execution` verdict with outcome: success.

9. **Downstream.** nthlayer-learn records the verdict chain (action_request → approval → capability → execution) with content-addressed lineage. Daily Merkle root anchored to Rekor. Decision logs in OTel for SIEM.

## 13. Migration from v1.0

For deployments already running v1.0:

1. **Introduce Regorus alongside custom evaluator.** Run both in shadow mode for a release cycle. The custom evaluator remains primary; Regorus evaluates in parallel and its decisions are logged but not enforced. Compare outcomes.
2. **Cut over to Regorus.** When shadow-mode shows Regorus matches the custom evaluator for 100% of decisions (or the deltas are all improvements), flip Regorus to primary.
3. **Compile existing YAML policies to Rego.** v1.1 compilation tool produces Rego from v1.0 YAML. Generated Rego is reviewed and committed.
4. **Introduce Biscuit alongside custom tokens.** Same shadow pattern: both tokens issued, executor accepts either, decisions compared.
5. **Deprecate custom token format.** Once Biscuit is proven, new tokens are Biscuit-only; existing in-flight custom tokens are honored until their TTLs expire.
6. **Introduce ChangeFreeze.** Net-new capability; no migration needed. Existing change-management systems add GitOps or API publishing paths.
7. **Adopt SPIFFE if SPIRE is deployed.** Otherwise defer.

## 14. Open Questions

Resolved from v1.0:
- ~~Custom precondition support~~ → OPA/Rego is the extension mechanism (§4.4)
- ~~Policy evaluation order~~ → all-match with deny-wins (§5.4)
- ~~Key rotation~~ → `key_id` in tokens, multiple active keys, rotation via deployment (§6.3)

Still open:
- **Emergency approval additional constraints.** Should the spec define additional constraints for emergency-level actions (must be in a specific team, must be during a declared incident) or leave as deployment choice?
- **Token attenuation in UX.** How does the Bench surface capability tokens to operators in a way that makes attenuation understandable without requiring Datalog literacy?
- **Horizontal scaling.** Multi-instance authorise with distributed replay protection for Biscuit tokens. Design is straightforward but out of v1.1 scope.

## 15. References

- Regorus: https://github.com/microsoft/regorus
- regopy: https://pypi.org/project/regopy/
- Biscuit: https://www.biscuitsec.org/
- biscuit-python: https://github.com/eclipse-biscuit/biscuit-python
- OPA decision log schema: https://www.openpolicyagent.org/docs/management-decision-logs
- SPIFFE: https://spiffe.io/
- py-spiffe: https://github.com/HewlettPackard/py-spiffe
- PyNaCl: https://pynacl.readthedocs.io/
- CloudEvents: https://cloudevents.io/
- OTel logs: https://opentelemetry.io/docs/specs/otel/logs/

## 16. Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0-draft | 2026-04-18 | Initial extension spec |
| 1.1-draft | 2026-04-19 | Adopted Regorus, Biscuit, SPIFFE; folded in ChangeFreeze; revised decision log and verdict wire formats to CloudEvents+OTel |

# OpenSRM RBAC Extension: Action Authorisation

> **⚠️ Superseded.** This is the v1 RBAC extension, retained for historical reference.
> The active specification is [`OPENSRM-RBAC-EXTENSION-v2.md`](OPENSRM-RBAC-EXTENSION-v2.md)
> in this same directory. Implementations should target v2; v1 is preserved only for
> consumers transitioning off the original draft.

**Extension to:** OpenSRM v1
**Version:** 1.0.0-draft
**Status:** Draft
**Authors:** Rob Sionnach
**Depends on:** OpenSRM v1 core specification

---

## Abstract

This extension defines a unified authorisation model for actions taken against services in the OpenSRM ecosystem. It applies symmetrically to human operators and AI agents: both are *principals* that request *actions* defined in OpenSRM manifests. Actions are validated against declared preconditions and blast radius, authorised through a capability token, executed by a separate component, and recorded as content-addressed verdicts in the shared store.

The extension introduces two new manifest concepts (`Action`, `AuthorisationPolicy`), three new verdict types (`capability`, `execution`, `denial`), and defines the roles of two new NthLayer components: `nthlayer-authorise` and `nthlayer-executor`.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Principals and Actions](#3-principals-and-actions)
4. [Action Definition](#4-action-definition)
5. [Authorisation Policy](#5-authorisation-policy)
6. [Capability Tokens](#6-capability-tokens)
7. [Execution and Recording](#7-execution-and-recording)
8. [Authorisation Flow](#8-authorisation-flow)
9. [Verdict Types](#9-verdict-types)
10. [Integration with OpenSRM v1](#10-integration-with-opensrm-v1)
11. [Component Responsibilities](#11-component-responsibilities)
12. [JSON Schema](#12-json-schema)
13. [Examples](#13-examples)
14. [Security Considerations](#14-security-considerations)
15. [Migration from Informal Safe Actions](#15-migration-from-informal-safe-actions)

---

## 1. Introduction

### 1.1 Motivation

OpenSRM v1 establishes reliability requirements as code. This extension establishes *action* as code: what operations may be taken against a service, by which principals, under which conditions.

The motivating problem is twofold. First, AI agents operating in production require authorisation boundaries that a prompt-level "safe action list" cannot enforce — an agent cannot be trusted to observe its own constraints. Second, human operators and AI agents are increasingly performing the same classes of action (rollbacks, scale operations, config changes, incident declarations), and maintaining two distinct authorisation systems creates drift, audit gaps, and operational complexity.

This extension addresses both by defining a single authorisation model in which the principal type is a property of the request, not a separate system.

### 1.2 Design Principles

1. **Unified model.** Human operators and AI agents are both principals. The authorisation decision uses the same machinery for each; principal type is an attribute, not a separate code path.

2. **Declarative actions.** Every action that may be taken against a service is declared in the service's OpenSRM manifest. Actions not declared cannot be taken.

3. **No ambient authority.** Principals do not hold credentials for target systems. A capability token is issued per-action, bound to specific parameters, with a short lifetime. The executor holds credentials; the principal holds verdicts.

4. **Separation of concerns.** Authorisation decides whether. Execution decides what happened. They are separate components with separate state and separate audit trails.

5. **Content-addressed audit.** Every authorisation decision, denial, and execution is a verdict in the shared store, hash-linked to the action request and to the principal's identity.

6. **Deterministic preconditions.** Preconditions are expressed declaratively and evaluated by code, not by agents. An agent's proposal is an input to authorisation, never a factor in the decision.

### 1.3 Non-Goals

- **This extension does not define identity.** Principal identity is assumed to be established upstream (OIDC, SPIFFE, platform auth headers, etc.). The extension consumes a principal identifier and trusts it.
- **This extension does not define action implementation.** What a `rollback-deploy` action actually does is specified by its `execution` binding (webhook URL, command, etc.) and executed by `nthlayer-executor`. The authorisation layer is indifferent to mechanism.
- **This extension does not replace existing IAM.** Kubernetes RBAC, cloud IAM, and similar systems continue to enforce platform-level controls. This extension sits *above* those systems, declaring which actions principals may request through the NthLayer ecosystem.

---

## 2. Conformance

- **MUST**: Required for conformance.
- **SHOULD**: Recommended for production use.
- **MAY**: Optional enhancement.

A conforming implementation MUST:

1. Parse `Action` definitions from OpenSRM manifests.
2. Parse `AuthorisationPolicy` documents.
3. Evaluate all declared preconditions deterministically before issuing a capability.
4. Reject action requests not declared in the target service's manifest.
5. Issue capability tokens bound to exactly one action invocation.
6. Write a capability verdict for every successful authorisation.
7. Write a denial verdict for every rejected request.
8. Write an execution verdict for every capability consumed.

A conforming implementation SHOULD:

1. Support all standard precondition types defined in Section 4.4.
2. Enforce blast radius at execution time, not only at authorisation time.
3. Emit OpenTelemetry events per Section 11.4.
4. Support capability revocation before execution.

---

## 3. Principals and Actions

### 3.1 Principal Types

A **principal** is the entity requesting an action. Three principal types are defined:

| Type | Description | Identity source |
|------|-------------|-----------------|
| `human` | An operator identified by an authenticated session | Auth provider (OIDC, SAML, platform headers) |
| `agent` | An AI agent identified by its producer identity | NthLayer agent registry (component name + instance) |
| `system` | An automated system (CI/CD, cron, etc.) identified by a service account | Service account credential |

Principal identifiers MUST be stable across sessions. A human principal identifier is the operator's authenticated subject (e.g., email, sub claim). An agent principal identifier is the component name plus a content-hash of the agent's configuration (e.g., `nthlayer-respond/remediation@a8f2c1`). A system principal identifier is the service account name.

### 3.2 Principal Attributes

Principals carry attributes that authorisation policies may reference:

| Attribute | Source | Example |
|-----------|--------|---------|
| `principal.type` | Request context | `human`, `agent`, `system` |
| `principal.id` | Identity provider | `rob@workday.com`, `nthlayer-respond/remediation@a8f2c1` |
| `principal.teams` | Identity provider or policy | `["platform-checkout", "sre"]` |
| `principal.roles` | Policy | `["operator", "approver"]` |
| `principal.mfa` | Identity provider | `true`, `false` (human only) |

Attribute resolution is implementation-defined but MUST be deterministic and auditable. The authorisation component records the resolved attributes at decision time so that decisions are reproducible from the verdict store.

### 3.3 Actions as First-Class Declarations

An action is the atomic unit of authorisation. An action has:

- A unique identifier within the service manifest.
- A declared parameter schema.
- A declared blast radius.
- A set of preconditions.
- An approval level.
- A reversibility classification.
- An execution binding.
- An optional verification specification.
- An optional rollback specification.

Actions not declared in a service's manifest MUST NOT be executable through this authorisation model. There is no "default allow" and no "administrator override" at the action level; administrative override is expressed through a separate, higher-privileged approval level (`emergency`, Section 4.5).

---

## 4. Action Definition

### 4.1 Action Structure

Actions are declared in the `spec.actions` array of a service's OpenSRM manifest:

```yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: payment-service
spec:
  type: api
  # ... existing spec fields ...
  actions:
    - id: rollback-deploy
      description: "Roll the service back to the previous deployment."
      approval_level: single-human
      reversibility: reversible-manual
      parameters:
        schema:
          type: object
          properties:
            target_version:
              type: string
              pattern: "^d-[0-9]+$"
          required: [target_version]
      blast_radius:
        services: [payment-service]
        environments: [production]
      preconditions:
        - type: no-change-freeze
        - type: rate-limit
          max: 2
          window: 1h
      execution:
        binding: webhook
        endpoint: deploy-service
        timeout: 60s
      verification:
        type: slo-recovery
        slo: availability
        window: 5m
      rollback:
        action_id: deploy-version
        derive_parameters: previous_version
```

### 4.2 Action Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | MUST | Unique identifier within the manifest (pattern: `^[a-z][a-z0-9-]*$`) |
| `description` | string | MUST | Human-readable description of what the action does |
| `approval_level` | string | MUST | One of `autonomous`, `single-human`, `multi-human`, `emergency`, `prohibited` |
| `reversibility` | string | MUST | One of `reversible-auto`, `reversible-manual`, `irreversible` |
| `parameters.schema` | JSON Schema | MUST | Schema for action parameters |
| `blast_radius` | object | MUST | Declaration of what the action affects |
| `preconditions` | array | MAY | Preconditions that MUST pass before authorisation |
| `execution.binding` | string | MUST | Execution mechanism (`webhook`, `command`, `kubernetes`, `noop`) |
| `execution.endpoint` | string | MUST (if binding requires) | Named endpoint in executor configuration |
| `execution.timeout` | duration | SHOULD | Maximum execution time |
| `verification` | object | MAY | How to determine whether the action achieved its effect |
| `rollback` | object | MAY | Reference to an action that undoes this one |
| `allowed_principals` | array | MAY | Restriction on which principal types may request this action |

### 4.3 Blast Radius

Blast radius declares what an action affects. The authorisation component MUST reject capability requests whose resolved parameters would operate outside the declared blast radius, and the executor MUST enforce the same boundary at execution time.

```yaml
blast_radius:
  services: [payment-service, payment-worker]   # MUST
  environments: [production, staging]            # MUST
  regions: [eu-west-1, us-east-1]               # MAY
  resources:                                     # MAY
    type: kubernetes-deployment
    namespace: payments
    names: [payment-service, payment-worker]
```

| Field | Required | Description |
|-------|----------|-------------|
| `services` | MUST | Services the action may affect. At least one. |
| `environments` | MUST | Environments in which the action may be executed. |
| `regions` | MAY | Regional scope limitation. |
| `resources` | MAY | Specific infrastructure resources. |

An action with `blast_radius.services: [payment-service]` cannot affect `checkout-service` even if a principal attempts to pass `checkout-service` as a parameter. The authorisation component validates that every referenced service in the parameter set is within the declared blast radius.

### 4.4 Preconditions

Preconditions are declarative, deterministic checks evaluated at authorisation time. The following precondition types are defined:

| Type | Parameters | Description |
|------|-----------|-------------|
| `no-change-freeze` | (none) | Rejects if a change freeze is active for the target service or environment |
| `rate-limit` | `max`, `window` | Rejects if the action has been executed more than `max` times in `window` |
| `error-budget-available` | `slo`, `threshold` | Rejects if the specified SLO's error budget is below `threshold` |
| `no-active-incident` | `services?` | Rejects if an active incident exists on the target service (or listed services) |
| `slo-healthy` | `slo` | Rejects if the specified SLO is currently breaching |
| `principal-attribute` | `attribute`, `value` | Rejects if the principal lacks a specified attribute value |
| `time-window` | `allowed_hours_utc`, `allowed_days` | Rejects outside a time window (e.g., business hours only) |
| `approval-required` | (none, implicit in approval_level) | Rejects until approval is recorded |

Implementations MAY add custom precondition types. Custom preconditions MUST be deterministic and their evaluation MUST be logged in the capability verdict for audit.

```yaml
preconditions:
  - type: no-change-freeze
  - type: rate-limit
    max: 2
    window: 1h
  - type: error-budget-available
    slo: availability
    threshold: 0.10          # 10% of budget must remain
  - type: no-active-incident
  - type: time-window
    allowed_hours_utc: "07:00-19:00"
    allowed_days: [mon, tue, wed, thu, fri]
```

### 4.5 Approval Levels

Approval level defines how many principals must concur before a capability is issued.

| Level | Behaviour |
|-------|-----------|
| `autonomous` | Capability issued immediately if preconditions pass. No human approval required. |
| `single-human` | Capability issued after one human principal records an approving verdict on the action request. |
| `multi-human` | Capability issued after N human principals approve, where N is declared in `approval.count`. |
| `emergency` | Capability issued with a single human approval but requires MFA and generates an elevated audit record. For break-glass operations. |
| `prohibited` | Capability never issued. Action is documented but not executable. For migration staging or deprecated actions. |

```yaml
approval_level: multi-human
approval:
  count: 2
  require_distinct_teams: true    # MAY: approvers must be from different teams
  timeout: 30m                    # MAY: request expires if not approved
```

An action with `approval_level: autonomous` MAY still be requested by a human principal; the human's request is treated identically to an agent's request. The approval level sets a ceiling, not a floor.

### 4.6 Reversibility

| Classification | Meaning |
|---------------|---------|
| `reversible-auto` | Action can be rolled back automatically if verification fails. MUST have a `rollback` specification. |
| `reversible-manual` | Action can be undone through deliberate action but not automatically. |
| `irreversible` | Action cannot be undone. MUST NOT be declared with `approval_level: autonomous`. |

Implementations MUST reject manifests declaring `irreversible` actions with `autonomous` approval.

### 4.7 Verification

Verification specifies how the system determines whether an action achieved its intended effect. Verification is performed by the executor after action completion and recorded in the execution verdict.

```yaml
verification:
  type: slo-recovery
  slo: availability
  window: 5m
  threshold: 0.999         # SLO must recover to this level
```

Verification types:

| Type | Description |
|------|-------------|
| `slo-recovery` | SLO returns to threshold within window |
| `metric-range` | Named metric returns to specified range |
| `verdict-outcome` | A downstream verdict with specified type and status appears |
| `noop` | No verification (trust the executor's success signal) |

### 4.8 Rollback

When an action has `reversibility: reversible-auto` and verification fails, the executor MUST invoke the specified rollback action. Rollback invocations are themselves action requests that flow through authorisation — they do not bypass the authorisation layer, but they carry a reference to the failed execution that triggered them.

---

## 5. Authorisation Policy

Authorisation policies express cross-service and org-wide authorisation rules. While actions are defined per-service in service manifests, policies apply across the ecosystem.

### 5.1 Policy Document

```yaml
apiVersion: opensrm/v1
kind: AuthorisationPolicy
metadata:
  name: production-defaults
spec:
  scope:
    environments: [production]
  rules:
    - match:
        principal_type: agent
        action_reversibility: irreversible
      effect: deny
      reason: "AI agents may not request irreversible actions in production."
    - match:
        principal_type: human
        principal_mfa: false
        action_approval_level: emergency
      effect: deny
      reason: "Emergency actions require MFA."
    - match:
        action_id: rollback-deploy
      effect: require-role
      role: operator
```

### 5.2 Policy Structure

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | object | MAY | Limits which services/environments the policy applies to |
| `rules` | array | MUST | Ordered list of policy rules |
| `rules[].match` | object | MUST | Attributes that determine rule applicability |
| `rules[].effect` | string | MUST | One of `allow`, `deny`, `require-role`, `require-team`, `require-mfa` |
| `rules[].reason` | string | SHOULD | Human-readable explanation for audit |

### 5.3 Policy Evaluation

Policies are evaluated after service-level action preconditions pass and before capability issuance. Evaluation proceeds in order. Rules are matched against the full context of the request (principal, action, service, parameters, environment). The first matching rule determines the effect.

A `deny` effect immediately rejects the request with a denial verdict. `require-role`, `require-team`, and `require-mfa` add additional preconditions that MUST be satisfied before authorisation proceeds.

If no rule matches, the default effect is `allow` (subject to service-level preconditions and approval_level). This "permissive default" is intentional: policies are additive constraints layered over the per-service action declarations, which are themselves already restrictive.

---

## 6. Capability Tokens

### 6.1 Token Structure

A capability token is a short-lived, one-shot authorisation to execute a specific action with specific parameters. Tokens are signed by the authorisation component and verified by the executor.

```json
{
  "capability_id": "cap-2026-04-18-14-23-001",
  "action_id": "rollback-deploy",
  "service": "payment-service",
  "parameters": {
    "target_version": "d-4520"
  },
  "principal": {
    "type": "agent",
    "id": "nthlayer-respond/remediation@a8f2c1"
  },
  "approvals": [
    {
      "principal_id": "rob@workday.com",
      "verdict_hash": "sha256:abc123...",
      "timestamp": "2026-04-18T14:23:12Z"
    }
  ],
  "preconditions_evaluated": [
    {"type": "no-change-freeze", "result": "pass"},
    {"type": "rate-limit", "result": "pass", "current": 0, "max": 2}
  ],
  "issued_at": "2026-04-18T14:23:14Z",
  "expires_at": "2026-04-18T14:28:14Z",
  "issuer": "nthlayer-authorise@primary",
  "signature": "<ed25519-signature>"
}
```

### 6.2 Token Lifetime

Capability tokens MUST have a bounded lifetime. RECOMMENDED default is 5 minutes. Tokens SHOULD have a lifetime no longer than twice the action's declared execution timeout.

### 6.3 One-Shot Semantics

A capability token MUST be consumed at most once. The executor MUST reject tokens whose capability_id has already been consumed. Replay of a consumed token is a security incident and MUST be logged as a denial verdict with reason `capability-replay`.

### 6.4 Revocation

Capabilities SHOULD be revocable before execution. Revocation is performed by writing a revocation verdict referencing the capability_id. The executor MUST check for revocation verdicts before consuming a capability.

### 6.5 Signing

Capability tokens MUST be signed. Implementations SHOULD use Ed25519 or equivalent. Key management is implementation-defined but the authorisation component MUST be the sole holder of the signing key; no other component may mint capabilities.

---

## 7. Execution and Recording

### 7.1 Execution Responsibilities

The executor component consumes capability tokens and carries out actions. It MUST:

1. Verify the token signature.
2. Verify the token has not expired.
3. Verify the token has not been consumed.
4. Verify the token has not been revoked.
5. Resolve the action's execution binding and invoke it with the token's parameters.
6. Re-validate blast radius at invocation time.
7. Enforce the action's timeout.
8. Run verification if specified.
9. Trigger rollback if verification fails and reversibility is `reversible-auto`.
10. Write an execution verdict recording what happened.

### 7.2 Execution Binding Types

| Binding | Description |
|---------|-------------|
| `webhook` | HTTP POST to a named endpoint with parameters as body |
| `command` | Invocation of a named command-line tool with parameters as arguments |
| `kubernetes` | Kubernetes API invocation (scale, rollout, etc.) against the target resource |
| `noop` | No external effect; execution verdict is written without action |

Implementations MAY add custom binding types. Binding configuration (URLs, credentials, kubeconfig paths) lives in the executor's configuration, never in the OpenSRM manifest.

### 7.3 Execution Record

Every invocation produces an execution verdict containing:

- Reference to the capability token consumed
- Reference to the action request verdict
- Reference to the principal identity
- The parameters as executed
- The outcome (`succeeded`, `failed`, `timed-out`, `verification-failed`, `rolled-back`)
- The return value or error from the binding
- Verification result, if applicable
- Rollback capability reference, if triggered
- Duration

Execution verdicts are immutable and content-addressed, like all verdicts in the ecosystem.

---

## 8. Authorisation Flow

The complete flow from action request to executed action:

```
1. Principal (human or agent) produces a verdict proposing an action.
   - Agent: emits remediation verdict via nthlayer-respond
   - Human: renders verdict via nthlayer-bench or CLI
   Both produce an `action_request` verdict in the store.

2. nthlayer-authorise polls for new action_request verdicts.

3. For each request:
   a. Load the target service's OpenSRM manifest.
   b. Look up the action by id. If not found → denial verdict (reason: undeclared-action).
   c. Validate parameters against the action's schema. If invalid → denial verdict (reason: invalid-parameters).
   d. Validate blast radius. If parameters reference resources outside declared radius → denial verdict (reason: blast-radius-violation).
   e. Evaluate all preconditions. If any fail → denial verdict (reason: precondition-failed, with details).
   f. Evaluate authorisation policies. If any deny → denial verdict (reason: policy-denied).
   g. Check approval_level:
      - autonomous: proceed to issue capability
      - single-human / multi-human / emergency: check for approval verdicts. If insufficient → wait (no verdict written; re-evaluate on future polls).
   h. Issue capability token, write capability verdict.

4. nthlayer-executor polls for new capability verdicts.

5. For each capability:
   a. Verify signature, expiry, consumption, revocation.
   b. Resolve execution binding.
   c. Invoke the binding with parameters.
   d. Mark capability consumed.
   e. Run verification if specified.
   f. If verification fails and reversibility is reversible-auto, construct a rollback action_request and feed it back into step 1.
   g. Write execution verdict.

6. Downstream components (learn, correlate) observe execution verdicts and incorporate them into lineage.
```

### 8.1 Approval Sub-Flow

For actions requiring human approval, the flow pauses at step 3.g. The authorisation component does not write any verdict until approval is present. Instead:

1. A pending-authorisation record is created (not a verdict — this is transient state in the authorisation component).
2. The nthlayer-bench (or equivalent approval surface) polls for pending authorisations matching its operator's scope.
3. Operators render approval verdicts against the action_request.
4. nthlayer-authorise observes the approval verdicts and re-evaluates step 3.g.

This design keeps the verdict store clean of intermediate states: either a capability is issued or a denial is recorded. Pending state is ephemeral and does not pollute the audit chain.

---

## 9. Verdict Types

This extension introduces three new verdict types, all conforming to the existing content-addressed verdict schema.

### 9.1 action_request

Written by a principal proposing an action.

```json
{
  "verdict_type": "action_request",
  "hash": "sha256:...",
  "timestamp": "2026-04-18T14:23:05Z",
  "service": "payment-service",
  "principal": {
    "type": "agent",
    "id": "nthlayer-respond/remediation@a8f2c1"
  },
  "data": {
    "action_id": "rollback-deploy",
    "parameters": {
      "target_version": "d-4520"
    },
    "reasoning": "Deploy d-4521 correlated with availability SLO breach; reversal to last-known-good version.",
    "input_hashes": ["sha256:xyz..."]
  }
}
```

### 9.2 capability

Written by `nthlayer-authorise` when a request is approved.

```json
{
  "verdict_type": "capability",
  "hash": "sha256:...",
  "timestamp": "2026-04-18T14:23:14Z",
  "service": "payment-service",
  "agent": "nthlayer-authorise",
  "data": {
    "capability_id": "cap-2026-04-18-14-23-001",
    "action_request_hash": "sha256:...",
    "action_id": "rollback-deploy",
    "parameters": {...},
    "principal": {...},
    "approvals": [...],
    "preconditions_evaluated": [...],
    "expires_at": "2026-04-18T14:28:14Z",
    "signature": "..."
  }
}
```

### 9.3 denial

Written by `nthlayer-authorise` when a request is rejected.

```json
{
  "verdict_type": "denial",
  "hash": "sha256:...",
  "timestamp": "2026-04-18T14:23:06Z",
  "service": "payment-service",
  "agent": "nthlayer-authorise",
  "data": {
    "action_request_hash": "sha256:...",
    "action_id": "rollback-deploy",
    "principal": {...},
    "reason": "precondition-failed",
    "details": {
      "precondition_type": "rate-limit",
      "current": 2,
      "max": 2,
      "window": "1h"
    }
  }
}
```

### 9.4 execution

Written by `nthlayer-executor` after attempting an action.

```json
{
  "verdict_type": "execution",
  "hash": "sha256:...",
  "timestamp": "2026-04-18T14:23:45Z",
  "service": "payment-service",
  "agent": "nthlayer-executor",
  "data": {
    "capability_hash": "sha256:...",
    "action_id": "rollback-deploy",
    "parameters": {...},
    "outcome": "succeeded",
    "binding_response": {
      "status_code": 200,
      "body": {"deployment_id": "d-4520-rollback-001"}
    },
    "verification_result": {
      "type": "slo-recovery",
      "status": "passed",
      "measured_at": "2026-04-18T14:28:45Z",
      "current_availability": 0.9995
    },
    "duration_seconds": 28,
    "input_hashes": ["sha256:..."]
  }
}
```

### 9.5 approval

Written by a human principal approving an action request. Approval is a distinct verdict type rather than a reuse of `action_request` to keep the approval lineage explicit.

```json
{
  "verdict_type": "approval",
  "hash": "sha256:...",
  "timestamp": "2026-04-18T14:23:12Z",
  "service": "payment-service",
  "principal": {
    "type": "human",
    "id": "rob@workday.com",
    "mfa": true
  },
  "data": {
    "action_request_hash": "sha256:...",
    "decision": "approve",
    "reasoning": "Deploy clearly correlates with breach; rollback is the correct action.",
    "confidence": "high"
  }
}
```

A rejection is the same schema with `decision: "reject"` and MUST include reasoning.

---

## 10. Integration with OpenSRM v1

### 10.1 Additive Only

This extension adds fields to existing OpenSRM v1 documents; it does not modify existing fields. A v1-only consumer encountering a manifest with an `actions` block MUST ignore the block without error. A v1-only manifest (no actions block) is valid under this extension and simply has no authorisable actions.

### 10.2 New Fields in Service Manifests

| Field | Location | Description |
|-------|----------|-------------|
| `spec.actions` | Service manifest | Array of action definitions |

### 10.3 New Document Kinds

| Kind | Description |
|------|-------------|
| `AuthorisationPolicy` | Cross-service authorisation rules |

### 10.4 Tier-Based Defaults

Services MAY inherit default action declarations from their tier template. Recommended tier defaults:

| Tier | Recommended actions |
|------|---------------------|
| `critical` | `rollback-deploy` (single-human), `scale-up` (autonomous, rate-limited), declared irreversibles with `prohibited` |
| `standard` | `rollback-deploy` (autonomous), `scale-up` (autonomous), `restart` (autonomous) |
| `low` | `restart` (autonomous) |

These are recommendations; organisations configure their own tier policies.

---

## 11. Component Responsibilities

### 11.1 nthlayer-authorise

A new component. Responsibilities:

1. Watch the verdict store for new `action_request` and `approval` verdicts.
2. Load OpenSRM manifests and AuthorisationPolicy documents.
3. Evaluate preconditions, policies, and approval sufficiency.
4. Issue capability tokens or write denial verdicts.
5. Manage ephemeral pending-authorisation state for requests awaiting approval.
6. Hold the capability signing key.

This component does not execute actions. It does not hold credentials for target systems. Its blast radius is limited to writing capability and denial verdicts.

### 11.2 nthlayer-executor

A new component. Responsibilities:

1. Watch the verdict store for new `capability` verdicts.
2. Verify capability tokens before consumption.
3. Invoke execution bindings.
4. Enforce blast radius at invocation time.
5. Run verification.
6. Construct rollback action_requests if required.
7. Write execution verdicts.

This component holds credentials for target systems (Kubernetes kubeconfig, webhook credentials, etc.). It is the only component in the ecosystem with write access to production systems.

### 11.3 nthlayer-respond

Updated responsibilities. Respond's remediation agent now emits `action_request` verdicts rather than directly invoking remediation. The existing HTTP approval server becomes a thin approval surface that writes `approval` verdicts on behalf of Slack-based approvers; the primary approval surface is the Bench.

### 11.4 nthlayer-bench

Updated responsibilities. The Bench presents pending authorisations as cases (see Bench spec §6) and writes `approval` verdicts on operator action.

### 11.5 Telemetry

All components SHOULD emit OpenTelemetry events for authorisation decisions:

| Event | Attributes |
|-------|-----------|
| `nthlayer.authorisation.requested` | action_id, principal.type, principal.id, service |
| `nthlayer.authorisation.granted` | action_id, capability_id, principal.type, duration |
| `nthlayer.authorisation.denied` | action_id, principal.type, reason |
| `nthlayer.execution.started` | capability_id, action_id |
| `nthlayer.execution.completed` | capability_id, action_id, outcome, duration |

---

## 12. JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://opensrm.io/schema/rbac-extension/v1",
  "title": "OpenSRM RBAC Extension",
  "description": "Action authorisation schema for OpenSRM manifests and authorisation policies",

  "definitions": {
    "ApprovalLevel": {
      "type": "string",
      "enum": ["autonomous", "single-human", "multi-human", "emergency", "prohibited"]
    },

    "Reversibility": {
      "type": "string",
      "enum": ["reversible-auto", "reversible-manual", "irreversible"]
    },

    "ExecutionBinding": {
      "type": "string",
      "enum": ["webhook", "command", "kubernetes", "noop"]
    },

    "PrincipalType": {
      "type": "string",
      "enum": ["human", "agent", "system"]
    },

    "BlastRadius": {
      "type": "object",
      "required": ["services", "environments"],
      "properties": {
        "services": {
          "type": "array",
          "items": {"type": "string"},
          "minItems": 1
        },
        "environments": {
          "type": "array",
          "items": {"type": "string"},
          "minItems": 1
        },
        "regions": {
          "type": "array",
          "items": {"type": "string"}
        },
        "resources": {
          "type": "object",
          "properties": {
            "type": {"type": "string"},
            "namespace": {"type": "string"},
            "names": {
              "type": "array",
              "items": {"type": "string"}
            }
          }
        }
      }
    },

    "Precondition": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": {"type": "string"}
      },
      "additionalProperties": true
    },

    "ApprovalConfig": {
      "type": "object",
      "properties": {
        "count": {"type": "integer", "minimum": 1},
        "require_distinct_teams": {"type": "boolean"},
        "require_mfa": {"type": "boolean"},
        "timeout": {"type": "string"}
      }
    },

    "Verification": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": {
          "type": "string",
          "enum": ["slo-recovery", "metric-range", "verdict-outcome", "noop"]
        }
      },
      "additionalProperties": true
    },

    "Rollback": {
      "type": "object",
      "required": ["action_id"],
      "properties": {
        "action_id": {"type": "string"},
        "derive_parameters": {"type": "string"}
      }
    },

    "Action": {
      "type": "object",
      "required": [
        "id", "description", "approval_level", "reversibility",
        "parameters", "blast_radius", "execution"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$"
        },
        "description": {"type": "string"},
        "approval_level": {"$ref": "#/definitions/ApprovalLevel"},
        "reversibility": {"$ref": "#/definitions/Reversibility"},
        "parameters": {
          "type": "object",
          "required": ["schema"],
          "properties": {
            "schema": {"type": "object"}
          }
        },
        "blast_radius": {"$ref": "#/definitions/BlastRadius"},
        "preconditions": {
          "type": "array",
          "items": {"$ref": "#/definitions/Precondition"}
        },
        "approval": {"$ref": "#/definitions/ApprovalConfig"},
        "execution": {
          "type": "object",
          "required": ["binding"],
          "properties": {
            "binding": {"$ref": "#/definitions/ExecutionBinding"},
            "endpoint": {"type": "string"},
            "timeout": {"type": "string"}
          }
        },
        "verification": {"$ref": "#/definitions/Verification"},
        "rollback": {"$ref": "#/definitions/Rollback"},
        "allowed_principals": {
          "type": "array",
          "items": {"$ref": "#/definitions/PrincipalType"}
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {"reversibility": {"const": "irreversible"}}
          },
          "then": {
            "properties": {
              "approval_level": {
                "not": {"const": "autonomous"}
              }
            }
          }
        }
      ]
    },

    "PolicyMatch": {
      "type": "object",
      "properties": {
        "principal_type": {"$ref": "#/definitions/PrincipalType"},
        "principal_mfa": {"type": "boolean"},
        "principal_team": {"type": "string"},
        "action_id": {"type": "string"},
        "action_reversibility": {"$ref": "#/definitions/Reversibility"},
        "action_approval_level": {"$ref": "#/definitions/ApprovalLevel"},
        "service": {"type": "string"},
        "environment": {"type": "string"}
      }
    },

    "PolicyRule": {
      "type": "object",
      "required": ["match", "effect"],
      "properties": {
        "match": {"$ref": "#/definitions/PolicyMatch"},
        "effect": {
          "type": "string",
          "enum": ["allow", "deny", "require-role", "require-team", "require-mfa"]
        },
        "role": {"type": "string"},
        "team": {"type": "string"},
        "reason": {"type": "string"}
      }
    },

    "AuthorisationPolicy": {
      "type": "object",
      "required": ["apiVersion", "kind", "metadata", "spec"],
      "properties": {
        "apiVersion": {"const": "opensrm/v1"},
        "kind": {"const": "AuthorisationPolicy"},
        "metadata": {
          "type": "object",
          "required": ["name"],
          "properties": {
            "name": {"type": "string"}
          }
        },
        "spec": {
          "type": "object",
          "required": ["rules"],
          "properties": {
            "scope": {
              "type": "object",
              "properties": {
                "services": {
                  "type": "array",
                  "items": {"type": "string"}
                },
                "environments": {
                  "type": "array",
                  "items": {"type": "string"}
                }
              }
            },
            "rules": {
              "type": "array",
              "items": {"$ref": "#/definitions/PolicyRule"},
              "minItems": 1
            }
          }
        }
      }
    }
  }
}
```

---

## 13. Examples

### 13.1 Critical Service with Rollback and Scale Actions

```yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: payment-service
  tier: critical
spec:
  type: api
  # ... existing spec fields ...

  actions:
    - id: rollback-deploy
      description: "Roll the service back to the previous deployment."
      approval_level: single-human
      reversibility: reversible-manual
      parameters:
        schema:
          type: object
          properties:
            target_version:
              type: string
              pattern: "^d-[0-9]+$"
          required: [target_version]
      blast_radius:
        services: [payment-service]
        environments: [production]
      preconditions:
        - type: no-change-freeze
        - type: rate-limit
          max: 3
          window: 1h
      execution:
        binding: webhook
        endpoint: deploy-service
        timeout: 60s
      verification:
        type: slo-recovery
        slo: availability
        window: 5m
        threshold: 0.999

    - id: scale-up
      description: "Increase replicas by a specified factor."
      approval_level: autonomous
      reversibility: reversible-auto
      parameters:
        schema:
          type: object
          properties:
            factor:
              type: number
              minimum: 1.1
              maximum: 3.0
          required: [factor]
      blast_radius:
        services: [payment-service]
        environments: [production]
      preconditions:
        - type: rate-limit
          max: 5
          window: 1h
      execution:
        binding: kubernetes
        endpoint: prod-cluster
        timeout: 30s
      verification:
        type: metric-range
        metric: replica_count
        window: 2m
      rollback:
        action_id: scale-down
        derive_parameters: original_count

    - id: drop-traffic
      description: "Immediately remove this service from load balancer. Outage-level action."
      approval_level: emergency
      reversibility: reversible-manual
      parameters:
        schema:
          type: object
      blast_radius:
        services: [payment-service]
        environments: [production]
      execution:
        binding: webhook
        endpoint: load-balancer
        timeout: 10s
```

### 13.2 Production Authorisation Policy

```yaml
apiVersion: opensrm/v1
kind: AuthorisationPolicy
metadata:
  name: production-defaults
spec:
  scope:
    environments: [production]
  rules:
    - match:
        principal_type: agent
        action_reversibility: irreversible
      effect: deny
      reason: "AI agents may not request irreversible actions in production."

    - match:
        action_approval_level: emergency
        principal_mfa: false
      effect: deny
      reason: "Emergency actions require MFA."

    - match:
        action_id: drop-traffic
      effect: require-team
      team: sre
      reason: "Only SRE team members may drop traffic from production services."

    - match:
        principal_type: agent
        action_approval_level: autonomous
      effect: allow
      reason: "Agents may request autonomous actions subject to service-level preconditions."
```

### 13.3 AI Gate Service Actions

```yaml
apiVersion: opensrm/v1
kind: ServiceReliabilityManifest
metadata:
  name: code-review-bot
  tier: standard
spec:
  type: ai-gate
  # ... existing ai-gate spec ...

  actions:
    - id: reduce-autonomy
      description: "Reduce the agent's autonomy level following quality degradation."
      approval_level: autonomous
      reversibility: reversible-manual
      parameters:
        schema:
          type: object
          properties:
            new_level:
              type: string
              enum: [observation-only, human-in-loop, suspended]
          required: [new_level]
      blast_radius:
        services: [code-review-bot]
        environments: [production, staging]
      preconditions:
        - type: rate-limit
          max: 2
          window: 24h
      execution:
        binding: webhook
        endpoint: agent-config-service
        timeout: 30s

    - id: restore-autonomy
      description: "Restore the agent's autonomy to full. Requires human approval."
      approval_level: single-human
      reversibility: reversible-manual
      parameters:
        schema:
          type: object
          properties:
            reason:
              type: string
              minLength: 20
          required: [reason]
      blast_radius:
        services: [code-review-bot]
        environments: [production, staging]
      execution:
        binding: webhook
        endpoint: agent-config-service
        timeout: 30s
      allowed_principals: [human]
```

---

## 14. Security Considerations

### 14.1 Trust Boundaries

The security model rests on three trust boundaries:

1. **Principal identity.** The authorisation component trusts the identity provider to correctly identify principals. Compromise of the identity provider compromises the authorisation system.
2. **Capability signing key.** The authorisation component is the sole holder of the signing key. Compromise of this key allows arbitrary capability minting. Keys SHOULD be stored in a hardware security module or equivalent.
3. **Executor credentials.** The executor holds credentials for target systems. Compromise of the executor allows arbitrary action execution regardless of authorisation.

### 14.2 Replay Prevention

Capability tokens are one-shot. Tokens include a capability_id that MUST be recorded by the executor upon consumption. Replay of a consumed token MUST be rejected and logged as a security event.

### 14.3 Time-of-Check to Time-of-Use (TOCTOU)

Preconditions are evaluated at authorisation time. Between authorisation and execution, the state of the system may change (a change freeze may begin, an incident may open). Implementations SHOULD re-evaluate critical preconditions at execution time; at minimum, blast radius MUST be re-validated when parameters are applied.

### 14.4 Audit Completeness

Every action request, approval, denial, capability, and execution is a verdict. The audit chain from request to execution to outcome is reconstructable by walking verdict lineage. Implementations MUST NOT execute actions without recording an execution verdict; a failure to record an execution MUST cause the action to fail closed.

### 14.5 Escalation Through Approval

Approval chains must not permit elevation beyond the requesting principal's authority. An agent cannot gain capabilities a human could not grant: a human approver can only grant what their own policies allow. Implementations MUST evaluate policies against both the approver and the requesting principal.

### 14.6 Denial of Service

The authorisation component is in the critical path of all actions. Implementations SHOULD rate-limit action_request processing per-principal to prevent denial-of-service against the authorisation pipeline.

---

## 15. Migration from Informal Safe Actions

Organisations currently using nthlayer-respond's pre-formal "safe action" declarations should migrate as follows:

1. **Phase 1: Parallel operation.** Existing safe action declarations continue to work. New manifests MAY add `actions` blocks. The authorisation component is not yet deployed.

2. **Phase 2: Shadow authorisation.** Deploy nthlayer-authorise in shadow mode. Every remediation verdict is also emitted as an action_request. Authorise evaluates the request and writes capability or denial verdicts, but nthlayer-respond continues to execute via the old path. The shadow verdicts are the audit artifact, used to validate the authorisation model against real traffic.

3. **Phase 3: Cutover.** nthlayer-respond stops invoking remediation directly. All remediation flows through the authorisation/executor path. Legacy safe action declarations are converted to v1 `actions` blocks with equivalent semantics. Autonomous actions retain autonomous approval level; human-gated actions become single-human.

4. **Phase 4: Policy tightening.** With the new authorisation layer in place, organisations add AuthorisationPolicy documents to enforce cross-service constraints. This is where the model's value over the legacy system becomes visible.

The shadow mode in phase 2 is essential: it lets organisations validate that the new authorisation model matches the effective behaviour of the legacy system before cutting over. Mismatches during shadow operation are investigated and resolved before phase 3.

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **Principal** | The entity requesting an action. Human, agent, or system. |
| **Action** | A declared operation that may be taken against a service. |
| **Capability Token** | A short-lived, one-shot authorisation to execute a specific action. |
| **Precondition** | A declarative, deterministic check evaluated at authorisation time. |
| **Blast Radius** | Declaration of what resources an action affects. |
| **Approval Level** | How many principals must concur before a capability is issued. |
| **Reversibility** | Whether an action can be undone (automatically, manually, or not at all). |
| **Verification** | How the executor determines whether an action achieved its effect. |
| **Authorisation Policy** | Cross-service rules that augment per-service action declarations. |
| **Shadow Mode** | Parallel operation during migration where the new system observes without acting. |

---

## Appendix B: Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0-draft | 2026-04 | Initial draft. Unified human/agent authorisation model. |

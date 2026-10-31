# OpenSRM v2 — Provider Profile: Claude Platform

**Status:** Draft for review
**Profile of:** `OPENSRM-TELEMETRY-ADDENDUM-v2.md` (Addendum A1) §7
**Provider:** Anthropic Claude Platform, including Claude Platform on AWS
**Upstream pin:** `semantic-conventions-genai` commit `e57c543b` (2026-09-24)
**Provider source:** Anthropic, *OpenTelemetry span reference* (beta), as published 2026-10-21
**Date:** 2026-10-31

---

This profile binds the provider-neutral purposes of Addendum A1 §6 to the spans and attributes Claude Platform emits. It is normative for an implementation that consumes Claude Platform telemetry and has no effect on any other provider. Section references of the form "§n" are to Addendum A1 unless marked otherwise.

## 1. Attribute binding

| OpenSRM purpose | Claude Platform attribute(s) | Span(s) | Rule |
|---|---|---|---|
| Provenance (P1, P5) | trace id and span id; `anthropic.request.id`; `gen_ai.response.id` | `anthropic.model_request`; `anthropic.messages.create` (`SERVER`) | Reference the `SERVER` request span (P5). Its `anthropic.model_request` child MAY be referenced where the `SERVER` span was not received. |
| Lineage discovery (6.1) | `gen_ai.conversation.id` (thread), `anthropic.session.id` (session), `anthropic.session.thread.id` (SDK tool runner) | session and turn spans | Discovery only. A session's spans span several traces; group by id, not by trace. |
| Decision identity (6.2) | `gen_ai.agent.id`, `gen_ai.agent.name`, `gen_ai.tool.call.id` | `anthropic.session.turn`, tool spans | `gen_ai.agent.name` is `anthropic.advisor` on an advisor thread; an advisor is not a gate. |
| Tenancy / segment | `anthropic.organization.id`, `anthropic.workspace.id` | every request span | MAY serve as a `segment_dimension` when the manifest declares it. |
| Autonomy (6.3) | `anthropic.tool.evaluated_permission` ∈ `allow`, `ask` | API tool spans in Managed Agents | As 6.3. Denied tool uses emit no span. |
| Escalation check (6.4) | `anthropic.session.turn.stop_reason` = `requires_action`, with `gen_ai.tool.name` | `anthropic.session.turn` | Check only; never count. |
| Grader (4.4, A4) | `anthropic.session.outcome_evaluation.result` ∈ `satisfied`, `needs_revision`, `max_iterations_reached`, `failed`, `interrupted`; `.explanation`; `anthropic.session.outcome.id` | `anthropic.session.outcome_evaluation` | Ingest as a `gen_ai.evaluation.result` with `nthlayer.evaluator.kind: provider`. Labels are this profile's own (A1 §4.4): `satisfied` → label `pass`; `needs_revision`, `max_iterations_reached`, `failed` → `fail`; `interrupted` → no verdict (A1 §4.4). Set `nthlayer.decision.id` when the session's provenance (A1 §5) resolves to a decision record; nothing on this span carries one. Self-grading. |
| Stability (6.5) | `gen_ai.response.model`, `gen_ai.request.model`, `anthropic.response.service_tier`, `anthropic.request.service_tier`, `gen_ai.request.temperature`, `gen_ai.request.top_p`, `gen_ai.request.top_k`, `gen_ai.request.reasoning.level`, `anthropic.thinking.type`, `anthropic.thinking.budget_tokens`, `anthropic.beta` | `anthropic.messages.create`, `anthropic.model_request` | Pin and record per S1. |
| Classical SLIs (6.6) | span duration, `http.response.status_code`, `error.type`, `gen_ai.response.time_to_first_chunk`, `http.request.resend_count` | request spans | Internal SLOs only (A3). |
| Cost (6.7) | `gen_ai.usage.*`, `anthropic.usage.cache_creation.ephemeral_5m_input_tokens`, `anthropic.usage.cache_creation.ephemeral_1h_input_tokens`, `anthropic.usage.compaction.input_tokens`, `anthropic.usage.compaction.output_tokens`, `gen_ai.usage.reasoning.output_tokens` | `anthropic.messages.create`, `anthropic.model_request`, `anthropic.compaction`, `anthropic.session.outcome_evaluation` | Count per §3 of this profile. |
| Audit content (6.8) | `gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.call.arguments`, `anthropic.tool_result.content`, `anthropic.content.truncated` | request, turn and tool spans | Content mode only. |

## 2. Coverage caveats an implementation MUST account for

- API-side spans exist only for Claude Platform and Claude Platform on AWS. Requests through the Bedrock or Vertex AI clients produce SDK spans only (`gen_ai.provider.name` is `aws.bedrock` or `gcp.vertex_ai`), with no `anthropic.model_request` children and no API-run tool spans.
- The API emits no span for the OpenAI-compatible endpoint.
- The API emits no tool span when the model asks for a tool the application runs, when a tool runs in a self-hosted sandbox, for multiagent or advisor tools, or when a tool use is denied.
- Thinking content is absent from Managed Agents spans.
- Span delivery is best-effort; a caller can unset the sampled flag; spans can arrive more than once. A3 applies. For a complete record of usage, the provider directs implementations to its Usage API.
- Under a HIPAA, FERPA or K-12 restriction the provider exports metadata only, whatever the destination's content mode. Audit content (6.8) is then unavailable from spans.
- Span names and attributes can change during the provider's beta.

## 3. Token counting

To count each token once: when a request has both an SDK `CLIENT` span and an API `SERVER` span, sum the API spans. Within API spans for a Messages request, sum either the `anthropic.messages.create` spans or their `anthropic.model_request` children, not both; add `anthropic.compaction` spans and do not also add the `anthropic.usage.compaction.*` attributes. For a Managed Agents session, sum `anthropic.model_request` and `anthropic.session.outcome_evaluation`. `gen_ai.usage.input_tokens` already includes cache reads and writes.

## 4. References

- Anthropic, *OpenTelemetry for the Claude API* and *OpenTelemetry span reference* (beta), https://platform.claude.com/docs/en/manage-claude/opentelemetry and https://platform.claude.com/docs/en/api/opentelemetry/spans
- OpenTelemetry GenAI semantic conventions, https://github.com/open-telemetry/semantic-conventions-genai, pinned at commit `e57c543b` (2026-09-24)
- `OPENSRM-TELEMETRY-ADDENDUM-v2.md` in this repository

## 5. Revision history

| Version | Date | Pin | Changes |
|---|---|---|---|
| 1-draft | 2026-10-31 | `e57c543b` | Initial profile, split out of Addendum A1-draft §7 (2026-10-21). One change: a grader `interrupted` result maps to *no verdict* (A1 §4.4) rather than the undefined "not evaluable". |

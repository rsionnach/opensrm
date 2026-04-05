# LLM Retry Logic — Transient Error Resilience in `llm_call`

**Date:** 2026-04-04
**Bead:** opensrm-gcg
**Status:** Design approved, ready for implementation plan

## Problem

`llm_call` raises `LLMError` on any HTTP error with no distinction between transient and permanent failures. A single 429 (rate limit) or 503 (overloaded) immediately degrades reasoning in whatever agent called it. Every component that uses `llm_call` — measure, correlate, respond — is equally fragile. The fix belongs inside `llm_call` because status code classification is a property of the HTTP interaction, not the caller's domain logic.

## Design

### Signature Change

```python
def llm_call(
    system: str,
    user: str,
    model: str | None = None,
    max_tokens: int = 2000,
    timeout: int | None = None,
    retry: int = 3,           # max retry attempts for transient errors
) -> LLMResponse:
```

Default `retry=3`. Existing callers get resilience for free. `retry=0` disables retries.

### Status Code Classification

Before raising `LLMError`, classify the HTTP status code:

| Category | Codes / Exceptions | Behavior |
|----------|-------------------|----------|
| Transient | 429, 502, 503, 408 | Retry with backoff |
| Transient (network) | `httpx.TimeoutException`, `httpx.ConnectError`, `httpx.RemoteProtocolError` | Retry with backoff |
| Permanent | 400, 401, 403, 404, 422 | Raise `LLMError` immediately |
| Unknown 5xx | 500, 504, any other 5xx | Retry with backoff |

**Note on 500:** Some providers return 500 for genuinely permanent problems (malformed request that their validation missed). But you can't distinguish that from a transient internal error at the HTTP layer, so retrying is the safer default. A code comment should note this trade-off to prevent a future reader from "fixing" it.

Classification is a simple function:

```python
_TRANSIENT_STATUS_CODES = frozenset({429, 408, 502, 503})
_PERMANENT_STATUS_CODES = frozenset({400, 401, 403, 404, 422})

def _is_transient(status_code: int) -> bool:
    if status_code in _TRANSIENT_STATUS_CODES:
        return True
    if status_code in _PERMANENT_STATUS_CODES:
        return False
    # Unknown 5xx: assume transient (see note above about 500)
    return status_code >= 500
```

Network-level exceptions (`TimeoutException`, `ConnectError`, `RemoteProtocolError`) are always transient — DNS blips, connection resets, and incomplete responses don't surface as HTTP status codes but are retryable by nature.

### Backoff Calculation

Full jitter to avoid thundering herd:

```python
import random

base = 1.0  # 1 second base
delay_cap = min(base * (2 ** attempt), 30.0)  # exponential, cap at 30s
delay = random.uniform(0, delay_cap)           # full jitter: [0, cap)
```

Full jitter means the actual delay ranges from 0 to the cap. Three agents all hitting a 429 simultaneously spread across the entire window rather than all waiting at least the base delay.

### `Retry-After` Header

429 responses often include a `Retry-After` header. Parse it and use as a floor:

```python
delay = max(delay, retry_after_seconds)
```

Supports both formats:
- Integer seconds: `Retry-After: 2`
- HTTP-date: `Retry-After: Thu, 04 Apr 2026 10:15:00 GMT` (converted to seconds delta)

If parsing fails, ignore the header and use calculated backoff.

### Timeout Budget Check

Before sleeping for a retry, check if there's enough time remaining:

```python
elapsed = time.monotonic() - start_time
remaining = total_timeout - elapsed
if delay > remaining:
    # Don't bother sleeping — the caller will cancel us anyway
    raise LLMError(...)
```

This applies to both the calculated backoff AND `Retry-After`. If you're on attempt 3 with a 30s cap and the caller has 8 seconds left, raise immediately instead of sleeping only to be cancelled.

`total_timeout` is the `timeout` parameter passed to `llm_call` (or the `NTHLAYER_LLM_TIMEOUT` default). This is the same timeout used for the httpx call, so it's the natural budget ceiling.

### Retry Loop Structure

```python
def llm_call(system, user, model=None, max_tokens=2000, timeout=None, retry=3):
    model = model or DEFAULT_MODEL
    _timeout = timeout if timeout is not None else TIMEOUT

    # ... API key guard (before retry loop) ...
    # ... parse provider ...

    start_time = time.monotonic()
    last_error = None

    for attempt in range(retry + 1):  # attempt 0 is the first call
        try:
            # ... call provider ...
            return LLMResponse(...)

        except httpx.HTTPStatusError as e:
            if not _is_transient(e.response.status_code):
                # Permanent error — fail immediately
                raise LLMError(...) from e
            last_error = e
            retry_after = _parse_retry_after(e.response)

        except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as e:
            last_error = e
            retry_after = 0

        except Exception as e:
            # Unknown errors are not retried
            raise LLMError(...) from e

        if attempt >= retry:
            break  # exhausted retries

        # Calculate backoff with full jitter
        delay_cap = min(1.0 * (2 ** attempt), 30.0)
        delay = random.uniform(0, delay_cap)
        delay = max(delay, retry_after)

        # Timeout budget check
        elapsed = time.monotonic() - start_time
        remaining = _timeout - elapsed
        if delay > remaining or remaining <= 0:
            break  # not enough time for another attempt

        logger.warning(
            "LLM call failed (attempt %d/%d, %s, retrying in %.1fs): %s",
            attempt + 1, retry + 1, "transient", delay, _describe_error(last_error),
        )
        time.sleep(delay)

    # All retries exhausted
    raise LLMError(...) from last_error
```

### Logging

Each retry logs a warning with the classification:

```
LLM call failed (attempt 1/4, transient, retrying in 1.3s): HTTP 429
LLM call failed (attempt 2/4, transient, retrying in 3.7s): HTTP 429
LLM call failed (attempt 3/4, transient, retrying in 2.1s): HTTP 503
```

Permanent failures log at the same level but with the permanent label:

```
LLM call failed (permanent, failing): HTTP 401
```

The classification in the log (`transient`/`permanent`) makes log triage much faster — you immediately see whether the failure was retried or not.

### `LLMError` Enrichment

Add an optional `status_code` field to `LLMError`:

```python
class LLMError(Exception):
    def __init__(self, message, provider, model, cause=None, status_code=None):
        self.provider = provider
        self.model = model
        self.cause = cause
        self.status_code = status_code  # NEW: HTTP status code if available
        super().__init__(f"[{provider}/{model}] {message}")
```

This lets callers distinguish "model said something wrong" from "couldn't reach the model" without parsing the message string. Backward compatible — defaults to `None`.

## Components

### Modified Files

- `nthlayer-common/src/nthlayer_common/llm.py` — retry loop, status code classification, `Retry-After` parsing, backoff with full jitter, timeout budget check, logging, `LLMError.status_code`
- `nthlayer-common/tests/test_llm.py` — tests for retry behavior, classification, backoff, `Retry-After` parsing

### Not Changed

- `_call_anthropic` and `_call_openai_compat` — unchanged (they still raise `httpx.HTTPStatusError`)
- `LLMResponse` — unchanged
- All callers (measure, correlate, respond agents) — get `retry=3` for free, no code changes
- `nthlayer-respond` agents' `asyncio.wait_for` timeout — still acts as hard ceiling

### New Dependencies

None. Uses `time`, `random`, `logging` from stdlib. `httpx` is already a dependency.

## Verification

1. **Transient retry:** Mock httpx to return 429 twice then 200 — `llm_call` returns successfully after 2 retries
2. **Permanent failure:** Mock httpx to return 401 — `llm_call` raises `LLMError` immediately with `status_code=401`, no retry
3. **Retry exhaustion:** Mock httpx to return 503 forever — `llm_call` retries 3 times then raises `LLMError`
4. **Retry-After header:** Mock 429 with `Retry-After: 5` — backoff uses at least 5s
5. **Timeout budget:** Set `timeout=2`, mock 429 with `Retry-After: 10` — raises immediately without sleeping
6. **Connection error retry:** Mock `httpx.ConnectError` then 200 — `llm_call` retries and succeeds
7. **retry=0:** `llm_call(retry=0)` with 429 — raises immediately, no retry
8. **Backward compat:** All existing `test_llm.py` tests pass unchanged

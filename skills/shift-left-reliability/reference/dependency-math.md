# Dependency Math

## Serial Availability

When requests flow through multiple services in sequence:

```
User → A → B → C → Database

Combined availability = A × B × C × DB
```

Example:
- A: 99.9%
- B: 99.9%
- C: 99.9%
- DB: 99.95%

Combined: 0.999 × 0.999 × 0.999 × 0.9995 = **99.65%**

You cannot promise 99.9% if your chain only delivers 99.65%.

## Parallel Availability

When any one of multiple services can handle the request:

```
Combined = 1 - (failure_A × failure_B)
```

Example with two redundant services at 99%:
```
Combined = 1 - (0.01 × 0.01) = 99.99%
```

## Critical vs Non-Critical Dependencies

**Critical**: Failure blocks your service
- Include in availability math
- Set `critical: true` in manifest

**Non-critical**: Service degrades gracefully
- Don't include in availability ceiling
- Set `critical: false` in manifest

## Practical Implications

1. **Audit your critical path**: What must succeed for you to succeed?
2. **Calculate your ceiling**: Multiply critical dependency availabilities
3. **Set achievable targets**: Your SLO ≤ calculated ceiling
4. **Identify bottlenecks**: Which dependency limits you most?

## Example Validation

```yaml
# Your manifest
spec:
  slos:
    availability:
      target: 0.9999              # Promising 99.99%

  dependencies:
    - service: auth-service
      type: service
      critical: true
      expects:
        availability: 0.999       # They promise 99.9%
    - service: database
      type: database
      critical: true
      expects:
        availability: 0.9999      # They promise 99.99%
```

**Problem**: 0.999 × 0.9999 = 0.9989 (99.89%)

You're promising 99.99% but can only achieve 99.89%.

**Solution**: Either:
- Lower your target to 99.89%
- Get auth-service to improve their contract
- Make auth-service non-critical (can you cache/degrade?)

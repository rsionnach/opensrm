# OpenSRM Judgment SLO Specification

## Overview

Judgment SLOs measure decision quality for AI gate services — systems that make binary decisions (approve/reject) with real consequences. Traditional SLOs measure system health (availability, latency, errors). Judgment SLOs measure whether the system is making *good decisions*.

This specification defines a layered model for measuring AI decision quality, with maturity levels to support incremental adoption.

---

## Core Concepts

### Decision Types

An AI gate produces one of three outputs for any input:

| Decision | Meaning | Counted in reversal rate? |
|----------|---------|---------------------------|
| `approve` | AI commits to allowing/accepting | Yes |
| `reject` | AI commits to denying/blocking | Yes |
| `escalate` | AI declines to decide; requests human judgment | No |

**Escalation is abstention, not a flagged decision.** When an AI escalates, it has not made a decision — a human must decide. This keeps metrics clean:
- Reversal rate measures: "When the AI decides, how often is it wrong?"
- Escalation rate measures: "How often does the AI decline to decide?"

### Measurement Layers

Judgment quality is measured through complementary layers:

| Layer | What it measures | Data source | Effort required |
|-------|------------------|-------------|-----------------|
| **Reactive** | Human disagreement when forced to engage | Reversal events | Zero (natural workflow) |
| **Proactive** | Decision quality on random sample | Human audit of samples | Dedicated review time |
| **Outcome** | Actual correctness via downstream results | Incident/defect correlation | Tracing infrastructure |
| **Behavioral** | Whether AI escalates appropriately | Decision distribution | Zero (event counting) |

Each layer catches different failure modes. Reactive catches problems humans notice organically. Proactive catches problems nobody would otherwise find. Outcome provides ground truth. Behavioral ensures the AI isn't over- or under-confident.

---

## Maturity Levels

Teams should adopt judgment SLOs incrementally. Each level builds on the previous.

### Level 1: Reactive (Start Here)

**Effort**: Minimal — instrument events, set thresholds  
**Time to implement**: Days  
**What you learn**: Are humans frequently disagreeing with the AI?

```yaml
spec:
  type: ai-gate
  
  slos:
    judgment:
      reversal:
        rate:
          target: 0.05              # ≤5% of decisions reversed
          window: 30d
          observation_period: 24h   # Time to wait for reversals
          
        high_confidence_failure:
          target: 0.02              # ≤2% confident-and-wrong
          confidence_threshold: 0.9
```

**Required instrumentation**:
```yaml
events:
  decision:
    name: ai_gate.decision
    attributes:
      decision_id: required
      decision: required            # approve | reject | escalate
      confidence: required          # 0.0 - 1.0
      
  reversal:
    name: ai_gate.reversal
    attributes:
      decision_id: required         # Links to original decision
      reversal_type: required       # human_override | automated | appeal
```

**Limitations at this level**:
- Only measures quality when humans are *forced* to engage
- If AI approves everything and nobody checks, reversal rate is zero while quality could be terrible
- Selection bias: humans check suspicious cases, not random sample

**When to advance**: When you need confidence that unreversed decisions are actually correct, not just unchecked.

---

### Level 2: Proactive (Audit Sampling)

**Effort**: Moderate — requires dedicated human review time  
**Time to implement**: Weeks (process setup)  
**What you learn**: True decision quality on unbiased sample

```yaml
spec:
  type: ai-gate
  
  slos:
    judgment:
      # Level 1 (keep these)
      reversal:
        rate:
          target: 0.05
          window: 30d
        high_confidence_failure:
          target: 0.02
          confidence_threshold: 0.9
          
      # Level 2 (add these)
      audit:
        enabled: true
        sample_rate: 0.10           # Review 10% of decisions
        sample_method: random       # Or: stratified, confidence_weighted
        
        accuracy:
          target: 0.95              # 95% of sampled decisions correct
          window: 30d
          
        coverage:
          target: 0.90              # 90% of planned samples actually reviewed
          window: 7d
          
        latency:
          p90: 48h                  # 90% of samples reviewed within 48h
```

**Additional instrumentation**:
```yaml
events:
  audit_result:
    name: ai_gate.audit
    attributes:
      decision_id: required         # Links to original decision
      verdict: required             # correct | incorrect
      reviewer: recommended
      notes: optional
```

**Key insight**: `audit.accuracy` is your unbiased quality signal. If reversal rate is 3% but audit accuracy is 85%, you have a 12% hidden failure rate — problems nobody's catching organically.

**Operational guidance**:
- 10% sample rate at 1,000 decisions/day = 100 reviews/day
- At 2 minutes per review = ~3.3 hours/day of review work
- Distribute across team or dedicate rotation

**When to advance**: When you need ground truth from real-world outcomes, not just human opinion at review time.

---

### Level 3: Outcome-Based (Ground Truth)

**Effort**: High — requires tracing infrastructure  
**Time to implement**: Months (instrumentation + correlation)  
**What you learn**: Actual decision correctness from downstream consequences

```yaml
spec:
  type: ai-gate
  
  slos:
    judgment:
      # Levels 1-2 (keep these)
      reversal:
        rate:
          target: 0.05
        high_confidence_failure:
          target: 0.02
          
      audit:
        enabled: true
        sample_rate: 0.10
        accuracy:
          target: 0.95
          
      # Level 3 (add these)
      outcomes:
        enabled: true
        
        defect_signals:
          - event: incident.created
            correlation_key: pr_id
            decision_filter: "decision='approve'"
            
          - event: rollback.executed
            correlation_key: deployment_id
            decision_filter: "decision='approve'"
            
          - event: fraud.chargeback
            correlation_key: transaction_id
            decision_filter: "decision='allow'"
            
        defect_rate:
          target: 0.01              # ≤1% of approvals lead to defects
          window: 90d               # Longer window (outcomes are delayed)
          
        outcome_latency:
          p90: 30d                  # 90% of outcomes observable within 30 days
```

**Additional instrumentation**:
```yaml
events:
  outcome:
    name: ai_gate.outcome
    attributes:
      decision_id: required         # Links back to original decision
      outcome_type: required        # incident | rollback | chargeback | defect
      severity: recommended
```

**Key insight**: Outcomes are ground truth. Human audit tells you "a reviewer thought this was wrong." Outcomes tell you "this actually caused a problem."

**Example**: Code review bot approves a PR. Human audit says "looks fine." Three weeks later, that code causes a production incident. Outcome tracking catches this; audit didn't.

**When to advance**: When you need to ensure appropriate escalation behavior and segment-level quality.

---

### Level 4: Behavioral & Segmented (Full Model)

**Effort**: High — requires segment taxonomy and behavioral analysis  
**Time to implement**: Ongoing refinement  
**What you learn**: Is the AI escalating appropriately? Are there hidden category-specific failures?

```yaml
spec:
  type: ai-gate
  
  slos:
    judgment:
      # Levels 1-3 (keep these)
      reversal:
        rate:
          target: 0.05
        high_confidence_failure:
          target: 0.02
          
      audit:
        enabled: true
        sample_rate: 0.10
        accuracy:
          target: 0.95
          
      outcomes:
        enabled: true
        defect_rate:
          target: 0.01
          
      # Level 4 (add these)
      escalation:
        rate:
          min: 0.05                 # Should escalate at least 5%
          max: 0.30                 # But not more than 30%
          window: 30d
          
        autonomous_accuracy:
          target: 0.97              # Higher bar for non-escalated decisions
          source: audit
          
      segments:
        enabled: true
        
        definitions:
          - name: security
            filter: "category='security' OR labels contains 'auth'"
          - name: infrastructure  
            filter: "category='infrastructure'"
          - name: documentation
            filter: "category='docs'"
            
        targets:
          - segment: security
            reversal_rate: 0.03     # Tighter than default
            audit_accuracy: 0.98
          - segment: infrastructure
            reversal_rate: 0.05
          - segment: documentation
            reversal_rate: 0.10     # More tolerant
            
      stability:
        trend:
          metric: reversal_rate
          max_increase: 0.02        # Alert if reversal rate increases >2%
          lookback: 14d
          comparison: 30d
          
        volatility:
          metric: reversal_rate
          max_stddev: 0.03
          window: 7d
          
      calibration:
        enabled: true
        source: audit
        ece:
          target: 0.10              # Expected Calibration Error
          window: 30d
```

**Key insights at this level**:

**Escalation bounds**: An AI that never escalates is overconfident. An AI that always escalates provides no value. The min/max bounds ensure healthy behavior.

**Segment analysis**: Aggregate metrics hide category failures. An AI might be 95% accurate overall but 60% accurate on security decisions. Segment-level targets catch this.

**Autonomous accuracy**: Decisions the AI made *without* escalating should have a higher accuracy bar than the overall population.

**Stability**: Quality should be stable. Sudden degradation or high volatility indicates something changed.

---

## Reference Examples

### Example 1: Code Review Bot (Level 2)

A bot that reviews pull requests and approves, requests changes, or escalates to senior engineers.

```yaml
apiVersion: opensrm.io/v1
kind: ServiceReliabilityManifest
metadata:
  name: pr-review-bot
  tier: standard
  
spec:
  type: ai-gate
  
  slos:
    availability:
      target: 0.999
      window: 30d
    latency:
      p99: 30s
      target: 0.99
      
    judgment:
      reversal:
        rate:
          target: 0.05
          window: 30d
          observation_period: 24h
        high_confidence_failure:
          target: 0.02
          confidence_threshold: 0.9
          
      audit:
        enabled: true
        sample_rate: 0.10
        sample_method: stratified   # Ensure security PRs are sampled
        accuracy:
          target: 0.95
          window: 30d
        coverage:
          target: 0.90
          window: 7d
        latency:
          p90: 48h
          
      escalation:
        rate:
          min: 0.10                 # Complex PRs should escalate
          max: 0.25
          
  ownership:
    team: developer-experience
    slack: "#dx-oncall"
    
  instrumentation:
    events:
      decision:
        name: pr_review.decision
      reversal:
        name: pr_review.reversal
      audit_result:
        name: pr_review.audit
    metrics:
      decisions_total: pr_review_decisions_total
      reversals_total: pr_review_reversals_total
      escalations_total: pr_review_escalations_total
```

**Operational notes**:
- Sample rate of 10% on ~200 PRs/day = 20 reviews/day
- Stratified sampling ensures security-related PRs are proportionally reviewed
- 24h observation period catches most reversals (developer requests changes next day)

---

### Example 2: Fraud Detection System (Level 3)

A system that allows or blocks transactions, with chargeback data as ground truth.

```yaml
apiVersion: opensrm.io/v1
kind: ServiceReliabilityManifest
metadata:
  name: fraud-detector
  tier: critical
  
spec:
  type: ai-gate
  
  slos:
    availability:
      target: 0.9999              # Critical path
      window: 30d
    latency:
      p99: 100ms                  # Real-time decisions
      target: 0.999
      
    judgment:
      reversal:
        rate:
          target: 0.03            # Tight target for financial system
          window: 30d
          observation_period: 1h  # Faster feedback in fraud
        high_confidence_failure:
          target: 0.01            # Very tight for confident decisions
          confidence_threshold: 0.95
          
      audit:
        enabled: true
        sample_rate: 0.05         # Lower rate, higher volume
        accuracy:
          target: 0.97
          window: 30d
          
      outcomes:
        enabled: true
        defect_signals:
          - event: fraud.chargeback
            correlation_key: transaction_id
            decision_filter: "decision='allow'"
          - event: fraud.confirmed
            correlation_key: transaction_id
            decision_filter: "decision='allow'"
          - event: customer.complaint_fraud_false_positive
            correlation_key: transaction_id
            decision_filter: "decision='block'"
            
        defect_rate:
          target: 0.005           # ≤0.5% of allows result in fraud
          window: 90d
          
        # Also track false positive rate
        false_positive_rate:
          target: 0.02            # ≤2% of blocks were legitimate
          window: 90d
          
      escalation:
        rate:
          min: 0.02               # Some transactions should go to human review
          max: 0.10               # But not too many (latency matters)
          
      segments:
        enabled: true
        definitions:
          - name: high_value
            filter: "amount > 10000"
          - name: new_customer
            filter: "customer_age_days < 30"
          - name: international
            filter: "cross_border = true"
        targets:
          - segment: high_value
            reversal_rate: 0.02
            audit_accuracy: 0.99
          - segment: new_customer
            reversal_rate: 0.05   # More tolerant, less history
            
  ownership:
    team: fraud-ops
    slack: "#fraud-alerts"
    pagerduty: FRAUD_CRITICAL
```

**Operational notes**:
- Outcome data (chargebacks) arrives 30-90 days after decision
- 90-day window for outcome SLOs captures this delay
- False positive rate requires tracking customer complaints about blocked legitimate transactions
- High-value segment has tighter targets (more damage if wrong)

---

### Example 3: Content Moderation (Level 4)

A system that publishes, flags for review, or removes user-generated content.

```yaml
apiVersion: opensrm.io/v1
kind: ServiceReliabilityManifest
metadata:
  name: content-moderator
  tier: standard
  
spec:
  type: ai-gate
  
  slos:
    availability:
      target: 0.999
      window: 30d
    latency:
      p99: 500ms
      target: 0.99
      
    judgment:
      reversal:
        rate:
          target: 0.08            # Content moderation is subjective
          window: 30d
          observation_period: 72h # Appeals take time
        high_confidence_failure:
          target: 0.03
          confidence_threshold: 0.9
          
      audit:
        enabled: true
        sample_rate: 0.05
        sample_method: confidence_weighted  # Over-sample low-confidence
        accuracy:
          target: 0.92            # Lower than code review (more subjective)
          window: 30d
        coverage:
          target: 0.85
          window: 7d
        latency:
          p90: 24h
          
      outcomes:
        enabled: true
        defect_signals:
          - event: content.reported_after_publish
            correlation_key: content_id
            decision_filter: "decision='publish'"
          - event: content.appeal_successful  
            correlation_key: content_id
            decision_filter: "decision='remove'"
          - event: legal.takedown_request
            correlation_key: content_id
            decision_filter: "decision='publish'"
            
        defect_rate:
          target: 0.02
          window: 30d
          
      escalation:
        rate:
          min: 0.15               # Content often needs human judgment
          max: 0.40
          
      segments:
        enabled: true
        definitions:
          - name: hate_speech
            filter: "category='hate_speech'"
          - name: violence
            filter: "category='violence'"
          - name: spam
            filter: "category='spam'"
          - name: copyright
            filter: "category='copyright'"
        targets:
          - segment: hate_speech
            reversal_rate: 0.05   # Tight: high harm if wrong
            audit_accuracy: 0.95
          - segment: violence
            reversal_rate: 0.05
          - segment: spam
            reversal_rate: 0.15   # More tolerant
          - segment: copyright
            reversal_rate: 0.10
            escalation_min: 0.30  # Often needs legal review
            
      stability:
        trend:
          metric: reversal_rate
          max_increase: 0.03
          lookback: 14d
          comparison: 30d
        volatility:
          metric: reversal_rate
          max_stddev: 0.04        # Content moderation is inherently variable
          window: 7d
          
      calibration:
        enabled: true
        source: audit
        ece:
          target: 0.12
          window: 30d
          
  ownership:
    team: trust-and-safety
    slack: "#t-and-s-oncall"
```

**Operational notes**:
- Higher reversal rate target (8%) reflects inherent subjectivity
- Confidence-weighted sampling over-samples uncertain decisions
- Segment-level targets differentiate high-harm categories (hate speech) from low-harm (spam)
- Copyright segment has higher escalation minimum (legal complexity)
- Wider volatility tolerance acknowledges content patterns shift with events

---

## Metric Definitions

### Reversal Rate

```
reversal_rate = 
  count(reversals where decision_age < observation_period) 
  / count(decisions where decision ∈ [approve, reject])
```

Escalations are excluded from both numerator and denominator.

### High-Confidence Failure Rate

```
hcf_rate = 
  count(reversals where original_confidence >= threshold)
  / count(decisions where confidence >= threshold)
```

### Audit Accuracy

```
audit_accuracy = 
  count(audits where verdict = 'correct')
  / count(audits completed)
```

### Audit Coverage

```
audit_coverage = 
  count(audits completed within window)
  / count(audits scheduled within window)
```

### Escalation Rate

```
escalation_rate = 
  count(decisions where decision = 'escalate')
  / count(all decisions)
```

### Autonomous Accuracy

```
autonomous_accuracy = 
  count(audits where verdict = 'correct' AND original_decision != 'escalate')
  / count(audits where original_decision != 'escalate')
```

### Defect Rate

```
defect_rate = 
  count(decisions with linked defect_signal)
  / count(decisions matching decision_filter)
```

### Expected Calibration Error (ECE)

```
ECE = Σ (|bucket_accuracy - bucket_confidence| * bucket_weight)
```

Where buckets partition decisions by confidence (e.g., 0.0-0.1, 0.1-0.2, ... 0.9-1.0).

---

## Implementation Notes

### For Platform Teams

1. **Start at Level 1** — Get basic instrumentation in place. Reversal rate is measurable with minimal effort.

2. **Don't skip to Level 3** — Outcome-based measurement requires tracing infrastructure that takes time to build. Level 2 (audit) gives you unbiased quality signal while you build toward outcomes.

3. **Define segments early** — Even if you don't set segment-level targets initially, having the taxonomy in place makes future analysis easier.

4. **Audit is a process, not just a metric** — Level 2 requires someone to actually do the reviews. Budget time accordingly.

### For Observability Vendors

1. **Correlation is critical** — Decisions, reversals, audits, and outcomes must be linkable by decision_id.

2. **Time-windowed joins** — Reversal events may arrive hours/days after decisions. Outcome events may arrive weeks/months later. Your storage and query layer needs to support this.

3. **Segment-level dashboards** — Aggregate metrics hide important failures. Surface per-segment views by default.

### For AI/ML Teams

1. **Emit confidence scores** — Without confidence, high-confidence failure rate and calibration are unmeasurable.

2. **Explicit escalation** — Model "I don't know" as a first-class output, not a low-confidence approve/reject.

3. **Category labels** — Emit decision categories to enable segment analysis.

---

## Open Questions

1. **Audit reviewer quality**: Should there be an SLO on inter-reviewer agreement to ensure audit verdicts are consistent?

2. **Cost of false negatives vs false positives**: Should the spec support asymmetric error costs? (e.g., blocking a legitimate transaction is 10x worse than allowing a small fraud)

3. **Multi-stage decisions**: Some AI gates have multiple rounds (initial decision → appeal → final). How should reversals be counted across stages?

4. **Confidence source**: If confidence comes from an LLM's self-reported certainty (often poorly calibrated), should there be guidance on confidence calibration before trusting HCF metrics?

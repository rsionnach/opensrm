# Judgment SLOs for AI Gates

## Why Judgment SLOs?

Traditional SLOs measure system health: "Is it up? Is it fast?"

Judgment SLOs measure decision quality: "Are the AI's decisions good?"

## The Four Judgment SLOs

### 1. Reversal Rate

**What**: Percentage of AI decisions overridden by humans

**Formula**: `reversals / decisions`

**Why it matters**: High reversal rate means humans don't trust the AI

**Target guidance**:
- Critical: ≤ 3%
- Standard: ≤ 5%
- Low: ≤ 10%

**No ground truth needed**: Just track overrides

### 2. High-Confidence Failure (HCF)

**What**: Rate of confident decisions that were wrong

**Formula**: `(confident AND reversed) / confident_decisions`

**Why it matters**: Confident but wrong is the most dangerous failure mode

**Target guidance**:
- Critical: ≤ 1%
- Standard: ≤ 2%
- Low: ≤ 5%

### 3. Calibration (ECE)

**What**: Does stated confidence match actual accuracy?

**Formula**: Expected Calibration Error across confidence bins

**Why it matters**: An 80% confident decision should be right ~80% of the time

**Target guidance**:
- Well-calibrated: ECE < 0.10
- Acceptable: ECE < 0.15
- Needs work: ECE > 0.20

### 4. Feedback Latency

**What**: Time until decision quality is known

**Formula**: `outcome_timestamp - decision_timestamp`

**Why it matters**: If feedback takes 6 months, SLOs are meaningless

**Target guidance**:
- Ideal: < 24 hours
- Acceptable: < 7 days
- Problematic: > 30 days

## Starting Simple

Don't implement all four at once:

1. **Start with reversal_rate**: No ground truth needed, just track overrides
2. **Add HCF**: Once you have confidence scores
3. **Add calibration**: When you have enough data for statistical significance
4. **Track feedback_latency**: To understand your measurement window

## Instrumentation Requirements

You need three events:
- **Decision**: When AI makes a choice
- **Reversal**: When human overrides
- **Outcome**: When ground truth is known (if ever)

See SKILL.md for attribute schemas.

# [ARCHIVED 2026-04-26] CICD Proliferation Plan (pre-v1.5)

> **Archived.** This plan was written before the three-tier architecture and the six-repo consolidation. The strategic framing (Docker image + GitHub Action + drift detection as a CI/CD distribution strategy) still informs how to position the new architecture, but specific implementation details (repo paths, package names, CLI surfaces) are stale. Preserved here for archaeological reference.

---

# NthLayer CI/CD Proliferation Plan

## Executive Summary

This plan outlines how to make NthLayer the default reliability gate in CI/CD pipelines. The strategy focuses on three pillars:

1. **Frictionless installation** — Docker image, zero-config CLI
2. **PR visibility** — GitHub Action that comments risk assessments on PRs
3. **Ongoing value** — Drift detection and audit workflows

The goal: teams add NthLayer in 10 minutes, then it becomes indispensable.

---

## Phase 1: Foundation (Week 1-2)

### 1.1 Docker Image

**Goal:** `docker run ghcr.io/rsionnach/nthlayer check-deploy payment-api` just works.

#### Image Specification

```dockerfile
# Dockerfile
FROM python:3.11-slim

LABEL org.opencontainers.image.source="https://github.com/rsionnach/nthlayer"
LABEL org.opencontainers.image.description="Shift-left reliability for platform teams"
LABEL org.opencontainers.image.licenses="MIT"

# Install nthlayer
RUN pip install --no-cache-dir nthlayer

# Create non-root user
RUN useradd -m -s /bin/bash nthlayer
USER nthlayer
WORKDIR /workspace

ENTRYPOINT ["nthlayer"]
CMD ["--help"]
```

#### Registry

- **Primary:** `ghcr.io/rsionnach/nthlayer`
- **Tags:**
  - `latest` — latest stable release
  - `v0.1.0` — specific version
  - `sha-abc1234` — commit SHA for traceability

#### GitHub Actions Workflow for Publishing

```yaml
# .github/workflows/publish-docker.yml
name: Publish Docker Image

on:
  release:
    types: [published]
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'pyproject.toml'
      - 'Dockerfile'

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix=sha-
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

#### Verification Checklist

- [ ] `docker run ghcr.io/rsionnach/nthlayer --version` returns version
- [ ] `docker run -v $(pwd):/workspace ghcr.io/rsionnach/nthlayer plan service.yaml` works
- [ ] Image size < 200MB
- [ ] Non-root user by default
- [ ] Works in GitHub Actions runners

---

### 1.2 Standard Output Formats

#### SARIF Output Format

**Goal:** `nthlayer plan --format sarif` produces GitHub Code Scanning compatible output.

SARIF (Static Analysis Results Interchange Format) allows NthLayer findings to appear in GitHub's Security tab and PR annotations.

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "NthLayer",
          "version": "0.1.0",
          "informationUri": "https://github.com/rsionnach/nthlayer",
          "rules": [
            {
              "id": "NTHLAYER001",
              "name": "SLOInfeasible",
              "shortDescription": {
                "text": "SLO target exceeds dependency ceiling"
              },
              "fullDescription": {
                "text": "The declared SLO target cannot be achieved given the availability of upstream dependencies."
              },
              "helpUri": "https://rsionnach.github.io/nthlayer/errors/slo-infeasible/",
              "defaultConfiguration": {
                "level": "error"
              }
            },
            {
              "id": "NTHLAYER002",
              "name": "DriftCritical",
              "shortDescription": {
                "text": "Error budget projected to exhaust soon"
              },
              "fullDescription": {
                "text": "Current error budget burn rate will exhaust the budget within the warning threshold."
              },
              "helpUri": "https://rsionnach.github.io/nthlayer/errors/drift-critical/",
              "defaultConfiguration": {
                "level": "warning"
              }
            },
            {
              "id": "NTHLAYER003",
              "name": "MetricMissing",
              "shortDescription": {
                "text": "Required metric not found"
              },
              "fullDescription": {
                "text": "A metric required for SLO calculation is not being emitted by the service."
              },
              "helpUri": "https://rsionnach.github.io/nthlayer/errors/metric-missing/",
              "defaultConfiguration": {
                "level": "error"
              }
            },
            {
              "id": "NTHLAYER004",
              "name": "BudgetExhausted",
              "shortDescription": {
                "text": "Error budget exhausted"
              },
              "fullDescription": {
                "text": "The service has consumed 100% or more of its error budget for the current window."
              },
              "helpUri": "https://rsionnach.github.io/nthlayer/errors/budget-exhausted/",
              "defaultConfiguration": {
                "level": "error"
              }
            },
            {
              "id": "NTHLAYER005",
              "name": "HighBlastRadius",
              "shortDescription": {
                "text": "Change affects critical downstream services"
              },
              "fullDescription": {
                "text": "This service has critical-tier dependents that may be impacted by changes."
              },
              "helpUri": "https://rsionnach.github.io/nthlayer/errors/high-blast-radius/",
              "defaultConfiguration": {
                "level": "warning"
              }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "NTHLAYER001",
          "level": "error",
          "message": {
            "text": "SLO target 99.99% exceeds dependency ceiling 99.84% by 0.15%"
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "service.yaml"
                },
                "region": {
                  "startLine": 8,
                  "startColumn": 1
                }
              }
            }
          ],
          "properties": {
            "service": "payment-api",
            "target": 0.9999,
            "ceiling": 0.9984,
            "gap": 0.0015
          }
        }
      ]
    }
  ]
}
```

#### Rule IDs

| ID | Name | Level | Description |
|----|------|-------|-------------|
| NTHLAYER001 | SLOInfeasible | error | Target exceeds dependency ceiling |
| NTHLAYER002 | DriftCritical | warning | Budget projected to exhaust within threshold |
| NTHLAYER003 | MetricMissing | error | Required metric not found in Prometheus |
| NTHLAYER004 | BudgetExhausted | error | Error budget ≤ 0 |
| NTHLAYER005 | HighBlastRadius | warning | Critical-tier dependents affected |
| NTHLAYER006 | TierMismatch | warning | Service tier lower than dependent's tier |
| NTHLAYER007 | OwnershipMissing | note | No team or owner defined |
| NTHLAYER008 | RunbookMissing | note | Critical service without runbook link |

#### JUnit XML Output Format

**Goal:** `nthlayer plan --format junit` produces test-style output for CI systems.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="NthLayer" tests="5" failures="1" errors="0" time="2.341">
  <testsuite name="payment-api" tests="5" failures="1" errors="0" time="2.341">
    <testcase name="SLO Feasibility" classname="payment-api.validate-slo" time="0.523">
      <failure message="SLO target 99.99% exceeds dependency ceiling 99.84%">
Target: 99.99%
Dependency ceiling: 99.84%
Gap: 0.15%

Dependencies:
  - postgresql: 99.95%
  - redis: 99.99%
  - user-service: 99.9%

Serial availability: 99.84%
      </failure>
    </testcase>
    <testcase name="Error Budget" classname="payment-api.check-deploy" time="0.412"/>
    <testcase name="Drift Analysis" classname="payment-api.drift" time="0.891"/>
    <testcase name="Metric Coverage" classname="payment-api.metrics" time="0.234"/>
    <testcase name="Blast Radius" classname="payment-api.blast-radius" time="0.281"/>
  </testsuite>
</testsuites>
```

#### JSON Output Format (Structured)

**Goal:** Machine-readable output for downstream automation.

```json
{
  "version": "1.0",
  "timestamp": "2026-01-17T14:30:00Z",
  "service": "payment-api",
  "checks": {
    "slo_feasibility": {
      "status": "fail",
      "target": 0.9999,
      "ceiling": 0.9984,
      "gap": 0.0015,
      "dependencies": [
        {"name": "postgresql", "availability": 0.9995},
        {"name": "redis", "availability": 0.9999},
        {"name": "user-service", "availability": 0.999}
      ]
    },
    "error_budget": {
      "status": "pass",
      "remaining_percent": 73.2,
      "remaining_minutes": 315,
      "window_days": 30
    },
    "drift": {
      "status": "warning",
      "severity": "moderate",
      "trend": "gradual_decline",
      "burn_rate_per_day": 2.1,
      "days_until_exhaustion": 23
    },
    "metrics": {
      "status": "pass",
      "required_found": 4,
      "required_total": 4,
      "recommended_found": 2,
      "recommended_total": 5
    },
    "blast_radius": {
      "status": "warning",
      "direct_dependents": 3,
      "transitive_dependents": 12,
      "critical_dependents": 2,
      "daily_requests_affected": 2100000
    }
  },
  "summary": {
    "status": "fail",
    "errors": 1,
    "warnings": 2,
    "passed": 2,
    "recommendation": "Reduce SLO target to 99.8% or improve user-service availability"
  }
}
```

#### CLI Implementation

```bash
# Output format options
nthlayer plan service.yaml --format table    # Default, human-readable
nthlayer plan service.yaml --format json     # Machine-readable
nthlayer plan service.yaml --format sarif    # GitHub Code Scanning
nthlayer plan service.yaml --format junit    # CI test results
nthlayer plan service.yaml --format markdown # PR comment ready

# Combine with file output
nthlayer plan service.yaml --format sarif --output results.sarif
```

---

## Phase 2: GitHub Action (Week 2-3)

### 2.1 Action Specification

**Repository:** `rsionnach/nthlayer-action`

#### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `command` | NthLayer command to run | No | `plan` |
| `service` | Service name or path to service.yaml | Yes | - |
| `prometheus_url` | Prometheus endpoint | No | - |
| `grafana_url` | Grafana endpoint | No | - |
| `grafana_api_key` | Grafana API key | No | - |
| `fail_on` | When to fail: `error`, `warning`, `none` | No | `error` |
| `comment` | Post PR comment | No | `true` |
| `upload_sarif` | Upload SARIF to GitHub Security | No | `true` |

#### Outputs

| Output | Description |
|--------|-------------|
| `status` | Overall status: `pass`, `warn`, `fail` |
| `errors` | Number of errors |
| `warnings` | Number of warnings |
| `json_result` | Full JSON output |
| `sarif_file` | Path to SARIF file |

#### Action Definition

```yaml
# action.yml
name: 'NthLayer Reliability Check'
description: 'Validate service reliability requirements and gate deployments'
author: 'rsionnach'

branding:
  icon: 'shield'
  color: 'blue'

inputs:
  command:
    description: 'NthLayer command: plan, check-deploy, validate-slo, drift'
    required: false
    default: 'plan'
  service:
    description: 'Service name or path to service.yaml'
    required: true
  prometheus_url:
    description: 'Prometheus endpoint URL'
    required: false
  grafana_url:
    description: 'Grafana endpoint URL'
    required: false
  grafana_api_key:
    description: 'Grafana API key'
    required: false
  fail_on:
    description: 'Failure threshold: error, warning, none'
    required: false
    default: 'error'
  comment:
    description: 'Post results as PR comment'
    required: false
    default: 'true'
  upload_sarif:
    description: 'Upload SARIF to GitHub Security tab'
    required: false
    default: 'true'
  version:
    description: 'NthLayer version to use'
    required: false
    default: 'latest'

outputs:
  status:
    description: 'Overall status: pass, warn, fail'
  errors:
    description: 'Number of errors found'
  warnings:
    description: 'Number of warnings found'
  json_result:
    description: 'Full JSON result'
  sarif_file:
    description: 'Path to generated SARIF file'

runs:
  using: 'composite'
  steps:
    - name: Setup Python
      uses: actions/setup-python@v5
      with:
        python-version: '3.11'

    - name: Install NthLayer
      shell: bash
      run: |
        if [ "${{ inputs.version }}" = "latest" ]; then
          pip install nthlayer
        else
          pip install nthlayer==${{ inputs.version }}
        fi

    - name: Run NthLayer
      id: nthlayer
      shell: bash
      env:
        NTHLAYER_PROMETHEUS_URL: ${{ inputs.prometheus_url }}
        NTHLAYER_GRAFANA_URL: ${{ inputs.grafana_url }}
        NTHLAYER_GRAFANA_API_KEY: ${{ inputs.grafana_api_key }}
      run: |
        set +e
        
        # Run command and capture output
        nthlayer ${{ inputs.command }} ${{ inputs.service }} \
          --format json > nthlayer-result.json 2>&1
        EXIT_CODE=$?
        
        # Generate SARIF
        nthlayer ${{ inputs.command }} ${{ inputs.service }} \
          --format sarif > nthlayer-result.sarif 2>&1
        
        # Generate Markdown for PR comment
        nthlayer ${{ inputs.command }} ${{ inputs.service }} \
          --format markdown > nthlayer-comment.md 2>&1
        
        # Extract summary
        STATUS=$(jq -r '.summary.status' nthlayer-result.json)
        ERRORS=$(jq -r '.summary.errors' nthlayer-result.json)
        WARNINGS=$(jq -r '.summary.warnings' nthlayer-result.json)
        
        echo "status=$STATUS" >> $GITHUB_OUTPUT
        echo "errors=$ERRORS" >> $GITHUB_OUTPUT
        echo "warnings=$WARNINGS" >> $GITHUB_OUTPUT
        echo "sarif_file=nthlayer-result.sarif" >> $GITHUB_OUTPUT
        
        # Determine exit code based on fail_on setting
        if [ "${{ inputs.fail_on }}" = "error" ] && [ "$ERRORS" -gt 0 ]; then
          echo "exit_code=1" >> $GITHUB_OUTPUT
        elif [ "${{ inputs.fail_on }}" = "warning" ] && [ "$WARNINGS" -gt 0 ]; then
          echo "exit_code=1" >> $GITHUB_OUTPUT
        else
          echo "exit_code=0" >> $GITHUB_OUTPUT
        fi

    - name: Post PR Comment
      if: inputs.comment == 'true' && github.event_name == 'pull_request'
      uses: actions/github-script@v7
      with:
        script: |
          const fs = require('fs');
          const comment = fs.readFileSync('nthlayer-comment.md', 'utf8');
          
          // Find existing comment
          const { data: comments } = await github.rest.issues.listComments({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: context.issue.number,
          });
          
          const botComment = comments.find(c => 
            c.user.type === 'Bot' && c.body.includes('<!-- nthlayer -->')
          );
          
          const body = `<!-- nthlayer -->\n${comment}`;
          
          if (botComment) {
            await github.rest.issues.updateComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              comment_id: botComment.id,
              body: body
            });
          } else {
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: body
            });
          }

    - name: Upload SARIF
      if: inputs.upload_sarif == 'true'
      uses: github/codeql-action/upload-sarif@v3
      with:
        sarif_file: nthlayer-result.sarif
        category: nthlayer

    - name: Upload Artifacts
      uses: actions/upload-artifact@v4
      with:
        name: nthlayer-results
        path: |
          nthlayer-result.json
          nthlayer-result.sarif

    - name: Check Exit Code
      shell: bash
      run: exit ${{ steps.nthlayer.outputs.exit_code }}
```

### 2.2 PR Comment Format

The PR comment should be informative but scannable:

```markdown
<!-- nthlayer -->
## 🛡️ NthLayer Reliability Check

### payment-api

| Check | Status | Details |
|-------|--------|---------|
| SLO Feasibility | ❌ Fail | Target 99.99% exceeds ceiling 99.84% |
| Error Budget | ✅ Pass | 73.2% remaining (315 min) |
| Drift | ⚠️ Warning | Budget exhausts in 23 days |
| Metrics | ✅ Pass | 4/4 required metrics found |
| Blast Radius | ⚠️ Warning | Affects 2 critical services |

<details>
<summary>📊 SLO Feasibility Details</summary>

**Target:** 99.99%  
**Dependency Ceiling:** 99.84%  
**Gap:** 0.15%

| Dependency | Availability |
|------------|--------------|
| postgresql | 99.95% |
| redis | 99.99% |
| user-service | 99.9% |

**Recommendation:** Reduce target to 99.8% or improve user-service SLO.
</details>

<details>
<summary>📈 Drift Analysis</summary>

**Current Budget:** 73.2%  
**Trend:** Gradual decline (-2.1%/day)  
**Projection:** Exhausts in 23 days  

**Recommendation:** Investigate error rate increase before next release.
</details>

---

<sub>Generated by [NthLayer](https://github.com/rsionnach/nthlayer) • [Docs](https://rsionnach.github.io/nthlayer/)</sub>
```

### 2.3 Example Workflows

#### Basic PR Check

```yaml
# .github/workflows/nthlayer.yml
name: NthLayer Reliability Check

on:
  pull_request:
    paths:
      - '**/service.yaml'
      - '**/service.yml'

jobs:
  reliability-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: NthLayer Check
        uses: rsionnach/nthlayer-action@v1
        with:
          service: service.yaml
          prometheus_url: ${{ secrets.PROMETHEUS_URL }}
```

#### Full Pipeline (PR + Merge + Nightly)

```yaml
# .github/workflows/nthlayer-full.yml
name: NthLayer Pipeline

on:
  pull_request:
    paths:
      - '**/service.yaml'
  push:
    branches: [main]
    paths:
      - '**/service.yaml'
  schedule:
    - cron: '0 6 * * *'  # Daily at 6am UTC

jobs:
  # PR: Plan and comment
  plan:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rsionnach/nthlayer-action@v1
        with:
          command: plan
          service: service.yaml
          prometheus_url: ${{ secrets.PROMETHEUS_URL }}
          fail_on: error

  # Merge to main: Apply artifacts
  apply:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rsionnach/nthlayer-action@v1
        with:
          command: apply
          service: service.yaml
          grafana_url: ${{ secrets.GRAFANA_URL }}
          grafana_api_key: ${{ secrets.GRAFANA_API_KEY }}

  # Nightly: Drift audit
  audit:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Drift Audit
        uses: rsionnach/nthlayer-action@v1
        id: audit
        with:
          command: drift
          service: service.yaml
          prometheus_url: ${{ secrets.PROMETHEUS_URL }}
          fail_on: none  # Don't fail, just report
      
      - name: Create Issue if Drift Critical
        if: steps.audit.outputs.status == 'fail'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 NthLayer: Critical drift detected',
              body: `Automated drift detection found critical issues.\n\nSee workflow run: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
              labels: ['reliability', 'automated']
            });
```

---

## Phase 3: Drift Audit Workflow (Week 3-4)

### 3.1 Standalone Audit Action

For organizations that want scheduled drift detection across multiple services:

```yaml
# .github/workflows/nthlayer-audit.yml
name: NthLayer Weekly Audit

on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday at 9am UTC
  workflow_dispatch:

jobs:
  audit:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service:
          - payment-api
          - user-service
          - order-service
    steps:
      - uses: actions/checkout@v4
      
      - name: Drift Check
        uses: rsionnach/nthlayer-action@v1
        id: drift
        with:
          command: drift
          service: services/${{ matrix.service }}/service.yaml
          prometheus_url: ${{ secrets.PROMETHEUS_URL }}
          fail_on: none
          comment: false
      
      - name: Collect Results
        run: |
          echo "${{ matrix.service }}: ${{ steps.drift.outputs.status }}" >> audit-results.txt
      
      - name: Upload Results
        uses: actions/upload-artifact@v4
        with:
          name: audit-${{ matrix.service }}
          path: nthlayer-result.json

  report:
    needs: audit
    runs-on: ubuntu-latest
    steps:
      - name: Download All Results
        uses: actions/download-artifact@v4
        with:
          path: results
      
      - name: Generate Report
        run: |
          echo "# NthLayer Weekly Audit Report" > report.md
          echo "" >> report.md
          echo "| Service | Status | Budget | Drift | Action |" >> report.md
          echo "|---------|--------|--------|-------|--------|" >> report.md
          
          for f in results/*/nthlayer-result.json; do
            SERVICE=$(jq -r '.service' $f)
            STATUS=$(jq -r '.summary.status' $f)
            BUDGET=$(jq -r '.checks.error_budget.remaining_percent' $f)
            DRIFT=$(jq -r '.checks.drift.severity // "none"' $f)
            
            if [ "$STATUS" = "fail" ]; then
              ICON="❌"
            elif [ "$STATUS" = "warn" ]; then
              ICON="⚠️"
            else
              ICON="✅"
            fi
            
            echo "| $SERVICE | $ICON | ${BUDGET}% | $DRIFT | |" >> report.md
          done
      
      - name: Post to Slack
        uses: slackapi/slack-github-action@v1
        with:
          payload-file-path: report.md
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

### 3.2 Audit Report Format

Weekly audit produces a summary for leadership/platform teams:

```markdown
# NthLayer Weekly Audit Report
**Week of January 13, 2026**

## Summary

| Metric | Value |
|--------|-------|
| Services Audited | 47 |
| Healthy | 39 (83%) |
| Warning | 6 (13%) |
| Critical | 2 (4%) |

## Critical Issues

| Service | Issue | Days to Exhaustion | Owner |
|---------|-------|-------------------|-------|
| payment-api | Drift: gradual decline | 23 | @payments-team |
| checkout-service | Budget exhausted | -2 | @checkout-team |

## Warnings

| Service | Issue | Details |
|---------|-------|---------|
| user-service | SLO ceiling | Target 99.9% at ceiling |
| order-service | Missing metrics | 2 recommended metrics missing |
| ... | ... | ... |

## Recommendations

1. **payment-api**: Investigate error rate increase from Jan 10 deployment
2. **checkout-service**: Consider SLO target reduction or architecture review
3. **user-service**: Buffer needed; improve or reduce dependents' targets

---
*Generated by NthLayer v0.2.0*
```

---

## Phase 4: Distribution & Adoption (Week 4+)

### 4.1 Documentation

Create adoption-focused docs:

| Page | Content |
|------|---------|
| `docs/cicd/quickstart.md` | 5-minute setup guide |
| `docs/cicd/github-actions.md` | Full GitHub Actions reference |
| `docs/cicd/gitlab.md` | GitLab CI example (community contributed) |
| `docs/cicd/jenkins.md` | Jenkins example (community contributed) |
| `docs/cicd/required-checks.md` | How to make NthLayer a required check |
| `docs/cicd/org-rollout.md` | Platform team guide for org-wide adoption |

### 4.2 Marketplace Listing

Publish to GitHub Marketplace:

```yaml
# action.yml additions for Marketplace
branding:
  icon: 'shield'
  color: 'blue'
```

Categories: `Code quality`, `Continuous integration`

### 4.3 Adoption Metrics

Track adoption via:

- GitHub Action usage (Marketplace stats)
- Docker image pulls (GHCR stats)
- PyPI downloads
- `nthlayer --version` telemetry (opt-in)

---

## Implementation Timeline

| Week | Deliverable | Effort |
|------|-------------|--------|
| 1 | Docker image + publish workflow | 1 day |
| 1 | `--format sarif` implementation | 2 days |
| 1 | `--format junit` implementation | 1 day |
| 1 | `--format markdown` implementation | 1 day |
| 2 | GitHub Action v1 | 2-3 days |
| 2 | PR comment formatting | 1 day |
| 2 | Basic documentation | 1 day |
| 3 | Audit workflow template | 1 day |
| 3 | Report generation | 1 day |
| 3 | Slack integration example | 0.5 days |
| 4 | Marketplace listing | 0.5 days |
| 4 | Adoption documentation | 1 day |

**Total: ~2-3 weeks of focused effort**

---

## Success Criteria

| Metric | 3 Month Target | 6 Month Target |
|--------|----------------|----------------|
| GitHub Action installs | 50 | 200 |
| Docker pulls/month | 500 | 2,000 |
| Repos with NthLayer workflow | 20 | 100 |
| PR comments generated | 500 | 5,000 |
| Weekly audit reports sent | 5 orgs | 20 orgs |

---

## Dependencies

| Dependency | Status | Blocks |
|------------|--------|--------|
| Drift detection (core) | Spec complete, not implemented | PR comment drift section, audit workflow |
| validate-slo (core) | Spec complete, not implemented | PR comment feasibility section |
| blast-radius (core) | Spec complete, not implemented | PR comment blast radius section |
| `--format` flag (CLI) | Not implemented | All output formats |

**Recommendation:** Implement `--format json/sarif/junit/markdown` first, even with limited checks. The infrastructure enables adoption; features can be added incrementally.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Drift detection not ready | PR comments less compelling | Ship with available checks; add drift later |
| SARIF upload permissions | Requires `security-events: write` | Document clearly; provide non-SARIF alternative |
| Rate limits on PR comments | Comment fails on high-volume repos | Implement comment update (not create) pattern |
| Large monorepos | Slow if many service.yaml files | Add `--changed-only` flag that uses git diff |

---

## Appendix: File Structure

```
rsionnach/nthlayer-action/
├── action.yml
├── README.md
├── LICENSE
├── examples/
│   ├── basic.yml
│   ├── full-pipeline.yml
│   └── weekly-audit.yml
└── docs/
    └── outputs.md

rsionnach/nthlayer/
├── Dockerfile                    # New
├── .github/
│   └── workflows/
│       └── publish-docker.yml    # New
├── src/nthlayer/
│   ├── cli/
│   │   └── formatters/           # New
│   │       ├── __init__.py
│   │       ├── json.py
│   │       ├── sarif.py
│   │       ├── junit.py
│   │       └── markdown.py
│   └── ...
└── ...
```

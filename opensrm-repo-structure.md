# OpenSRM Repository Structure

Consolidates the spec and GitHub Action in a single repo.

## Repository Layout

```
opensrm/
├── spec/
│   └── v1/
│       ├── specification.md
│       └── schema.json
├── examples/
│   ├── api-minimal.yaml
│   ├── api-full.yaml
│   ├── ai-gate-minimal.yaml
│   ├── ai-gate-full.yaml
│   └── ai-gate-security-scanner.yaml
├── action/
│   ├── src/
│   │   ├── index.ts
│   │   ├── validator.ts
│   │   └── schema/           # Copy of spec/v1/schema.json for bundling
│   ├── dist/
│   │   └── index.js          # Bundled action (committed)
│   ├── package.json
│   └── tsconfig.json
├── action.yml                 # Root-level for GitHub Action discovery
├── CHANGELOG.md
├── CONTRIBUTING.md
├── GOVERNANCE.md
├── IMPLEMENTATIONS.md
├── LICENSE
└── README.md
```

## GitHub Action

### action.yml (repo root)

```yaml
name: 'OpenSRM Validate'
description: 'Validate Service Reliability Manifests against the OpenSRM specification'
author: 'rsionnach'

branding:
  icon: 'check-circle'
  color: 'green'

inputs:
  manifest:
    description: 'Path to the service.reliability.yaml file'
    required: false
    default: 'service.reliability.yaml'
  strict:
    description: 'Fail on warnings in addition to errors'
    required: false
    default: 'false'

outputs:
  valid:
    description: 'Whether the manifest is valid'
  errors:
    description: 'JSON array of validation errors'
  warnings:
    description: 'JSON array of validation warnings'
  service-name:
    description: 'Service name from manifest'
  service-type:
    description: 'Service type from manifest'
  service-tier:
    description: 'Service tier from manifest'

runs:
  using: 'node20'
  main: 'action/dist/index.js'
```

### action/package.json

```json
{
  "name": "opensrm-validate-action",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "ncc build src/index.ts -o dist",
    "test": "jest",
    "update-schema": "cp ../spec/v1/schema.json src/schema/v1.json"
  },
  "dependencies": {
    "@actions/core": "^1.10.1",
    "ajv": "^8.12.0",
    "ajv-formats": "^2.1.1",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.10.0",
    "@vercel/ncc": "^0.38.1",
    "jest": "^29.7.0",
    "typescript": "^5.3.0"
  }
}
```

### action/src/index.ts

```typescript
import * as core from '@actions/core';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from './schema/v1.json';

interface ValidationResult {
  valid: boolean;
  errors: any[];
  warnings: any[];
  manifest: any;
}

function validate(manifestPath: string): ValidationResult {
  // Check file exists
  if (!fs.existsSync(manifestPath)) {
    return {
      valid: false,
      errors: [{ path: manifestPath, message: 'File not found' }],
      warnings: [],
      manifest: null,
    };
  }

  // Parse YAML
  const content = fs.readFileSync(manifestPath, 'utf8');
  let manifest: any;
  
  try {
    manifest = yaml.load(content);
  } catch (e: any) {
    return {
      valid: false,
      errors: [{ path: manifestPath, message: `Invalid YAML: ${e.message}` }],
      warnings: [],
      manifest: null,
    };
  }

  // Validate against schema
  const ajv = new Ajv({ allErrors: true, verbose: true });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);
  const valid = validateSchema(manifest);

  const errors = (validateSchema.errors || []).map(err => ({
    path: err.instancePath || '/',
    message: err.message,
    keyword: err.keyword,
    params: err.params,
  }));

  // Custom warnings (not schema violations, but recommendations)
  const warnings: any[] = [];
  
  // Warn if ai-gate without judgment SLOs
  if (manifest?.spec?.type === 'ai-gate' && !manifest?.spec?.slos?.judgment) {
    warnings.push({
      path: '/spec/slos',
      message: 'AI gate service without judgment SLOs defined. Consider adding reversal_rate, calibration, etc.',
    });
  }

  // Warn if critical tier without runbook
  if (manifest?.metadata?.tier === 'critical' && !manifest?.spec?.ownership?.runbook) {
    warnings.push({
      path: '/spec/ownership/runbook',
      message: 'Critical tier service without runbook URL',
    });
  }

  return { valid, errors, warnings, manifest };
}

async function run(): Promise<void> {
  try {
    const manifestPath = core.getInput('manifest');
    const strict = core.getBooleanInput('strict');

    core.info(`Validating: ${manifestPath}`);
    
    const result = validate(manifestPath);

    // Set outputs
    core.setOutput('valid', result.valid ? 'true' : 'false');
    core.setOutput('errors', JSON.stringify(result.errors));
    core.setOutput('warnings', JSON.stringify(result.warnings));
    
    if (result.manifest) {
      core.setOutput('service-name', result.manifest.metadata?.name || '');
      core.setOutput('service-type', result.manifest.spec?.type || 'api');
      core.setOutput('service-tier', result.manifest.metadata?.tier || 'standard');
    }

    // Report errors
    if (result.errors.length > 0) {
      core.startGroup(`❌ Validation Errors (${result.errors.length})`);
      for (const error of result.errors) {
        core.error(`${error.path}: ${error.message}`, { file: manifestPath });
      }
      core.endGroup();
    }

    // Report warnings
    if (result.warnings.length > 0) {
      core.startGroup(`⚠️ Warnings (${result.warnings.length})`);
      for (const warning of result.warnings) {
        core.warning(`${warning.path}: ${warning.message}`, { file: manifestPath });
      }
      core.endGroup();
    }

    // Determine outcome
    if (!result.valid) {
      core.setFailed(`Manifest validation failed with ${result.errors.length} error(s)`);
    } else if (strict && result.warnings.length > 0) {
      core.setFailed(`Manifest has ${result.warnings.length} warning(s) (strict mode enabled)`);
    } else {
      const name = result.manifest?.metadata?.name || 'unknown';
      const type = result.manifest?.spec?.type || 'api';
      core.info(`✅ Valid: ${name} (type: ${type})`);
    }

  } catch (error: any) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();
```

### action/src/schema/v1.json

```json
// Copy of spec/v1/schema.json
// Duplicated here for bundling - keep in sync with update-schema script
```

## Usage

Users reference the action directly from the repo:

```yaml
# .github/workflows/validate.yml
name: Validate Reliability Manifest

on:
  pull_request:
    paths:
      - 'service.reliability.yaml'
      - '**/service.reliability.yaml'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Validate OpenSRM Manifest
        uses: rsionnach/opensrm@v1
        with:
          manifest: service.reliability.yaml
```

For specific versions:
```yaml
- uses: rsionnach/opensrm@v1        # Latest v1.x
- uses: rsionnach/opensrm@v1.2.0    # Specific version
- uses: rsionnach/opensrm@main      # Latest (not recommended)
```

## Build & Release Process

### Building the Action

```bash
cd action
npm install
npm run update-schema  # Sync schema from spec/
npm run build          # Bundle to dist/
```

The `dist/` folder is committed to the repo (standard practice for JS actions).

### Release Process

1. Update spec and/or action code
2. Build the action: `cd action && npm run build`
3. Commit changes including `action/dist/`
4. Tag release: `git tag v1.0.0 && git push --tags`
5. Update major version tag: `git tag -f v1 && git push -f --tags`

### CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  validate-examples:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Validate example manifests
        uses: ./  # Test action from this repo
        with:
          manifest: examples/api-minimal.yaml

  test-action:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        manifest:
          - examples/api-minimal.yaml
          - examples/api-full.yaml
          - examples/ai-gate-minimal.yaml
          - examples/ai-gate-full.yaml
    steps:
      - uses: actions/checkout@v4
      
      - name: Test ${{ matrix.manifest }}
        uses: ./
        with:
          manifest: ${{ matrix.manifest }}

  test-invalid:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Create invalid manifest
        run: echo "invalid: yaml: content" > invalid.yaml
      
      - name: Should fail validation
        id: validate
        uses: ./
        continue-on-error: true
        with:
          manifest: invalid.yaml
      
      - name: Check it failed
        run: |
          if [ "${{ steps.validate.outputs.valid }}" = "true" ]; then
            echo "Expected validation to fail"
            exit 1
          fi

  build-action:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install and build
        working-directory: action
        run: |
          npm ci
          npm run build
      
      - name: Check dist is up to date
        run: |
          if [ -n "$(git status --porcelain action/dist)" ]; then
            echo "action/dist is out of date. Run 'cd action && npm run build' and commit."
            exit 1
          fi
```

## README Updates

Add to the main README.md:

```markdown
## GitHub Action

Validate OpenSRM manifests in your CI pipeline:

\`\`\`yaml
- uses: rsionnach/opensrm@v1
  with:
    manifest: service.reliability.yaml
\`\`\`

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `manifest` | No | `service.reliability.yaml` | Path to manifest file |
| `strict` | No | `false` | Fail on warnings |

### Outputs

| Output | Description |
|--------|-------------|
| `valid` | `true` if manifest is valid |
| `errors` | JSON array of validation errors |
| `warnings` | JSON array of validation warnings |
| `service-name` | Extracted service name |
| `service-type` | Extracted service type (`api`, `worker`, `stream`, `ai-gate`) |
| `service-tier` | Extracted service tier (`critical`, `standard`, `low`) |

### Example Workflow

\`\`\`yaml
name: Validate Reliability Manifest

on:
  pull_request:
    paths:
      - 'service.reliability.yaml'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Validate manifest
        id: validate
        uses: rsionnach/opensrm@v1
        
      - name: Use outputs
        run: |
          echo "Service: ${{ steps.validate.outputs.service-name }}"
          echo "Type: ${{ steps.validate.outputs.service-type }}"
          echo "Tier: ${{ steps.validate.outputs.service-tier }}"
\`\`\`
```

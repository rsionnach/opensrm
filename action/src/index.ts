import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import schemaV1 from './schema/v1.json';

interface ValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface SRMManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    team: string;
    tier: string;
    template?: string;
    description?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: {
    type?: string;
    contract?: {
      availability?: number;
      latency?: object;
      throughput?: object;
      judgment?: object;
    };
    slos?: {
      availability?: object;
      latency?: object;
      error_rate?: object;
      throughput?: object;
      processing_time?: object;
      lag?: object;
      judgment?: object;
      success_rate?: object;
      duration?: object;
      schedule_adherence?: object;
      data_freshness?: object;
      query_latency?: object;
      replication_lag?: object;
      connection_availability?: object;
      openslo?: object[];
      custom?: object[];
    };
    dependencies?: Array<{
      service: string;
      type?: string;
      critical?: boolean;
      expects?: {
        availability?: number;
        latency?: object;
      };
      manifest?: string;
    }>;
    instrumentation?: {
      events: {
        decision: string;
        reversal: string;
        outcome?: string;
      };
      attributes?: object;
    };
    ownership?: {
      team: string;
      slack?: string;
      email?: string;
      escalation?: string;
      pagerduty?: object;
      runbook?: string;
      documentation?: string;
    };
    observability?: object;
    deployment?: object;
  };
}

function checkBestPractices(manifest: SRMManifest, filePath: string): string[] {
  const warnings: string[] = [];

  // Check for description in metadata
  if (!manifest.metadata.description) {
    warnings.push('Missing recommended field: metadata.description');
  }

  // Check for at least one SLO
  if (!manifest.spec.slos || Object.keys(manifest.spec.slos).length === 0) {
    warnings.push('No SLOs defined - consider adding availability, latency, or other SLOs');
  }

  // Check for ownership information
  if (!manifest.spec.ownership) {
    warnings.push('Missing recommended section: spec.ownership');
  } else {
    if (!manifest.spec.ownership.slack && !manifest.spec.ownership.email) {
      warnings.push('Missing recommended field: ownership.slack or ownership.email for team contact');
    }
    if (!manifest.spec.ownership.runbook) {
      warnings.push('Missing recommended field: ownership.runbook');
    }
  }

  // Check for observability section for non-minimal manifests
  if (!manifest.spec.observability && manifest.metadata.tier !== 'low') {
    warnings.push('Missing recommended section: spec.observability for non-low tier services');
  }

  // AI Gate specific checks
  if (manifest.spec.type === 'ai-gate') {
    if (!manifest.spec.slos?.judgment) {
      warnings.push('AI Gate service missing recommended judgment SLOs');
    }
    if (!manifest.spec.instrumentation) {
      warnings.push('AI Gate service missing recommended instrumentation section');
    }
  }

  // Batch service specific checks
  if (manifest.spec.type === 'batch') {
    if (!manifest.spec.slos?.success_rate) {
      warnings.push('Batch service missing recommended SLO: success_rate');
    }
    if (!manifest.spec.slos?.duration) {
      warnings.push('Batch service missing recommended SLO: duration');
    }
    if (manifest.spec.slos?.latency) {
      warnings.push('Batch service has latency SLO - consider using duration SLO instead (latency is typically for request/response services)');
    }
  }

  // Database service specific checks
  if (manifest.spec.type === 'database') {
    if (!manifest.spec.slos?.availability) {
      warnings.push('Database service missing recommended SLO: availability');
    }
    if (!manifest.spec.slos?.query_latency) {
      warnings.push('Database service missing recommended SLO: query_latency');
    }
    if (manifest.spec.slos?.latency) {
      warnings.push('Database service has latency SLO - consider using query_latency SLO instead (more specific to database workloads)');
    }
  }

  // Worker service specific checks
  if (manifest.spec.type === 'worker') {
    if (!manifest.spec.slos?.processing_time) {
      warnings.push('Worker service missing recommended SLO: processing_time');
    }
    if (manifest.spec.slos?.latency) {
      warnings.push('Worker service has latency SLO - consider using processing_time SLO instead (latency is typically for request/response services)');
    }
  }

  // Stream service specific checks
  if (manifest.spec.type === 'stream') {
    if (!manifest.spec.slos?.lag) {
      warnings.push('Stream service missing recommended SLO: lag');
    }
  }

  // Contract vs SLO consistency check
  if (manifest.spec.contract && manifest.spec.slos) {
    const contractAvail = manifest.spec.contract.availability;
    const sloAvail = (manifest.spec.slos.availability as { target?: number })?.target;

    if (contractAvail !== undefined && sloAvail !== undefined) {
      if (sloAvail < contractAvail) {
        warnings.push(`SLO availability target (${sloAvail}) is looser than contract (${contractAvail}) - SLOs should be tighter than contracts`);
      }
    }
  }

  return warnings;
}

async function validateManifest(filePath: string, ajv: Ajv): Promise<ValidationResult> {
  const result: ValidationResult = {
    file: filePath,
    valid: false,
    errors: [],
    warnings: [],
  };

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let manifest: unknown;

    try {
      manifest = yaml.load(content);
    } catch (parseError) {
      result.errors.push(`YAML parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      return result;
    }

    if (!manifest || typeof manifest !== 'object') {
      result.errors.push('Manifest must be a valid YAML object');
      return result;
    }

    const validate = ajv.compile(schemaV1);
    const valid = validate(manifest);

    if (!valid && validate.errors) {
      for (const error of validate.errors) {
        const path = error.instancePath || '/';
        result.errors.push(`${path}: ${error.message}`);
      }
      return result;
    }

    result.valid = true;

    // Check best practices and add warnings (only for ServiceReliabilityManifest, not Templates)
    const manifestObj = manifest as { kind?: string };
    if (manifestObj.kind === 'ServiceReliabilityManifest') {
      result.warnings = checkBestPractices(manifest as SRMManifest, filePath);
    }

    return result;
  } catch (error) {
    result.errors.push(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
}

async function run(): Promise<void> {
  try {
    const manifestPattern = core.getInput('manifest', { required: true });
    const schemaVersion = core.getInput('schema-version') || 'v1';
    const strict = core.getInput('strict') === 'true';

    core.info(`Validating manifests matching: ${manifestPattern}`);
    core.info(`Schema version: ${schemaVersion}`);
    core.info(`Strict mode: ${strict}`);

    // Initialize AJV
    const ajv = new Ajv({
      allErrors: true,
      strict: false,
    });
    addFormats(ajv);

    // Find all matching files
    const globber = await glob.create(manifestPattern);
    const files = await globber.glob();

    if (files.length === 0) {
      core.setFailed(`No files found matching pattern: ${manifestPattern}`);
      return;
    }

    core.info(`Found ${files.length} file(s) to validate`);

    const results: ValidationResult[] = [];
    let hasErrors = false;
    let totalWarnings = 0;

    for (const file of files) {
      core.info(`\nValidating: ${file}`);
      const result = await validateManifest(file, ajv);
      results.push(result);

      if (!result.valid) {
        hasErrors = true;
        core.error(`${path.basename(file)}: INVALID`);
        for (const error of result.errors) {
          core.error(`  - ${error}`);
        }
      } else {
        core.info(`${path.basename(file)}: VALID`);
      }

      if (result.warnings.length > 0) {
        totalWarnings += result.warnings.length;
        for (const warning of result.warnings) {
          core.warning(`${path.basename(file)}: ${warning}`);
        }
      }
    }

    // Set outputs
    core.setOutput('valid', String(!hasErrors && (!strict || totalWarnings === 0)));
    core.setOutput('validated-count', String(files.length));
    core.setOutput('warnings-count', String(totalWarnings));

    // Summary
    core.info('\n--- Summary ---');
    core.info(`Files validated: ${files.length}`);
    core.info(`Valid: ${results.filter(r => r.valid).length}`);
    core.info(`Invalid: ${results.filter(r => !r.valid).length}`);
    core.info(`Warnings: ${totalWarnings}`);

    if (hasErrors) {
      core.setFailed('One or more manifests failed validation');
    } else if (strict && totalWarnings > 0) {
      core.setFailed(`Strict mode enabled: ${totalWarnings} warning(s) found`);
    } else {
      core.info('\nAll manifests are valid!');
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

run();

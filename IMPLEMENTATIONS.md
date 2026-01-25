# Implementations

Tools and platforms that implement the Service Reliability Manifest specification.

## Reference Implementation

| Tool | Description | Status |
|------|-------------|--------|
| [NthLayer](https://github.com/rsionnach/nthlayer) | CI/CD enforcement tool for SRM manifests | Reference implementation |

## Validators

| Tool | Description | Language |
|------|-------------|----------|
| JSON Schema | Use the [schema.json](spec/v1/schema.json) with any JSON Schema validator | Any |

## Integrations

*No integrations listed yet.*

## Add Your Implementation

Building a tool that implements SRM? We'd love to list it here!

### Requirements

To be listed, your implementation should:

1. Support the current spec version (`srm/v1`)
2. Validate manifests against the schema
3. Be publicly available (open source preferred)
4. Include documentation on usage

### How to Add

1. Fork this repository
2. Add your tool to the appropriate section in this file
3. Submit a pull request with:
   - Tool name and link
   - Brief description
   - Implementation language/platform
   - Status (stable, beta, alpha)

### Implementation Categories

**Validators** - Tools that validate manifest syntax and semantics

**Enforcers** - Tools that enforce manifest requirements (metrics exist, dashboards exist, etc.)

**Generators** - Tools that generate manifests from existing infrastructure

**Integrations** - Plugins for CI/CD, service catalogs, observability platforms, etc.

## Compliance

We're working on a compliance test suite to help implementations verify their conformance to the specification. Stay tuned!

# Governance

This document describes the governance model for the Service Reliability Manifest specification.

## Principles

1. **Open development** - All spec development happens in the open on GitHub
2. **Consensus-driven** - Major changes require broad agreement
3. **Backward compatible** - Breaking changes are avoided when possible
4. **Vendor neutral** - The spec serves the community, not any single vendor

## Roles

### Contributors
Anyone who contributes to the project via issues, discussions, or pull requests.

### Maintainers
Individuals with write access to the repository who review and merge contributions. Maintainers are responsible for:
- Reviewing pull requests
- Ensuring quality and consistency
- Guiding the RFC process
- Releasing new versions

### Steering Committee
A group of maintainers who make decisions on major spec changes and project direction.

## Decision Making

### Minor Changes
- Typo fixes, clarifications, and documentation improvements
- Can be merged by any maintainer
- No RFC required

### Significant Changes
Changes that affect the spec semantics, add new fields, or modify existing behavior require the RFC process:

1. **Proposal** - Open an issue with the `rfc` label describing:
   - The problem being solved
   - Proposed solution with examples
   - Alternatives considered
   - Backward compatibility impact

2. **Discussion** - Community provides feedback (minimum 2 weeks)

3. **Revision** - Author updates proposal based on feedback

4. **Decision** - Steering committee votes:
   - Approve: Move forward with implementation
   - Request changes: Continue discussion
   - Reject: Close with explanation

5. **Implementation** - Create PR implementing the approved RFC

### Breaking Changes
Changes that break backward compatibility require:
- Clear justification
- Migration path documented
- Deprecation period in previous version
- Supermajority (2/3) approval from steering committee

## Versioning

The specification follows semantic versioning:

- **Major version** (e.g., v2) - Breaking changes
- **Minor version** (e.g., v1.1) - New features, backward compatible
- **Patch version** (e.g., v1.0.1) - Clarifications and fixes

## Release Process

1. Maintainer proposes release with changelog
2. Community review period (1 week minimum)
3. Steering committee approves
4. Release tagged and published

## Amendments

This governance document can be amended through the standard RFC process.

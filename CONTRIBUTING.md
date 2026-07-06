# Contributing to OpenSRM

Thank you for considering contributing to **OpenSRM** — the open
standard for declaring service reliability requirements (SLOs, contracts,
dependencies, notifications) in machine-readable form. This is a
**specification-only** repository: YAML + JSON Schema, no code and no runtime.
The implementation that consumes the spec is NthLayer.

## Ways to Contribute

- **Report issues** — found a bug or ambiguity in the spec?
  [Open an issue](https://github.com/rsionnach/opensrm/issues).
- **Discuss** — [GitHub Discussions](https://github.com/rsionnach/nthlayer/discussions) for the wider ecosystem.
- **Suggest improvements** — propose new fields, clarifications, or
  real-world use cases that should inform the spec.
- **Submit changes** — fix typos, add examples, or propose spec changes (see
  the RFC process below).

## Working on the Spec

There is nothing to build or install — the spec is authored as Markdown +
JSON Schema:

- Specification: `spec/v1/specification.md`
- JSON Schema: `spec/v1/schema.json`
- Format conventions (service-type mappings, SLO structure, component
  taxonomy): `docs/spec-conventions.md`

To contribute:

1. Fork the repository and clone it locally.
2. Create a branch for your change.
3. Make your change following the guidelines below.
4. Open a pull request.

### Example Manifests

- Place examples in the `examples/` directory.
- Name files descriptively: `<service-type>.reliability.yaml`.
- Include comments explaining key decisions.
- Ensure examples validate against `spec/v1/schema.json` — e.g. with any JSON
  Schema validator:
  ```bash
  uvx check-jsonschema --schemafile spec/v1/schema.json examples/*.yaml
  ```
  (PR review also confirms this.)

### Specification Changes

1. **Minor clarifications** can be submitted directly as PRs.
2. **Significant changes** require an RFC — see [GOVERNANCE.md](GOVERNANCE.md).

When proposing spec changes, explain the problem, show example usage,
consider backward compatibility, and update the JSON Schema if needed. Keep
these load-bearing conventions intact:

- The spec API version is `opensrm/v1` — no ad-hoc version strings.
- Ratios are `0.0–1.0`, **not** percentages.
- Durations are numeric + unit suffix (`100ms`, `30d`); units `ms s m h d w`.
- `spec.contract` (external promises) and `spec.slos` (internal targets) are
  distinct surfaces — do not conflate them.

## Pull Request Process

1. Ensure examples validate against the schema.
2. Update documentation and examples as needed.
3. Reference any related issues.

## Finding Something to Work On

Browse [open issues](https://github.com/rsionnach/opensrm/issues) and look for
`good-first-issue` / `help-wanted` labels. This repo is also the canonical home
of the ecosystem-wide **Beads** (Dolt) database that maintainers use to track
detailed work — every `bd` command across all member repos runs from here
(`cd opensrm && bd ready --json`). Do not create per-repo `.beads/` databases.

## Code of Conduct

Be respectful and constructive — we're all here to build better reliability
tooling.

## Questions?

- [GitHub Issues](https://github.com/rsionnach/opensrm/issues) — bugs and spec questions.
- [GitHub Discussions](https://github.com/rsionnach/nthlayer/discussions) — general questions.

## License

By contributing, you agree that your contributions will be licensed under the
Apache License 2.0 (see `LICENSE`).

---

**Thank you for helping make OpenSRM better!**

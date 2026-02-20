# OpenSRM Ecosystem Components

Components that implement, extend, or consume the OpenSRM specification.

## Component Status

| Component | Purpose | Status | Location |
|-----------|---------|--------|----------|
| [NthLayer](https://github.com/rsionnach/nthlayer) | Reference implementation -- validation, Prometheus rules, Grafana dashboards | Partial | External repo |
| [Sitrep](sitrep/) | Pre-correlation layer for AI-native observability | In design | `components/sitrep/` |
| [IncidentTown](incidenttown/) | Multi-agent incident response system | Architecture | `components/incidenttown/` |

## How Components Fit Together

```
OpenSRM Manifests --> NthLayer --> Monitoring artifacts + Topology
                                        |
                                        v
                   Telemetry -------> Sitrep -------> Snapshots
                                                         |
                                                         v
                                                   IncidentTown
                                                   (AI agents)
```

See [ARCHITECTURE.md](../ARCHITECTURE.md) for detailed data flows.

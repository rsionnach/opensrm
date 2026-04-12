# SLO Target Guidelines

## Availability Targets

| Target | Monthly Downtime | Tier | Use For |
|--------|------------------|------|---------|
| 99.95%+ | 21.6 minutes | critical | Revenue/safety impact, payment processing, auth |
| 99.9%  | 43.2 minutes | high | Significant user impact, core features |
| 99.5%  | 3.6 hours | standard | Moderate impact, standard services |
| 99%    | 7.2 hours | low | Minimal impact, batch processing, internal tools |

## Latency Targets

| Percentile | Typical Target | Notes |
|------------|----------------|-------|
| p50 | 50-100ms | User-perceived "snappy" |
| p99 | 200-500ms | Catches outliers |
| p999 | 1-2s | Extreme tail |

## Setting Targets

1. **Start conservative**: Easier to tighten than loosen
2. **Measure first**: Set targets based on actual performance
3. **Consider dependencies**: You can't exceed your weakest link
4. **Budget for change**: Leave headroom for deployments

# OpenSRM Ecosystem Animation

Animated visualization of the OpenSRM ecosystem data flow using [Motion Canvas](https://motioncanvas.io/).

## Setup

```bash
npm install
npm run dev
```

This opens the Motion Canvas editor at `http://localhost:9000`.

## Exporting

In the Motion Canvas editor:

1. Click the **Render** button (top right)
2. Choose output format:
   - **GIF** — for README
   - **MP4** — for website/talks
   - **PNG Sequence** — for slides

Recommended settings:
- Resolution: 1920x1080 (or 1280x720 for GIF)
- Frame rate: 30fps
- GIF quality: High

## Animation Flow

The animation shows:

1. **OpenSRM** (spec) defines service reliability requirements
2. **NthLayer** reads spec, generates Prometheus/Grafana/PagerDuty configs
3. **Sitrep** correlates signals with context (changes, alerts, topology)
4. **Consumer** (AI/Human) receives correlated snapshot, makes decision
5. **Telemetry** records decision with confidence
6. **Judgment SLOs** measure decision quality (reversal rate)
7. **Feedback loop** calibrates correlation weights

## Customization

Edit `src/scenes/ecosystem.tsx` to:

- Change colors (see `colors` object)
- Adjust timing (change `waitFor()` durations)
- Update labels (modify `labelTextRef().text()` calls)
- Add/remove components

## Output Files

After rendering, copy outputs to your repos:

```bash
# For opensrm README
cp output/ecosystem.gif /path/to/opensrm/assets/ecosystem-flow.gif

# For website
cp output/ecosystem.mp4 /path/to/website/static/
```

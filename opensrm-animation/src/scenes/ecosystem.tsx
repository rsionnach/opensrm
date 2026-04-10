import {makeScene2D, Rect, Txt, Circle, Line} from '@motion-canvas/2d';
import {all, createRef, waitFor, easeOutCubic, easeInOutCubic} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  // Colors - Nord theme (nordtheme.com)
  const colors = {
    bg: '#2e3440',          // Nord Polar Night 1
    bgLight: '#3b4252',     // Nord Polar Night 2
    spec: '#5e81ac',        // Nord Frost 4 - OpenSRM
    impl: '#a3be8c',        // Nord Aurora green - NthLayer
    sitrep: '#ebcb8b',      // Nord Aurora yellow - Sitrep agent
    mayday: '#d08770',      // Nord Aurora orange - Mayday agents
    telemetry: '#b48ead',   // Nord Aurora purple - Telemetry
    arbiter: '#88c0d0',     // Nord Frost 2 - Arbiter
    alert: '#bf616a',       // Nord Aurora red - Alert signal
    change: '#88c0d0',      // Nord Frost 2 - Change events
    logs: '#d08770',        // Nord Aurora orange - Log errors
    metrics: '#81a1c1',     // Nord Frost 3 - Metrics
    text: '#eceff4',        // Nord Snow Storm 3
    textMuted: '#d8dee9',   // Nord Snow Storm 1
    line: '#4c566a',        // Nord Polar Night 4
    pulse: '#ebcb8b',       // Nord Aurora yellow - enriched pulse
    success: '#a3be8c',     // Nord Aurora green - success
    dark: '#2e3440',        // Nord Polar Night 1 - subtitle text on bright boxes
  };

  view.fill(colors.bg);

  // ============================================
  // PHASE 1: PROBLEM FRAMING ELEMENTS
  // ============================================

  const problemTextRef = createRef<Txt>();
  view.add(
    <Txt
      ref={problemTextRef}
      x={0}
      y={-30}
      text=""
      fill={colors.text}
      fontFamily="JetBrains Mono"
      fontSize={24}
      opacity={0}
      textAlign="center"
    />
  );

  const problemSubRef = createRef<Txt>();
  view.add(
    <Txt
      ref={problemSubRef}
      x={0}
      y={20}
      text=""
      fill={colors.textMuted}
      fontFamily="JetBrains Mono"
      fontSize={18}
      opacity={0}
      textAlign="center"
    />
  );

  // Scattered signal dots for problem framing
  const scatterDots: ReturnType<typeof createRef<Circle>>[] = [];
  const scatterPositions = [
    [-300, -80], [-200, 60], [-100, -40], [0, 80], [100, -60],
    [200, 40], [300, -20], [-250, 30], [150, -80], [250, 70],
  ];
  for (const [sx, sy] of scatterPositions) {
    const ref = createRef<Circle>();
    scatterDots.push(ref);
    view.add(
      <Circle
        ref={ref}
        x={sx}
        y={sy}
        width={10}
        height={10}
        fill={colors.alert}
        opacity={0}
      />
    );
  }

  // ============================================
  // PERSISTENT HEADER
  // ============================================

  const headerRef = createRef<Txt>();
  view.add(
    <Txt
      ref={headerRef}
      x={0}
      y={-345}
      text="The OpenSRM Ecosystem"
      fill={colors.textMuted}
      fontFamily="JetBrains Mono"
      fontSize={16}
      opacity={0}
    />
  );

  // ============================================
  // LAYER LABELS (Static / Agent distinction)
  // ============================================

  const staticLabelRef = createRef<Txt>();
  view.add(
    <Txt
      ref={staticLabelRef}
      x={-420}
      y={-310}
      text="STATIC LAYER"
      fill={colors.textMuted}
      fontFamily="JetBrains Mono"
      fontSize={12}
      letterSpacing={2}
      opacity={0}
    />
  );

  const agentLabelRef = createRef<Txt>();
  view.add(
    <Txt
      ref={agentLabelRef}
      x={130}
      y={-310}
      text="AGENT LAYER"
      fill={colors.textMuted}
      fontFamily="JetBrains Mono"
      fontSize={12}
      letterSpacing={2}
      opacity={0}
    />
  );

  // Divider line between static and agent layers
  const layerDividerRef = createRef<Line>();
  view.add(
    <Line
      ref={layerDividerRef}
      points={[
        [-270, -300],
        [-270, 320],
      ]}
      stroke={colors.textMuted}
      lineWidth={1}
      lineDash={[4, 6]}
      opacity={0}
      end={0}
    />
  );

  // ============================================
  // COMPONENT NODES
  // ============================================

  // --- STATIC LAYER (left) ---

  // OpenSRM (spec) - data source
  const opensrmRef = createRef<Rect>();
  view.add(
    <Rect
      ref={opensrmRef}
      x={-420}
      y={-200}
      width={220}
      height={120}
      radius={14}
      fill={colors.spec}
      opacity={0}
    >
      <Txt
        text="OpenSRM"
        fill={colors.text}
        fontFamily="JetBrains Mono"
        fontSize={24}
        fontWeight={700}
        y={-16}
      />
      <Txt
        text="data source"
        fill={colors.textMuted}
        fontFamily="JetBrains Mono"
        fontSize={14}
        y={16}
      />
    </Rect>
  );

  // NthLayer - deterministic tool
  const nthlayerRef = createRef<Rect>();
  view.add(
    <Rect
      ref={nthlayerRef}
      x={-420}
      y={-40}
      width={220}
      height={120}
      radius={14}
      fill={colors.impl}
      opacity={0}
    >
      <Txt
        text="NthLayer"
        fill={colors.text}
        fontFamily="JetBrains Mono"
        fontSize={24}
        fontWeight={700}
        y={-16}
      />
      <Txt
        text="tool — enforce"
        fill={colors.dark}
        fontFamily="JetBrains Mono"
        fontSize={14}
        y={16}
      />
    </Rect>
  );

  // Generated artifacts (below NthLayer)
  const artifactsRef = createRef<Rect>();
  view.add(
    <Rect
      ref={artifactsRef}
      x={-420}
      y={120}
      width={200}
      height={100}
      radius={10}
      fill={colors.bgLight}
      stroke={colors.impl}
      lineWidth={2}
      opacity={0}
    >
      <Txt
        text="Prom rules"
        fill={colors.textMuted}
        fontFamily="JetBrains Mono"
        fontSize={13}
        y={-28}
      />
      <Txt
        text="Grafana"
        fill={colors.textMuted}
        fontFamily="JetBrains Mono"
        fontSize={13}
        y={-4}
      />
      <Txt
        text="Topology"
        fill={colors.textMuted}
        fontFamily="JetBrains Mono"
        fontSize={13}
        y={20}
      />
    </Rect>
  );

  // --- AGENT LAYER (right) ---

  // Sitrep - correlation agent
  const sitrepRef = createRef<Rect>();
  view.add(
    <Rect
      ref={sitrepRef}
      x={-60}
      y={50}
      width={220}
      height={120}
      radius={14}
      fill={colors.sitrep}
      opacity={0}
    >
      <Txt
        text="Sitrep"
        fill={colors.dark}
        fontFamily="JetBrains Mono"
        fontSize={26}
        fontWeight={700}
        y={-16}
      />
      <Txt
        text="agent — correlate"
        fill={colors.dark}
        fontFamily="JetBrains Mono"
        fontSize={14}
        y={16}
      />
    </Rect>
  );

  // Mayday - incident response agents
  const maydayRef = createRef<Rect>();
  view.add(
    <Rect
      ref={maydayRef}
      x={210}
      y={50}
      width={220}
      height={120}
      radius={14}
      fill={colors.mayday}
      opacity={0}
    >
      <Txt
        text="Mayday"
        fill={colors.text}
        fontFamily="JetBrains Mono"
        fontSize={26}
        fontWeight={700}
        y={-16}
      />
      <Txt
        text="agents — respond"
        fill={colors.dark}
        fontFamily="JetBrains Mono"
        fontSize={14}
        y={16}
      />
    </Rect>
  );

  // Telemetry (OTel) — styled as output/integration, not a core ecosystem component
  const telemetryRef = createRef<Rect>();
  view.add(
    <Rect
      ref={telemetryRef}
      x={470}
      y={50}
      width={220}
      height={120}
      radius={14}
      fill={colors.bgLight}
      stroke={colors.telemetry}
      lineWidth={2}
      opacity={0}
    >
      <Txt
        text="Telemetry"
        fill={colors.textMuted}
        fontFamily="JetBrains Mono"
        fontSize={24}
        fontWeight={700}
        y={-16}
      />
      <Txt
        text="OTel — measure"
        fill={colors.telemetry}
        fontFamily="JetBrains Mono"
        fontSize={14}
        y={16}
      />
    </Rect>
  );

  // Judgment SLOs (below Telemetry)
  const judgmentRef = createRef<Rect>();
  view.add(
    <Rect
      ref={judgmentRef}
      x={470}
      y={210}
      width={190}
      height={60}
      radius={10}
      fill={colors.bgLight}
      stroke={colors.telemetry}
      lineWidth={2}
      opacity={0}
    >
      <Txt
        text="Judgment SLOs"
        fill={colors.textMuted}
        fontFamily="JetBrains Mono"
        fontSize={14}
      />
    </Rect>
  );

  // Reliability Arbiter (below Mayday, in feedback path)
  const arbiterRef = createRef<Rect>();
  view.add(
    <Rect
      ref={arbiterRef}
      x={210}
      y={260}
      width={220}
      height={80}
      radius={12}
      fill={colors.arbiter}
      opacity={0}
    >
      <Txt
        text="Arbiter"
        fill={colors.dark}
        fontFamily="JetBrains Mono"
        fontSize={22}
        fontWeight={700}
        y={-12}
      />
      <Txt
        text="agent — govern"
        fill={colors.dark}
        fontFamily="JetBrains Mono"
        fontSize={12}
        y={14}
      />
    </Rect>
  );

  // ============================================
  // CONNECTING LINES
  // ============================================

  // OpenSRM → NthLayer (dashed, setup-time)
  const specLineRef = createRef<Line>();
  view.add(
    <Line
      ref={specLineRef}
      points={[
        [-420, -140],
        [-420, -100],
      ]}
      stroke={colors.spec}
      lineWidth={2}
      lineDash={[8, 4]}
      opacity={0}
      end={0}
    />
  );

  // NthLayer → Artifacts
  const artifactLineRef = createRef<Line>();
  view.add(
    <Line
      ref={artifactLineRef}
      points={[
        [-420, 20],
        [-420, 70],
      ]}
      stroke={colors.impl}
      lineWidth={2}
      opacity={0}
      end={0}
    />
  );

  // Artifacts → Sitrep (dashed, "topology" — static reference, crosses layer boundary)
  const topologyLineRef = createRef<Line>();
  view.add(
    <Line
      ref={topologyLineRef}
      points={[
        [-320, 120],
        [-170, 50],
      ]}
      stroke={colors.impl}
      lineWidth={2}
      lineDash={[6, 4]}
      opacity={0}
      end={0}
    />
  );

  const topologyLabelRef = createRef<Txt>();
  view.add(
    <Txt
      ref={topologyLabelRef}
      x={-250}
      y={72}
      text="topology"
      fill={colors.impl}
      fontFamily="JetBrains Mono"
      fontSize={12}
      opacity={0}
    />
  );

  // Sitrep → Mayday
  const flowLine2Ref = createRef<Line>();
  view.add(
    <Line
      ref={flowLine2Ref}
      points={[
        [50, 50],
        [100, 50],
      ]}
      stroke={colors.line}
      lineWidth={3}
      opacity={0}
      end={0}
    />
  );

  // Mayday → Telemetry
  const flowLine3Ref = createRef<Line>();
  view.add(
    <Line
      ref={flowLine3Ref}
      points={[
        [320, 50],
        [360, 50],
      ]}
      stroke={colors.line}
      lineWidth={3}
      opacity={0}
      end={0}
    />
  );

  // Telemetry → Judgment SLOs
  const judgmentLineRef = createRef<Line>();
  view.add(
    <Line
      ref={judgmentLineRef}
      points={[
        [470, 110],
        [470, 180],
      ]}
      stroke={colors.telemetry}
      lineWidth={2}
      opacity={0}
      end={0}
    />
  );

  // Judgment SLOs → Arbiter
  const arbiterLineRef = createRef<Line>();
  view.add(
    <Line
      ref={arbiterLineRef}
      points={[
        [375, 210],
        [320, 240],
      ]}
      stroke={colors.arbiter}
      lineWidth={2}
      opacity={0}
      end={0}
    />
  );

  // Arbiter → Sitrep (feedback, dashed)
  const feedbackLineRef = createRef<Line>();
  view.add(
    <Line
      ref={feedbackLineRef}
      points={[
        [100, 260],
        [-60, 260],
        [-60, 110],
      ]}
      stroke={colors.arbiter}
      lineWidth={2}
      lineDash={[6, 3]}
      opacity={0}
      end={0}
    />
  );

  // Arbiter → Mayday (autonomy policy, dashed)
  const arbiterToMaydayRef = createRef<Line>();
  view.add(
    <Line
      ref={arbiterToMaydayRef}
      points={[
        [210, 220],
        [210, 110],
      ]}
      stroke={colors.arbiter}
      lineWidth={2}
      lineDash={[4, 4]}
      opacity={0}
      end={0}
    />
  );

  // ============================================
  // SIGNAL DOTS (converge on Sitrep)
  // ============================================

  // Signal dots — horizontal row below Sitrep (y=200), spread across x=-170 to x=50
  // Each dot flows upward into Sitrep one at a time

  // Alert signal — from Alertmanager
  const alertDotRef = createRef<Circle>();
  view.add(
    <Circle ref={alertDotRef} x={-165} y={200} width={22} height={22}
      fill={colors.alert} opacity={0} />
  );
  const alertLabelRef = createRef<Txt>();
  view.add(
    <Txt ref={alertLabelRef} x={-165} y={228} text="Alerts"
      fill={colors.alert} fontFamily="JetBrains Mono" fontSize={14} opacity={0} />
  );

  // Change event — deploy webhook
  const changeDotRef = createRef<Circle>();
  view.add(
    <Circle ref={changeDotRef} x={-90} y={200} width={22} height={22}
      fill={colors.change} opacity={0} />
  );
  const changeLabelRef = createRef<Txt>();
  view.add(
    <Txt ref={changeLabelRef} x={-90} y={228} text="Deploys"
      fill={colors.change} fontFamily="JetBrains Mono" fontSize={14} opacity={0} />
  );

  // Error logs
  const logDotRef = createRef<Circle>();
  view.add(
    <Circle ref={logDotRef} x={-15} y={200} width={22} height={22}
      fill={colors.logs} opacity={0} />
  );
  const logLabelRef = createRef<Txt>();
  view.add(
    <Txt ref={logLabelRef} x={-15} y={228} text="Logs"
      fill={colors.logs} fontFamily="JetBrains Mono" fontSize={14} opacity={0} />
  );

  // Metrics signal — from Prometheus
  const metricsDotRef = createRef<Circle>();
  view.add(
    <Circle ref={metricsDotRef} x={55} y={200} width={22} height={22}
      fill={colors.metrics} opacity={0} />
  );
  const metricsLabelRef = createRef<Txt>();
  view.add(
    <Txt ref={metricsLabelRef} x={55} y={228} text="Metrics"
      fill={colors.metrics} fontFamily="JetBrains Mono" fontSize={14} opacity={0} />
  );

  // ============================================
  // ENRICHED PULSE (exits Sitrep)
  // ============================================

  const pulseRef = createRef<Circle>();
  view.add(
    <Circle ref={pulseRef} x={-60} y={50} width={20} height={20}
      fill={colors.pulse} opacity={0} />
  );

  const contextRingRef = createRef<Circle>();
  view.add(
    <Circle ref={contextRingRef} x={-60} y={50} width={34} height={34}
      fill={null} stroke={colors.pulse} lineWidth={2} opacity={0} />
  );

  // ============================================
  // LABELS
  // ============================================

  const labelTextRef = createRef<Txt>();
  view.add(
    <Txt
      ref={labelTextRef}
      x={160}
      y={-170}
      text=""
      fill={colors.text}
      fontFamily="JetBrains Mono"
      fontSize={18}
      opacity={0}
    />
  );

  // Helper: fade out label, swap text, fade in — makes transitions noticeable
  function* swapLabel(newText: string, fadeOut = 0.3, fadeIn = 0.4) {
    yield* labelTextRef().opacity(0, fadeOut);
    labelTextRef().text(newText);
    yield* labelTextRef().opacity(1, fadeIn);
  }

  // ============================================
  // ANIMATION SEQUENCE
  // ============================================

  // ---- Phase 1: Problem Framing ----

  yield* all(
    ...scatterDots.map(dot => dot().opacity(0.7, 0.4)),
  );

  problemTextRef().text('Alerts fire. Metrics spike. A deploy just happened.');
  yield* problemTextRef().opacity(1, 0.5);
  yield* waitFor(2);

  problemSubRef().text('What\'s connected?');
  yield* problemSubRef().opacity(1, 0.4);
  yield* waitFor(1.5);

  yield* all(
    problemTextRef().opacity(0, 0.5),
    problemSubRef().opacity(0, 0.5),
    ...scatterDots.map(dot => dot().opacity(0, 0.4)),
  );
  yield* waitFor(0.5);

  problemTextRef().text('OpenSRM: Define, enforce, and measure reliability as code');
  yield* problemTextRef().opacity(1, 0.6);
  yield* waitFor(2.5);
  yield* problemTextRef().opacity(0, 0.5);
  yield* waitFor(0.5);

  // ---- Phase 2: Setup — Static Layer ----

  // Show persistent header
  yield* headerRef().opacity(1, 0.6);
  yield* waitFor(0.5);

  // Show layer labels
  yield* all(
    staticLabelRef().opacity(0.5, 0.4),
    agentLabelRef().opacity(0.5, 0.4),
    layerDividerRef().opacity(0.5, 0.4),
    layerDividerRef().end(1, 1),
  );

  // Show OpenSRM spec
  yield* opensrmRef().opacity(1, 0.6);
  labelTextRef().text('OpenSRM manifests define service reliability as code');
  yield* labelTextRef().opacity(1, 0.4);
  yield* waitFor(3);

  // OpenSRM → NthLayer
  yield* all(
    nthlayerRef().opacity(1, 0.6),
    specLineRef().opacity(1, 0.4),
    specLineRef().end(1, 0.8, easeOutCubic),
  );
  yield* swapLabel('NthLayer reads the manifest and generates monitoring automatically');
  yield* waitFor(3);

  // NthLayer → Artifacts
  yield* all(
    artifactsRef().opacity(1, 0.6),
    artifactLineRef().opacity(1, 0.4),
    artifactLineRef().end(1, 0.6),
  );
  yield* swapLabel('Output: alert rules, dashboards, and a map of service dependencies');
  yield* waitFor(3);

  // Show topology line crossing to agent layer
  yield* all(
    topologyLineRef().opacity(0.5, 0.4),
    topologyLineRef().end(1, 1, easeOutCubic),
    topologyLabelRef().opacity(0.5, 0.4),
  );
  yield* waitFor(0.8);

  // Dim static layer — infrastructure is deployed
  yield* all(
    opensrmRef().opacity(0.35, 0.6),
    nthlayerRef().opacity(0.35, 0.6),
    artifactsRef().opacity(0.25, 0.6),
    specLineRef().opacity(0.15, 0.6),
    artifactLineRef().opacity(0.15, 0.6),
  );

  // ---- Phase 3: Live Event — Agent Correlation ----

  yield* swapLabel('Now an incident happens...');
  yield* waitFor(2);

  // Show Sitrep agent
  yield* sitrepRef().opacity(1, 0.6);
  yield* waitFor(0.5);

  // Signal 1: Alert fires from Alertmanager
  yield* all(
    alertDotRef().opacity(1, 0.5),
    alertLabelRef().opacity(1, 0.5),
  );
  yield* swapLabel('An alert fires: payment-service latency exceeds its 200ms SLO');
  yield* waitFor(3);

  // Move alert dot up into Sitrep
  yield* all(
    alertDotRef().position([-60, 50], 0.8, easeInOutCubic),
    alertLabelRef().opacity(0, 0.5),
  );
  yield* all(
    alertDotRef().opacity(0, 0.3),
    sitrepRef().scale(1.06, 0.2),
  );
  yield* sitrepRef().scale(1, 0.2);
  yield* waitFor(0.3);

  // Signal 2: Deploy event from GitHub
  yield* all(
    changeDotRef().opacity(1, 0.5),
    changeLabelRef().opacity(1, 0.5),
  );
  yield* swapLabel('A deploy webhook arrives: auth-service v2.4.1 shipped 4 min ago');
  yield* waitFor(3);

  // Move change dot up into Sitrep
  yield* all(
    changeDotRef().position([-60, 50], 0.8, easeInOutCubic),
    changeLabelRef().opacity(0, 0.5),
  );
  yield* all(
    changeDotRef().opacity(0, 0.3),
    sitrepRef().scale(1.06, 0.2),
  );
  yield* sitrepRef().scale(1, 0.2);
  yield* waitFor(0.3);

  // Signal 3: Error logs
  yield* all(
    logDotRef().opacity(1, 0.5),
    logLabelRef().opacity(1, 0.5),
  );
  yield* swapLabel('Error logs spike: connection timeouts in checkout-service');
  yield* waitFor(2.5);

  // Move log dot up into Sitrep
  yield* all(
    logDotRef().position([-60, 50], 0.8, easeInOutCubic),
    logLabelRef().opacity(0, 0.5),
  );
  yield* all(
    logDotRef().opacity(0, 0.3),
    sitrepRef().scale(1.06, 0.2),
  );
  yield* sitrepRef().scale(1, 0.2);
  yield* waitFor(0.3);

  // Signal 4: Metrics spike from Prometheus
  yield* all(
    metricsDotRef().opacity(1, 0.5),
    metricsLabelRef().opacity(1, 0.5),
  );
  yield* swapLabel('Metrics confirm: p99 latency spiking across 3 downstream services');
  yield* waitFor(2.5);

  // Move metrics dot up into Sitrep
  yield* all(
    metricsDotRef().position([-60, 50], 0.8, easeInOutCubic),
    metricsLabelRef().opacity(0, 0.5),
  );
  yield* all(
    metricsDotRef().opacity(0, 0.3),
    sitrepRef().scale(1.06, 0.2),
  );
  yield* sitrepRef().scale(1, 0.2);
  yield* waitFor(0.3);

  // Sitrep correlates
  yield* swapLabel('Sitrep correlates: "deploy 4m ago likely caused the latency spike"');
  yield* waitFor(3.5);

  // Enriched snapshot emerges
  yield* all(
    pulseRef().opacity(1, 0.4),
    contextRingRef().opacity(1, 0.4),
  );
  yield* swapLabel('Snapshot created: alert + deploy + 3 related services + error logs');
  yield* waitFor(3);

  // ---- Phase 4: Mayday Responds ----

  yield* all(
    maydayRef().opacity(1, 0.5),
    flowLine2Ref().opacity(1, 0.4),
    flowLine2Ref().end(1, 0.5),
  );

  // Pulse moves to Mayday
  yield* all(
    pulseRef().position([210, 50], 1, easeInOutCubic),
    contextRingRef().position([210, 50], 1, easeInOutCubic),
    maydayRef().scale(1.05, 0.3),
  );
  yield* swapLabel('Mayday receives the snapshot and investigates root cause');
  yield* maydayRef().scale(1, 0.3);
  yield* waitFor(3);

  // Decision made — pulse turns green
  yield* all(
    pulseRef().fill(colors.success, 0.4),
    contextRingRef().stroke(colors.success, 0.4),
  );
  yield* swapLabel('Decision: rollback auth-service — 87% confident the deploy is the cause');
  yield* waitFor(3);

  // ---- Phase 5: Measure ----

  yield* all(
    telemetryRef().opacity(1, 0.5),
    flowLine3Ref().opacity(1, 0.4),
    flowLine3Ref().end(1, 0.5),
  );

  // Pulse moves to Telemetry
  yield* all(
    pulseRef().position([470, 50], 1, easeInOutCubic),
    contextRingRef().position([470, 50], 1, easeInOutCubic),
    telemetryRef().scale(1.05, 0.3),
  );
  yield* swapLabel('Every decision is recorded: what was decided, confidence, and outcome');
  yield* telemetryRef().scale(1, 0.3);
  yield* waitFor(3);

  // Show Judgment SLOs
  yield* all(
    judgmentRef().opacity(1, 0.5),
    judgmentLineRef().opacity(1, 0.4),
    judgmentLineRef().end(1, 0.6),
  );

  // Pulse moves down to Judgment SLOs
  yield* all(
    pulseRef().position([470, 210], 0.7, easeInOutCubic),
    contextRingRef().position([470, 210], 0.7, easeInOutCubic),
    pulseRef().scale(0.7, 0.7),
    contextRingRef().scale(0.7, 0.7),
    judgmentRef().scale(1.05, 0.3),
  );
  yield* swapLabel('96.8% of agent decisions stood — only 3.2% needed human correction');
  yield* judgmentRef().scale(1, 0.3);
  yield* waitFor(3);

  // ---- Phase 6: Arbiter + Feedback ----

  // Show Arbiter
  yield* all(
    arbiterRef().opacity(1, 0.5),
    arbiterLineRef().opacity(1, 0.4),
    arbiterLineRef().end(1, 0.6, easeOutCubic),
  );
  yield* swapLabel('Arbiter monitors decision quality — are the agents making good calls?');
  yield* waitFor(3);

  // Arbiter → Sitrep feedback
  yield* feedbackLineRef().opacity(1, 0.4);
  yield* feedbackLineRef().end(1, 1.2, easeInOutCubic);
  yield* swapLabel('Feedback: decision outcomes flow back to improve future correlation');
  yield* waitFor(2.5);

  // Arbiter → Mayday autonomy policy
  yield* arbiterToMaydayRef().opacity(0.5, 0.4);
  yield* arbiterToMaydayRef().end(1, 0.6, easeOutCubic);
  yield* swapLabel('Arbiter can reduce agent authority and autonomy, but never expand it');
  yield* waitFor(3.5);

  // ---- Phase 7: Summary — Closed Loop ----

  // Fade pulse
  yield* all(
    pulseRef().opacity(0, 0.6),
    contextRingRef().opacity(0, 0.6),
  );

  // Bring static layer back up
  yield* all(
    opensrmRef().opacity(0.7, 0.4),
    nthlayerRef().opacity(0.7, 0.4),
    artifactsRef().opacity(0.5, 0.4),
  );

  yield* swapLabel('OpenSRM is a closed-loop reliability platform');
  yield* waitFor(2.5);

  yield* swapLabel('Declare → Enforce → Correlate → Respond → Measure → Govern → repeat');
  yield* waitFor(3);

  yield* swapLabel('Every decision feeds back to improve the next one');
  yield* waitFor(3);

  // Fade out
  yield* labelTextRef().opacity(0, 0.6);
  yield* waitFor(1);
});

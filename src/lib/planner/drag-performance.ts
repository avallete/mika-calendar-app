type PlannerPerformanceLevel = "warn" | "slow" | "very-slow";

type PlannerPerformanceMetric = {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  slowCount: number;
  verySlowCount: number;
  lastPayload: Record<string, unknown> | null;
};

export type PlannerPerformanceSession = {
  id: string;
  label: string;
  startedAt: number;
  metadata: Record<string, unknown>;
  counters: Map<string, number>;
  metrics: Map<string, PlannerPerformanceMetric>;
  flushed: boolean;
  captureId: string | null;
  deferSummaryUntilExplicitEnd: boolean;
  result: Record<string, unknown>;
};

export type PlannerPerformanceStageSnapshot = PlannerPerformanceMetric & {
  stage: string;
  avgMs: number;
};

export type PlannerCaptureBrowserSummary = {
  preview: {
    fastMs: number;
    exactMs: number;
  };
  optimistic: {
    computeMs: number;
    computeInvocationCount: number;
  };
  render: {
    commitMs: number;
  };
  server: {
    awaitMs: number;
    reconcileMs: number;
  };
};

const WARN_THRESHOLD_MS = 8;
const SLOW_THRESHOLD_MS = 16;
const VERY_SLOW_THRESHOLD_MS = 50;

let plannerPerformanceSequence = 0;
let activePlannerPerformanceSession: PlannerPerformanceSession | null = null;

function getNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function roundDuration(value: number) {
  return Number(value.toFixed(2));
}

function classifyPlannerPerformance(durationMs: number): PlannerPerformanceLevel | null {
  if (durationMs >= VERY_SLOW_THRESHOLD_MS) {
    return "very-slow";
  }

  if (durationMs >= SLOW_THRESHOLD_MS) {
    return "slow";
  }

  if (durationMs >= WARN_THRESHOLD_MS) {
    return "warn";
  }

  return null;
}

function getMetric(
  session: PlannerPerformanceSession,
  stage: string
): PlannerPerformanceMetric {
  const existing = session.metrics.get(stage);
  if (existing) {
    return existing;
  }

  const nextMetric: PlannerPerformanceMetric = {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    slowCount: 0,
    verySlowCount: 0,
    lastPayload: null,
  };
  session.metrics.set(stage, nextMetric);
  return nextMetric;
}

function snapshotPlannerPerformanceMetrics(
  session: PlannerPerformanceSession
): PlannerPerformanceStageSnapshot[] {
  return [...session.metrics.entries()].map(([stage, metric]) => ({
    stage,
    count: metric.count,
    totalMs: roundDuration(metric.totalMs),
    avgMs: roundDuration(metric.totalMs / metric.count),
    maxMs: roundDuration(metric.maxMs),
    lastMs: roundDuration(metric.lastMs),
    slowCount: metric.slowCount,
    verySlowCount: metric.verySlowCount,
    lastPayload: metric.lastPayload,
  }));
}

function getMetricTotalByPredicate(
  stageMetrics: Array<Pick<PlannerPerformanceStageSnapshot, "stage" | "totalMs">>,
  predicate: (stage: string) => boolean
) {
  return roundDuration(
    stageMetrics
      .filter((metric) => predicate(metric.stage))
      .reduce((total, metric) => total + metric.totalMs, 0)
  );
}

export function buildPlannerCaptureBrowserSummaryFromMetrics(args: {
  stageMetrics: Array<Pick<PlannerPerformanceStageSnapshot, "stage" | "totalMs">>;
  counters: Record<string, number>;
}): PlannerCaptureBrowserSummary {
  return {
    preview: {
      fastMs: getMetricTotalByPredicate(
        args.stageMetrics,
        (stage) => stage === "drag.preview.fast"
      ),
      exactMs: getMetricTotalByPredicate(
        args.stageMetrics,
        (stage) =>
          stage === "drag.preview.exact.scheduler" ||
          stage === "drag.preview.exact.delta"
      ),
    },
    optimistic: {
      computeMs: getMetricTotalByPredicate(
        args.stageMetrics,
        (stage) => stage === "planner.client.optimistic.compute"
      ),
      computeInvocationCount:
        args.counters["planner.client.optimistic.compute.invocations"] ?? 0,
    },
    render: {
      commitMs: getMetricTotalByPredicate(
        args.stageMetrics,
        (stage) => stage.startsWith("timeline.")
      ),
    },
    server: {
      awaitMs: getMetricTotalByPredicate(
        args.stageMetrics,
        (stage) => stage === "planner.client.serverAction.await"
      ),
      reconcileMs: getMetricTotalByPredicate(
        args.stageMetrics,
        (stage) => stage === "planner.client.serverAction.reconcile"
      ),
    },
  };
}

export function buildPlannerCaptureBrowserSummary(
  session: PlannerPerformanceSession
): PlannerCaptureBrowserSummary {
  return buildPlannerCaptureBrowserSummaryFromMetrics({
    stageMetrics: snapshotPlannerPerformanceMetrics(session),
    counters: Object.fromEntries(session.counters.entries()),
  });
}

function logSlowStage(
  session: PlannerPerformanceSession,
  stage: string,
  durationMs: number,
  level: PlannerPerformanceLevel,
  payload?: Record<string, unknown>
) {
  if (
    typeof console === "undefined" ||
    (level !== "slow" && level !== "very-slow")
  ) {
    return;
  }

  const prefix =
    level === "very-slow" ? "[planner perf][very-slow]" : "[planner perf][slow]";
  if (payload) {
    console.warn(
      `${prefix} ${session.label} ${stage} ${roundDuration(durationMs)}ms`,
      payload
    );
    return;
  }

  console.warn(
    `${prefix} ${session.label} ${stage} ${roundDuration(durationMs)}ms`
  );
}

function recordPlannerPerformanceMetric(
  stage: string,
  durationMs: number,
  payload?: Record<string, unknown>
) {
  const session = activePlannerPerformanceSession;
  if (!session) {
    return;
  }

  const metric = getMetric(session, stage);
  const level = classifyPlannerPerformance(durationMs);
  metric.count += 1;
  metric.totalMs += durationMs;
  metric.maxMs = Math.max(metric.maxMs, durationMs);
  metric.lastMs = durationMs;
  metric.lastPayload = payload ?? null;

  if (level === "slow") {
    metric.slowCount += 1;
  }

  if (level === "very-slow") {
    metric.verySlowCount += 1;
  }

  if (level) {
    logSlowStage(session, stage, durationMs, level, payload);
  }
}

export function startPlannerPerformanceSession(
  label: string,
  metadata: Record<string, unknown> = {}
): PlannerPerformanceSession {
  return {
    id: `planner-perf-${(plannerPerformanceSequence += 1)}`,
    label,
    startedAt: getNow(),
    metadata,
    counters: new Map<string, number>(),
    metrics: new Map<string, PlannerPerformanceMetric>(),
    flushed: false,
    captureId: typeof metadata.captureId === "string" ? metadata.captureId : null,
    deferSummaryUntilExplicitEnd: false,
    result: {},
  };
}

export function setActivePlannerPerformanceSession(
  session: PlannerPerformanceSession | null
) {
  activePlannerPerformanceSession = session;
}

export function clearActivePlannerPerformanceSession(
  session?: PlannerPerformanceSession | null
) {
  if (!session || activePlannerPerformanceSession?.id === session.id) {
    activePlannerPerformanceSession = null;
  }
}

export function incrementPlannerPerformanceCounter(
  counter: string,
  value = 1
) {
  const session = activePlannerPerformanceSession;
  if (!session) {
    return;
  }

  session.counters.set(counter, (session.counters.get(counter) ?? 0) + value);
}

export function measurePlannerPerformance<T>(
  stage: string,
  fn: () => T,
  payload?: Record<string, unknown>
): T {
  const session = activePlannerPerformanceSession;
  if (!session) {
    return fn();
  }

  const startedAt = getNow();

  try {
    return fn();
  } finally {
    recordPlannerPerformanceMetric(stage, getNow() - startedAt, payload);
  }
}

export async function measurePlannerPerformanceAsync<T>(
  stage: string,
  fn: () => Promise<T>,
  payload?: Record<string, unknown>
) {
  const session = activePlannerPerformanceSession;
  if (!session) {
    return fn();
  }

  const startedAt = getNow();

  try {
    return await fn();
  } finally {
    recordPlannerPerformanceMetric(stage, getNow() - startedAt, payload);
  }
}

export function recordPlannerProfilerRender(
  componentId: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number
) {
  recordPlannerPerformanceMetric(
    `timeline.reactCommit.${componentId}.${phase}`,
    actualDuration,
    {
      actualDurationMs: roundDuration(actualDuration),
      baseDurationMs: roundDuration(baseDuration),
    }
  );
}

function schedulePlannerPerformanceFlush(session: PlannerPerformanceSession) {
  const flush = () => {
    if (session.flushed) {
      clearActivePlannerPerformanceSession(session);
      return;
    }

    if (session.deferSummaryUntilExplicitEnd) {
      return;
    }

    session.flushed = true;
    const totalDurationMs = getNow() - session.startedAt;
    const counterRows = Object.fromEntries(session.counters.entries());
    const metricRows = snapshotPlannerPerformanceMetrics(session).sort(
      (left, right) => right.totalMs - left.totalMs
    );
    const browserSummary = buildPlannerCaptureBrowserSummary(session);

    if (typeof console !== "undefined") {
      console.groupCollapsed(
        `[planner perf] ${session.label} ${roundDuration(totalDurationMs)}ms`
      );

      if (Object.keys(session.metadata).length) {
        console.log("meta", session.metadata);
      }

      if (Object.keys(counterRows).length) {
        console.log("counters", counterRows);
      }

      if (metricRows.length) {
        if (typeof console.table === "function") {
          console.table(metricRows);
        } else {
          console.log("metrics", metricRows);
        }
      }

      if (Object.keys(session.result).length) {
        console.log("result", session.result);
      }

      console.groupEnd();

      if (session.captureId) {
        console.log("[planner capture] planner.capture.browser.summary", {
          ...session.metadata,
          ...session.result,
          browserSummary,
        });
        console.log("[planner capture] planner.capture.end", {
          ...session.metadata,
          ...session.result,
          browserSummary,
        });
      }
    }

    clearActivePlannerPerformanceSession(session);
  };

  if (typeof setTimeout === "function") {
    setTimeout(flush, 0);
    return;
  }

  flush();
}

export function schedulePlannerPerformanceSummary(
  session: PlannerPerformanceSession | null,
  payload: Record<string, unknown> = {},
  options?: {
    deferFlush?: boolean;
  }
) {
  if (!session) {
    return;
  }

  session.result = {
    ...session.result,
    ...payload,
  };
  session.deferSummaryUntilExplicitEnd = options?.deferFlush ?? false;
  if (session.deferSummaryUntilExplicitEnd) {
    return;
  }

  schedulePlannerPerformanceFlush(session);
}

export function completePlannerPerformanceCapture(
  captureId: string,
  payload: Record<string, unknown> = {}
) {
  const session = activePlannerPerformanceSession;
  if (!session || session.captureId !== captureId) {
    return;
  }

  session.deferSummaryUntilExplicitEnd = false;
  session.result = {
    ...session.result,
    ...payload,
  };
  schedulePlannerPerformanceFlush(session);
}

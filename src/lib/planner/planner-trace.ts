type PlannerProjectLike = {
  status?: string;
};

type PlannerHistoryLike = {
  canUndo?: boolean;
  canRedo?: boolean;
};

type PlannerSnapshotLike = {
  teams?: unknown[];
  holidaySources?: unknown[];
  projects?: PlannerProjectLike[];
  dependencies?: unknown[];
  closures?: unknown[];
  customClosures?: unknown[];
  history?: PlannerHistoryLike;
};

export type PlannerTraceContext = {
  traceId: string;
  source: string;
  parentTraceId?: string;
  captureId?: string;
  runtime?: PlannerTraceRuntime;
  phase?: PlannerTracePhase;
  metadata?: Record<string, unknown>;
};

export type PlannerTraceRuntime = "browser" | "server";

export type PlannerTracePhase =
  | "preview"
  | "optimistic"
  | "server-action"
  | "store"
  | "persistence"
  | "reconcile";

type PlannerTraceMetric = {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  lastPayload: Record<string, unknown> | null;
};

export type PlannerTraceStageMetricSnapshot = PlannerTraceMetric & {
  stage: string;
};

export type PlannerTraceHandle = {
  context: PlannerTraceContext;
  label: string;
  startedAt: number;
  finishedAt: number | null;
  finished: boolean;
  stageMetrics: Map<string, PlannerTraceMetric>;
};

export type PlannerTraceLike =
  | PlannerTraceHandle
  | PlannerTraceContext
  | null
  | undefined;

export type PlannerSnapshotSummary = {
  teamCount: number;
  holidaySourceCount: number;
  projectCount: number;
  scheduledProjectCount: number;
  draftProjectCount: number;
  dependencyCount: number;
  closureCount: number;
  customClosureCount: number;
  canUndo: boolean;
  canRedo: boolean;
  approxJsonBytes: number;
};

export type PlannerCaptureServerSummary = {
  action: {
    totalMs: number;
  };
  store: {
    transactionMs: number;
    writePersistentDeltaMs: number;
    replacePersistentStateMs: number;
    actionLogInsertMs: number;
  };
  persistence: {
    deleteRowsByTable: Record<string, number | null>;
    updateRowsByTable: Record<string, number | null>;
    insertRowsByTable: Record<string, number | null>;
  };
};

function getTraceNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function roundDuration(durationMs: number) {
  return Number(durationMs.toFixed(2));
}

function makeTraceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `planner-trace-${Math.random().toString(36).slice(2, 10)}`;
}

function detectPlannerTraceRuntime(): PlannerTraceRuntime {
  return typeof window === "undefined" ? "server" : "browser";
}

function logToConsole(
  method: "log" | "warn",
  label: string,
  payload?: Record<string, unknown>
) {
  if (typeof console === "undefined") {
    return;
  }

  if (payload) {
    console[method](label, payload);
    return;
  }

  console[method](label);
}

function getOrCreateTraceMetric(
  trace: PlannerTraceHandle,
  label: string
): PlannerTraceMetric {
  const existing = trace.stageMetrics.get(label);
  if (existing) {
    return existing;
  }

  const nextMetric: PlannerTraceMetric = {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    lastPayload: null,
  };
  trace.stageMetrics.set(label, nextMetric);
  return nextMetric;
}

function recordPlannerTraceMetric(
  trace: PlannerTraceHandle | null,
  label: string,
  durationMs: number,
  payload?: Record<string, unknown>
) {
  if (!trace || trace.finished) {
    return;
  }

  const metric = getOrCreateTraceMetric(trace, label);
  metric.count += 1;
  metric.totalMs += durationMs;
  metric.maxMs = Math.max(metric.maxMs, durationMs);
  metric.lastMs = durationMs;
  metric.lastPayload = payload ?? null;
}

function openTraceGroup(label: string) {
  if (typeof console === "undefined") {
    return;
  }

  if (typeof console.groupCollapsed === "function") {
    console.groupCollapsed(label);
    return;
  }

  console.log(label);
}

function closeTraceGroup() {
  if (typeof console === "undefined") {
    return;
  }

  if (typeof console.groupEnd === "function") {
    console.groupEnd();
  }
}

export function approximateJsonByteSize(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return 0;
    }

    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(serialized).length;
    }

    return serialized.length;
  } catch {
    return 0;
  }
}

export function summarizePlannerSnapshot(
  snapshot: PlannerSnapshotLike | null | undefined
): PlannerSnapshotSummary {
  const teams = snapshot?.teams ?? [];
  const holidaySources = snapshot?.holidaySources ?? [];
  const projects = snapshot?.projects ?? [];
  const dependencies = snapshot?.dependencies ?? [];
  const closures = snapshot?.closures ?? [];
  const customClosures = snapshot?.customClosures ?? [];
  const scheduledProjectCount = projects.filter(
    (project) => project?.status === "scheduled"
  ).length;
  const draftProjectCount = projects.filter(
    (project) => project?.status === "draft"
  ).length;

  return {
    teamCount: teams.length,
    holidaySourceCount: holidaySources.length,
    projectCount: projects.length,
    scheduledProjectCount,
    draftProjectCount,
    dependencyCount: dependencies.length,
    closureCount: closures.length || customClosures.length,
    customClosureCount: customClosures.length,
    canUndo: Boolean(snapshot?.history?.canUndo),
    canRedo: Boolean(snapshot?.history?.canRedo),
    approxJsonBytes: approximateJsonByteSize(snapshot),
  };
}

export function isPlannerServerTraceEnabled() {
  return (
    typeof process !== "undefined" &&
    process.env?.PLANNER_TRACE_SERVER === "1"
  );
}

export function normalizePlannerTraceSource(source: string) {
  if (source === "preview") {
    return source;
  }

  if (source.startsWith("drag-move")) {
    return "drag-move";
  }

  if (source.startsWith("drag-resize")) {
    return "drag-resize";
  }

  if (source.startsWith("draft-drop")) {
    return "draft-drop";
  }

  if (
    source.startsWith("sheet-edit") ||
    source.startsWith("project-save") ||
    source.startsWith("prompt-")
  ) {
    return "sheet-edit";
  }

  if (source.startsWith("undo")) {
    return "undo";
  }

  if (source.startsWith("redo")) {
    return "redo";
  }

  if (source.startsWith("reset")) {
    return "reset";
  }

  if (source.startsWith("load")) {
    return "load";
  }

  return source;
}

export function createPlannerTraceContext(args: {
  source: string;
  enabled?: boolean;
  traceId?: string;
  parentTraceId?: string;
  captureId?: string;
  runtime?: PlannerTraceRuntime;
  phase?: PlannerTracePhase;
  metadata?: Record<string, unknown>;
}): PlannerTraceContext | null {
  if (args.enabled === false) {
    return null;
  }

  const traceId = args.traceId ?? makeTraceId();

  return {
    traceId,
    source: normalizePlannerTraceSource(args.source),
    parentTraceId: args.parentTraceId,
    captureId: args.captureId ?? traceId,
    runtime: args.runtime ?? detectPlannerTraceRuntime(),
    phase: args.phase,
    metadata: args.metadata,
  };
}

export function extendPlannerTraceContext(
  context: PlannerTraceLike,
  overrides: {
    source?: string;
    traceId?: string;
    parentTraceId?: string;
    captureId?: string;
    runtime?: PlannerTraceRuntime;
    phase?: PlannerTracePhase;
    metadata?: Record<string, unknown>;
  }
): PlannerTraceContext | null {
  const resolvedContext = resolveTraceContext(context);
  if (!resolvedContext) {
    return null;
  }

  return {
    traceId: overrides.traceId ?? resolvedContext.traceId,
    source: overrides.source
      ? normalizePlannerTraceSource(overrides.source)
      : resolvedContext.source,
    parentTraceId: overrides.parentTraceId ?? resolvedContext.parentTraceId,
    captureId: overrides.captureId ?? resolvedContext.captureId,
    runtime: overrides.runtime ?? resolvedContext.runtime ?? detectPlannerTraceRuntime(),
    phase: overrides.phase ?? resolvedContext.phase,
    metadata: overrides.metadata
      ? {
          ...(resolvedContext.metadata ?? {}),
          ...overrides.metadata,
        }
      : resolvedContext.metadata,
  };
}

export function startPlannerTrace(
  label: string,
  context: PlannerTraceContext | null | undefined,
  payload?: Record<string, unknown>
) {
  if (!context) {
    return null;
  }

  openTraceGroup(`[planner trace] ${label} traceId=${context.traceId}`);
  logToConsole("log", "context", {
    traceId: context.traceId,
    captureId: context.captureId ?? context.traceId,
    source: context.source,
    parentTraceId: context.parentTraceId ?? null,
    runtime: context.runtime ?? detectPlannerTraceRuntime(),
    phase: context.phase ?? null,
    ...(context.metadata ? { metadata: context.metadata } : {}),
    ...(payload ? { payload } : {}),
  });

  return {
    context,
    label,
    startedAt: getTraceNow(),
    finishedAt: null,
    finished: false,
    stageMetrics: new Map<string, PlannerTraceMetric>(),
  } satisfies PlannerTraceHandle;
}

function resolveTraceContext(trace: PlannerTraceLike) {
  if (!trace) {
    return null;
  }

  return "context" in trace ? trace.context : trace;
}

function resolveTraceHandle(trace: PlannerTraceLike) {
  if (!trace || !("context" in trace)) {
    return null;
  }

  return trace;
}

function isFinishedTraceHandle(trace: PlannerTraceLike) {
  return Boolean(trace && "finished" in trace && trace.finished);
}

export function tracePlannerTraceStep(
  trace: PlannerTraceLike,
  label: string,
  payload?: Record<string, unknown>
) {
  if (!resolveTraceContext(trace) || isFinishedTraceHandle(trace)) {
    return;
  }

  logToConsole("log", label, payload);
}

export function measurePlannerTraceStep<T>(
  trace: PlannerTraceLike,
  label: string,
  fn: () => T,
  payload?: Record<string, unknown>
): T {
  if (!resolveTraceContext(trace) || isFinishedTraceHandle(trace)) {
    return fn();
  }

  const startedAt = getTraceNow();

  try {
    return fn();
  } finally {
    const durationMs = getTraceNow() - startedAt;
    recordPlannerTraceMetric(resolveTraceHandle(trace), label, durationMs, payload);
    logToConsole("log", `${label} ${roundDuration(durationMs)}ms`, payload);
  }
}

export async function measurePlannerTraceStepAsync<T>(
  trace: PlannerTraceLike,
  label: string,
  fn: () => Promise<T>,
  payload?: Record<string, unknown>
) {
  if (!resolveTraceContext(trace) || isFinishedTraceHandle(trace)) {
    return fn();
  }

  const startedAt = getTraceNow();

  try {
    return await fn();
  } finally {
    const durationMs = getTraceNow() - startedAt;
    recordPlannerTraceMetric(resolveTraceHandle(trace), label, durationMs, payload);
    logToConsole("log", `${label} ${roundDuration(durationMs)}ms`, payload);
  }
}

export function finishPlannerTrace(
  trace: PlannerTraceHandle | null,
  payload?: Record<string, unknown>
) {
  if (!trace || trace.finished) {
    return;
  }

  trace.finished = true;
  trace.finishedAt = getTraceNow();
  logToConsole(
    "log",
    `${trace.label}.complete ${roundDuration(trace.finishedAt - trace.startedAt)}ms`,
    payload
  );
  closeTraceGroup();
}

export function getPlannerTraceDurationMs(trace: PlannerTraceHandle | null) {
  if (!trace) {
    return 0;
  }

  const finishedAt = trace.finishedAt ?? getTraceNow();
  return roundDuration(finishedAt - trace.startedAt);
}

export function snapshotPlannerTraceStageMetrics(
  trace: PlannerTraceHandle | null
): PlannerTraceStageMetricSnapshot[] {
  if (!trace) {
    return [];
  }

  return [...trace.stageMetrics.entries()].map(([stage, metric]) => ({
    stage,
    count: metric.count,
    totalMs: roundDuration(metric.totalMs),
    maxMs: roundDuration(metric.maxMs),
    lastMs: roundDuration(metric.lastMs),
    lastPayload: metric.lastPayload,
  }));
}

function getStageTotalMs(
  stageMetrics: PlannerTraceStageMetricSnapshot[],
  stage: string
) {
  return roundDuration(
    stageMetrics
      .filter((metric) => metric.stage === stage)
      .reduce((total, metric) => total + metric.totalMs, 0)
  );
}

function buildRowCountSummary(
  stageMetrics: PlannerTraceStageMetricSnapshot[],
  prefix: string
) {
  return Object.fromEntries(
    stageMetrics
      .filter((metric) => metric.stage.startsWith(prefix))
      .map((metric) => [
        metric.stage.slice(prefix.length),
        typeof metric.lastPayload?.rowCount === "number" ||
        metric.lastPayload?.rowCount === null
          ? (metric.lastPayload.rowCount as number | null)
          : null,
      ])
  );
}

export function buildPlannerCaptureServerSummaryFromMetrics(args: {
  actionTotalMs: number;
  stageMetrics: PlannerTraceStageMetricSnapshot[];
}): PlannerCaptureServerSummary {
  return {
    action: {
      totalMs: roundDuration(args.actionTotalMs),
    },
    store: {
      transactionMs: getStageTotalMs(
        args.stageMetrics,
        "planner.store.commit.transaction"
      ),
      writePersistentDeltaMs: getStageTotalMs(
        args.stageMetrics,
        "planner.store.commit.writePersistentDelta"
      ),
      replacePersistentStateMs: getStageTotalMs(
        args.stageMetrics,
        "planner.store.commit.replacePersistentState"
      ),
      actionLogInsertMs: getStageTotalMs(
        args.stageMetrics,
        "planner.store.commit.insertActionLog"
      ),
    },
    persistence: {
      deleteRowsByTable: buildRowCountSummary(
        args.stageMetrics,
        "planner.persistence.delete."
      ),
      updateRowsByTable: buildRowCountSummary(
        args.stageMetrics,
        "planner.persistence.update."
      ),
      insertRowsByTable: buildRowCountSummary(
        args.stageMetrics,
        "planner.persistence.insert."
      ),
    },
  };
}

export function buildPlannerCaptureServerSummary(
  trace: PlannerTraceHandle | null
): PlannerCaptureServerSummary {
  return buildPlannerCaptureServerSummaryFromMetrics({
    actionTotalMs: getPlannerTraceDurationMs(trace),
    stageMetrics: snapshotPlannerTraceStageMetrics(trace),
  });
}

export function logPlannerCaptureEvent(
  label: string,
  payload: Record<string, unknown>,
  context?: PlannerTraceLike
) {
  if (typeof console === "undefined") {
    return;
  }

  console.log(
    `[planner capture] ${label}`,
    addPlannerTraceContextFields(context, payload)
  );
}

export function addPlannerTraceContextFields(
  context: PlannerTraceLike,
  payload: Record<string, unknown> = {}
) {
  const resolvedContext = resolveTraceContext(context);
  if (!resolvedContext) {
    return payload;
  }

  return {
    traceId: resolvedContext.traceId,
    captureId: resolvedContext.captureId ?? resolvedContext.traceId,
    traceSource: resolvedContext.source,
    parentTraceId: resolvedContext.parentTraceId ?? null,
    runtime: resolvedContext.runtime ?? detectPlannerTraceRuntime(),
    phase: resolvedContext.phase ?? null,
    ...payload,
  };
}

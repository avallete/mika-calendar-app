export type PlannerPerfProbeCounter =
  | "spanComputeCalls"
  | "seededUnaffectedProjectCount"
  | "reusedSpanCount"
  | "changedProjectCount"
  | "changedSectionCount"
  | "timelineProjectionRebuildSectionCount"
  | "fullRescheduleCallCount"
  | "loadHydrateCallCount";

export type PlannerPerfProbe = {
  counts: Record<PlannerPerfProbeCounter, number>;
};

const PERF_COUNTERS: PlannerPerfProbeCounter[] = [
  "spanComputeCalls",
  "seededUnaffectedProjectCount",
  "reusedSpanCount",
  "changedProjectCount",
  "changedSectionCount",
  "timelineProjectionRebuildSectionCount",
  "fullRescheduleCallCount",
  "loadHydrateCallCount",
];

let activePlannerPerfProbe: PlannerPerfProbe | null = null;

function createEmptyCounts(): Record<PlannerPerfProbeCounter, number> {
  return {
    spanComputeCalls: 0,
    seededUnaffectedProjectCount: 0,
    reusedSpanCount: 0,
    changedProjectCount: 0,
    changedSectionCount: 0,
    timelineProjectionRebuildSectionCount: 0,
    fullRescheduleCallCount: 0,
    loadHydrateCallCount: 0,
  };
}

export function createPlannerPerfProbe(): PlannerPerfProbe {
  return {
    counts: createEmptyCounts(),
  };
}

export function resetPlannerPerfProbe(probe: PlannerPerfProbe) {
  probe.counts = createEmptyCounts();
}

export function getActivePlannerPerfProbe() {
  return activePlannerPerfProbe;
}

export function recordPlannerPerfProbeCount(
  counter: PlannerPerfProbeCounter,
  value = 1,
  probe: PlannerPerfProbe | null = activePlannerPerfProbe
) {
  if (!probe || value === 0) {
    return;
  }

  probe.counts[counter] += value;
}

export function withPlannerPerfProbe<T>(probe: PlannerPerfProbe, fn: () => T) {
  const previousProbe = activePlannerPerfProbe;
  activePlannerPerfProbe = probe;

  try {
    return fn();
  } finally {
    activePlannerPerfProbe = previousProbe;
  }
}

export async function withPlannerPerfProbeAsync<T>(
  probe: PlannerPerfProbe,
  fn: () => Promise<T>
) {
  const previousProbe = activePlannerPerfProbe;
  activePlannerPerfProbe = probe;

  try {
    return await fn();
  } finally {
    activePlannerPerfProbe = previousProbe;
  }
}

export function snapshotPlannerPerfProbe(probe: PlannerPerfProbe) {
  return Object.fromEntries(
    PERF_COUNTERS.map((counter) => [counter, probe.counts[counter]])
  ) as Record<PlannerPerfProbeCounter, number>;
}

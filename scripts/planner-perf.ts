import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { closeDb, ensureDbReady, getDb } from "@/db/client";
import { makeSlotKey } from "@/lib/planner/calendar";
import {
  createPlannerPerfProbe,
  snapshotPlannerPerfProbe,
  withPlannerPerfProbe,
  withPlannerPerfProbeAsync,
} from "@/lib/planner/planner-perf";
import { primePlannerComputedSnapshot } from "@/lib/planner/planner-computed";
import { plannerStateToPersistentState, replacePersistentState } from "@/lib/planner/persistence";
import { buildPlannerFixtureState, type PlannerFixturePreset } from "@/lib/planner/sample-data";
import { previewProjectPlacements } from "@/lib/planner/scheduler";
import { placeProjectInState } from "@/lib/planner/state-mutations";
import { loadPlannerSnapshot } from "@/lib/planner/store";

type BenchmarkBudget = {
  medianMs: number;
  maxMs: number;
};

type BenchmarkScenario = {
  name: string;
  budget: BenchmarkBudget;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  run: () => Promise<Record<string, number>>;
};

type BenchmarkResult = {
  name: string;
  budget: BenchmarkBudget;
  timingsMs: {
    median: number;
    p95: number;
    max: number;
  };
  probe: Record<string, number>;
  pass: boolean;
};

const WARMUP_RUNS = 1;
const MEASURED_RUNS = 5;

function getDraftPlacement(projectId: string, teamId: string) {
  return {
    projectId,
    placement: {
      teamId,
      startSlot: makeSlotKey("2026-10-20", "PM"),
      durationHalfDays: 7,
    },
  };
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  );
  return sorted[index] ?? 0;
}

function averageCounters(records: Record<string, number>[]) {
  if (!records.length) {
    return {};
  }

  const counters = new Map<string, number>();

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      counters.set(key, (counters.get(key) ?? 0) + value);
    }
  }

  return Object.fromEntries(
    [...counters.entries()].map(([key, value]) => [key, round(value / records.length)])
  );
}

async function measureScenario(scenario: BenchmarkScenario): Promise<BenchmarkResult> {
  const timings: number[] = [];
  const probeSnapshots: Record<string, number>[] = [];

  if (scenario.setup) {
    await scenario.setup();
  }

  try {
    for (let runIndex = 0; runIndex < WARMUP_RUNS + MEASURED_RUNS; runIndex += 1) {
      const startedAt = performance.now();
      const probeSnapshot = await scenario.run();
      const durationMs = performance.now() - startedAt;

      if (runIndex < WARMUP_RUNS) {
        continue;
      }

      timings.push(durationMs);
      probeSnapshots.push(probeSnapshot);
    }
  } finally {
    if (scenario.teardown) {
      await scenario.teardown();
    }
  }

  const result: BenchmarkResult = {
    name: scenario.name,
    budget: scenario.budget,
    timingsMs: {
      median: round(median(timings)),
      p95: round(percentile(timings, 0.95)),
      max: round(Math.max(...timings)),
    },
    probe: averageCounters(probeSnapshots),
    pass: false,
  };

  result.pass =
    result.timingsMs.median <= scenario.budget.medianMs &&
    result.timingsMs.max < scenario.budget.maxMs;

  return result;
}

async function createLoadScenario(
  preset: PlannerFixturePreset,
  budget: BenchmarkBudget
): Promise<BenchmarkScenario> {
  const fixedNow = new Date(2026, 2, 25, 12);
  const fixture = buildPlannerFixtureState({
    preset,
    now: fixedNow,
  });
  const tempDir = mkdtempSync(path.join(tmpdir(), `app-calendar-mika-planner-perf-${preset}-`));

  return {
    name: `${preset}.load`,
    budget,
    setup: async () => {
      process.env.PGLITE_DATA_DIR = tempDir;
      await closeDb();
      await ensureDbReady();
      await replacePersistentState(
        getDb(),
        plannerStateToPersistentState(fixture)
      );
    },
    teardown: async () => {
      await closeDb();
      delete process.env.PGLITE_DATA_DIR;
      rmSync(tempDir, { recursive: true, force: true });
    },
    run: async () =>
      {
        const probe = createPlannerPerfProbe();
        await withPlannerPerfProbeAsync(probe, () =>
          loadPlannerSnapshot(`planner-perf-${preset}-load`)
        );
        return snapshotPlannerPerfProbe(probe);
      },
  };
}

function createInMemoryScenarios(
  preset: PlannerFixturePreset,
  budgets: {
    previewExact: BenchmarkBudget;
    optimisticDraftDrop: BenchmarkBudget;
  }
): BenchmarkScenario[] {
  const fixedNow = new Date(2026, 2, 25, 12);
  const fixture = buildPlannerFixtureState({
    preset,
    now: fixedNow,
  });
  primePlannerComputedSnapshot(fixture);

  const draftProject = fixture.projects.find((project) => project.status === "draft");
  if (!draftProject) {
    throw new Error(`Expected a draft project in the ${preset} fixture.`);
  }

  const placementRequest = getDraftPlacement(draftProject.id, draftProject.plannedTeam);

  return [
    {
      name: `${preset}.preview-exact`,
      budget: budgets.previewExact,
      run: async () => {
        const probe = createPlannerPerfProbe();
        withPlannerPerfProbe(probe, () =>
          previewProjectPlacements(
            fixture,
            [placementRequest],
            {
              dependencyResolution: "preserve-dependencies",
            }
          )
        );
        return snapshotPlannerPerfProbe(probe);
      },
    },
    {
      name: `${preset}.optimistic-draft-drop`,
      budget: budgets.optimisticDraftDrop,
      run: async () => {
        const probe = createPlannerPerfProbe();
        withPlannerPerfProbe(probe, () =>
          placeProjectInState(fixture, draftProject.id, placementRequest.placement)
        );
        return snapshotPlannerPerfProbe(probe);
      },
    },
  ];
}

async function main() {
  const scenarios: BenchmarkScenario[] = [
    ...createInMemoryScenarios("demo", {
      previewExact: {
        medianMs: 100,
        maxMs: 1000,
      },
      optimisticDraftDrop: {
        medianMs: 100,
        maxMs: 1000,
      },
    }),
    await createLoadScenario("demo", {
      medianMs: 200,
      maxMs: 1000,
    }),
    ...createInMemoryScenarios("stress", {
      previewExact: {
        medianMs: 180,
        maxMs: 1000,
      },
      optimisticDraftDrop: {
        medianMs: 220,
        maxMs: 1000,
      },
    }),
    await createLoadScenario("stress", {
      medianMs: 350,
      maxMs: 1000,
    }),
  ];

  const results: BenchmarkResult[] = [];

  for (const scenario of scenarios) {
    results.push(await measureScenario(scenario));
  }

  const output = {
    measuredRuns: MEASURED_RUNS,
    warmupRuns: WARMUP_RUNS,
    scenarios: results,
  };

  console.log(JSON.stringify(output, null, 2));

  if (results.some((result) => !result.pass)) {
    process.exitCode = 1;
  }
}

await main();

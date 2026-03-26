import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { closeDb } from "@/db/client";
import { saveProjectAction } from "@/lib/planner/actions";
import { createPlannerTraceContext } from "@/lib/planner/planner-trace";
import { loadPlannerSnapshot, placeProject, saveProject } from "@/lib/planner/store";
import type { PlannerState } from "@/lib/planner/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await closeDb();
  delete process.env.PGLITE_DATA_DIR;
  delete process.env.PLANNER_TRACE_SERVER;

  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createTempPlannerDbDir() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "app-calendar-mika-store-trace-"));
  tempDirs.push(tempDir);
  process.env.PGLITE_DATA_DIR = tempDir;
  return tempDir;
}

function normalizeSnapshotForComparison(snapshot: PlannerState): PlannerState {
  const projectIdMap = new Map<string, string>();

  const projects = snapshot.projects.map((project, index) => {
    const normalizedId = `project-${index + 1}`;
    projectIdMap.set(project.id, normalizedId);

    return {
      ...project,
      id: normalizedId,
    };
  });

  const dependencies = snapshot.dependencies.map((dependency, index) => ({
    ...dependency,
    id: `dependency-${index + 1}`,
    predecessorProjectId:
      projectIdMap.get(dependency.predecessorProjectId) ?? dependency.predecessorProjectId,
    successorProjectId:
      projectIdMap.get(dependency.successorProjectId) ?? dependency.successorProjectId,
  }));

  return {
    ...snapshot,
    projects,
    dependencies,
  };
}

async function runLoadSnapshotScenario(withTrace: boolean) {
  createTempPlannerDbDir();
  await closeDb();

  return loadPlannerSnapshot(
    "store-trace-load",
    withTrace
      ? createPlannerTraceContext({
          source: "load",
          enabled: true,
          traceId: "store-trace-load",
        })
      : null
  );
}

async function runSaveProjectScenario(withTrace: boolean) {
  createTempPlannerDbDir();
  await closeDb();

  const initialSnapshot = await loadPlannerSnapshot("store-trace-place");
  const plannedTeam = initialSnapshot.teams[0];

  expect(plannedTeam).toBeDefined();
  if (!plannedTeam) {
    throw new Error("Expected at least one team in the planner state.");
  }

  return saveProject(
    "store-trace-place",
    {
      title: "Projet de diagnostic trace",
      plannedTeam: plannedTeam.id,
      estimatedDurationHalfDays: 6,
      targetDateHint: "2026-10-14",
      notes: "Mutation tracee",
      dependencyIds: [],
    },
    undefined,
    withTrace
      ? createPlannerTraceContext({
          source: "sheet-edit",
          enabled: true,
          traceId: "store-trace-place",
        })
      : null
  );
}

describe("planner store tracing", () => {
  test("traced loadPlannerSnapshot returns the same snapshot as the untraced path", async () => {
    const withoutTrace = await runLoadSnapshotScenario(false);
    const withTrace = await runLoadSnapshotScenario(true);

    expect(withTrace).toEqual(withoutTrace);
  });

  test("traced saveProject returns the same snapshot as the untraced path", async () => {
    const withoutTrace = await runSaveProjectScenario(false);
    const withTrace = await runSaveProjectScenario(true);

    expect(normalizeSnapshotForComparison(withTrace)).toEqual(
      normalizeSnapshotForComparison(withoutTrace)
    );
  });

  test("saveProjectAction keeps captureId across server action, store, and persistence logs", async () => {
    createTempPlannerDbDir();
    await closeDb();
    process.env.PLANNER_TRACE_SERVER = "1";

    const initialSnapshot = await loadPlannerSnapshot("store-trace-action");
    const plannedTeam = initialSnapshot.teams[0];

    expect(plannedTeam).toBeDefined();
    if (!plannedTeam) {
      throw new Error("Expected at least one team in the planner state.");
    }

    const consoleCalls: unknown[][] = [];
    const originalConsoleLog = console.log;
    const originalConsoleGroupCollapsed = console.groupCollapsed;
    const originalConsoleGroupEnd = console.groupEnd;

    console.log = ((...args: unknown[]) => {
      consoleCalls.push(args);
    }) as typeof console.log;
    console.groupCollapsed = ((...args: unknown[]) => {
      consoleCalls.push(args);
    }) as typeof console.groupCollapsed;
    console.groupEnd = (() => {}) as typeof console.groupEnd;

    try {
      await saveProjectAction(
        "store-trace-action",
        {
          title: "Projet capture action",
          plannedTeam: plannedTeam.id,
          estimatedDurationHalfDays: 4,
          targetDateHint: "2026-10-20",
          notes: "Propagation captureId",
          dependencyIds: [],
        },
        undefined,
        createPlannerTraceContext({
          source: "sheet-edit",
          enabled: true,
          traceId: "trace-save-action",
          captureId: "capture-save-action",
          runtime: "browser",
          phase: "server-action",
        })
      );
    } finally {
      console.log = originalConsoleLog;
      console.groupCollapsed = originalConsoleGroupCollapsed;
      console.groupEnd = originalConsoleGroupEnd;
    }

    const captureStartPayload = consoleCalls.find(
      (args) =>
        typeof args[0] === "string" &&
        String(args[0]).includes("[planner capture] planner.capture.start") &&
        typeof args[1] === "object" &&
        args[1] !== null &&
        (args[1] as Record<string, unknown>).captureId === "capture-save-action"
    )?.[1] as Record<string, unknown> | undefined;

    const persistenceInsertPayload = consoleCalls.find(
      (args) =>
        typeof args[0] === "string" &&
        String(args[0]).startsWith("planner.persistence.insert.projects") &&
        typeof args[1] === "object" &&
        args[1] !== null &&
        (args[1] as Record<string, unknown>).captureId === "capture-save-action"
    )?.[1] as Record<string, unknown> | undefined;

    const captureSummaryPayload = consoleCalls.find(
      (args) =>
        typeof args[0] === "string" &&
        String(args[0]).includes("[planner capture] planner.capture.server.summary") &&
        typeof args[1] === "object" &&
        args[1] !== null &&
        (args[1] as Record<string, unknown>).captureId === "capture-save-action"
    )?.[1] as Record<string, unknown> | undefined;

    expect(captureStartPayload).toMatchObject({
      traceId: "trace-save-action",
      captureId: "capture-save-action",
      runtime: "server",
      phase: "store",
    });
    expect(persistenceInsertPayload).toMatchObject({
      traceId: "trace-save-action",
      captureId: "capture-save-action",
      runtime: "server",
      phase: "persistence",
    });
    expect(captureSummaryPayload).toMatchObject({
      traceId: "trace-save-action",
      captureId: "capture-save-action",
      runtime: "server",
      phase: "store",
    });
    expect(captureSummaryPayload?.summary).toBeDefined();
  });

  test("traced loadPlannerSnapshot skips canonical reschedule on the hot path", async () => {
    createTempPlannerDbDir();
    await closeDb();
    process.env.PLANNER_TRACE_SERVER = "1";

    const consoleCalls: unknown[][] = [];
    const originalConsoleLog = console.log;
    const originalConsoleGroupCollapsed = console.groupCollapsed;
    const originalConsoleGroupEnd = console.groupEnd;

    console.log = ((...args: unknown[]) => {
      consoleCalls.push(args);
    }) as typeof console.log;
    console.groupCollapsed = ((...args: unknown[]) => {
      consoleCalls.push(args);
    }) as typeof console.groupCollapsed;
    console.groupEnd = (() => {}) as typeof console.groupEnd;

    try {
      await loadPlannerSnapshot(
        "store-trace-load-hot-path",
        createPlannerTraceContext({
          source: "load",
          enabled: true,
          traceId: "trace-load-hot-path",
          captureId: "capture-load-hot-path",
          runtime: "server",
          phase: "store",
        })
      );
    } finally {
      console.log = originalConsoleLog;
      console.groupCollapsed = originalConsoleGroupCollapsed;
      console.groupEnd = originalConsoleGroupEnd;
    }

    expect(
      consoleCalls.some(
        (args) =>
          typeof args[0] === "string" &&
          String(args[0]).startsWith("planner.store.load.hydrateSnapshot.materialize")
      )
    ).toBe(true);
    expect(
      consoleCalls.some(
        (args) =>
          typeof args[0] === "string" &&
          String(args[0]).includes("planner.store.load.normalizeSnapshot.reschedule")
      )
    ).toBe(false);
  });

  test("project placement commits use delta persistence instead of full replace", async () => {
    createTempPlannerDbDir();
    await closeDb();
    process.env.PLANNER_TRACE_SERVER = "1";

    const initialSnapshot = await loadPlannerSnapshot("store-trace-place-delta");
    const plannedTeam = initialSnapshot.teams[0];

    expect(plannedTeam).toBeDefined();
    if (!plannedTeam) {
      throw new Error("Expected at least one team in the planner state.");
    }

    const savedSnapshot = await saveProject(
      "store-trace-place-delta",
      {
        title: "Projet delta placement",
        plannedTeam: plannedTeam.id,
        estimatedDurationHalfDays: 4,
        targetDateHint: "2026-10-08",
        notes: "Preparation delta placement",
        dependencyIds: [],
      }
    );
    const projectToPlace = savedSnapshot.projects.find(
      (project) => project.title === "Projet delta placement"
    );

    expect(projectToPlace).toBeDefined();
    if (!projectToPlace) {
      throw new Error("Expected the saved project to be available for placement.");
    }

    const consoleCalls: unknown[][] = [];
    const originalConsoleLog = console.log;
    const originalConsoleGroupCollapsed = console.groupCollapsed;
    const originalConsoleGroupEnd = console.groupEnd;

    console.log = ((...args: unknown[]) => {
      consoleCalls.push(args);
    }) as typeof console.log;
    console.groupCollapsed = ((...args: unknown[]) => {
      consoleCalls.push(args);
    }) as typeof console.groupCollapsed;
    console.groupEnd = (() => {}) as typeof console.groupEnd;

    try {
      await placeProject(
        "store-trace-place-delta",
        projectToPlace.id,
        {
          teamId: plannedTeam.id,
          startSlot: "2026-10-08-AM",
          durationHalfDays: projectToPlace.estimatedDurationHalfDays,
        },
        {
          source: "drag-move",
        },
        createPlannerTraceContext({
          source: "drag-move",
          enabled: true,
          traceId: "trace-place-delta",
          captureId: "capture-place-delta",
          runtime: "server",
          phase: "store",
        })
      );
    } finally {
      console.log = originalConsoleLog;
      console.groupCollapsed = originalConsoleGroupCollapsed;
      console.groupEnd = originalConsoleGroupEnd;
    }

    expect(
      consoleCalls.some(
        (args) =>
          typeof args[0] === "string" &&
          String(args[0]).startsWith("planner.store.commit.writePersistentDelta")
      )
    ).toBe(true);
    expect(
      consoleCalls.some(
        (args) =>
          typeof args[0] === "string" &&
          String(args[0]).startsWith("planner.store.commit.replacePersistentState")
      )
    ).toBe(false);
  });
});

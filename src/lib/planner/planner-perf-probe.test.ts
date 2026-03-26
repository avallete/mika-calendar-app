import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { closeDb, ensureDbReady, getDb } from "@/db/client";
import { makeSlotKey } from "@/lib/planner/calendar";
import { buildExactPlannerDragPreview } from "@/lib/planner/drag-preview";
import {
  createPlannerPerfProbe,
  snapshotPlannerPerfProbe,
  withPlannerPerfProbe,
  withPlannerPerfProbeAsync,
} from "@/lib/planner/planner-perf";
import { primePlannerComputedSnapshot } from "@/lib/planner/planner-computed";
import { plannerStateToPersistentState, replacePersistentState } from "@/lib/planner/persistence";
import { placeProjectInState } from "@/lib/planner/state-mutations";
import { buildPlannerDemoState } from "@/lib/planner/sample-data";
import { previewProjectPlacements } from "@/lib/planner/scheduler";
import { loadPlannerSnapshot } from "@/lib/planner/store";
import { isScheduledProject } from "@/lib/planner/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await closeDb();
  delete process.env.PGLITE_DATA_DIR;

  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createTempPlannerDbDir() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "app-calendar-mika-perf-probe-"));
  tempDirs.push(tempDir);
  process.env.PGLITE_DATA_DIR = tempDir;
  return tempDir;
}

function getDraftDropPlacement(projectId: string) {
  return {
    projectId,
    placement: {
      teamId: "33333333-3333-4333-8333-333333333333",
      startSlot: makeSlotKey("2026-10-20", "PM"),
      durationHalfDays: 7,
    },
  };
}

describe("planner perf probe", () => {
  test("preview placement reuses unaffected spans instead of reseeding them", () => {
    const state = buildPlannerDemoState(new Date(2026, 2, 25, 12));
    primePlannerComputedSnapshot(state);
    const draftProject = state.projects.find((project) => project.status === "draft");

    expect(draftProject).toBeDefined();
    if (!draftProject) {
      throw new Error("Expected a draft project in the demo fixture.");
    }

    const probe = createPlannerPerfProbe();
    const preview = withPlannerPerfProbe(probe, () =>
      previewProjectPlacements(
        state,
        [getDraftDropPlacement(draftProject.id)],
        {
          dependencyResolution: "preserve-dependencies",
        }
      )
    );
    const counts = snapshotPlannerPerfProbe(probe);

    expect(counts.seededUnaffectedProjectCount).toBe(0);
    expect(counts.reusedSpanCount).toBeGreaterThan(0);
    expect(counts.changedProjectCount).toBe(preview.changedProjectIds.length);
    expect(counts.changedSectionCount).toBe(preview.changedSectionIds.length);
  });

  test("exact drag preview delta uses cached spans without fresh span computations", () => {
    const state = buildPlannerDemoState(new Date(2026, 2, 25, 12));
    const currentComputed = primePlannerComputedSnapshot(state);
    const draftProject = state.projects.find((project) => project.status === "draft");

    expect(draftProject).toBeDefined();
    if (!draftProject) {
      throw new Error("Expected a draft project in the demo fixture.");
    }

    const preview = previewProjectPlacements(
      state,
      [getDraftDropPlacement(draftProject.id)],
      {
        dependencyResolution: "preserve-dependencies",
      }
    );
    const probe = createPlannerPerfProbe();

    withPlannerPerfProbe(probe, () =>
      buildExactPlannerDragPreview({
        signature: "probe-preview",
        currentProjects: state.projects,
        currentProjectSpanById: currentComputed.projectSpanById,
        previewProjects: preview.nextState.projects,
        previewProjectSpanById: preview.projectSpanById,
        changedProjectIds: preview.changedProjectIds,
        changedSectionIds: preview.changedSectionIds,
        closures: state.closures,
        primaryProjectId: draftProject.id,
      })
    );

    expect(snapshotPlannerPerfProbe(probe).spanComputeCalls).toBe(0);
  });

  test("placement mutation reuses cached unaffected spans on the hot path", () => {
    const state = buildPlannerDemoState(new Date(2026, 2, 25, 12));
    primePlannerComputedSnapshot(state);
    const draftProject = state.projects.find((project) => project.status === "draft");

    expect(draftProject).toBeDefined();
    if (!draftProject) {
      throw new Error("Expected a draft project in the demo fixture.");
    }

    const probe = createPlannerPerfProbe();
    const nextState = withPlannerPerfProbe(probe, () =>
      placeProjectInState(state, draftProject.id, {
        teamId: "33333333-3333-4333-8333-333333333333",
        startSlot: makeSlotKey("2026-10-20", "PM"),
        durationHalfDays: 7,
      })
    );
    const counts = snapshotPlannerPerfProbe(probe);

    expect(nextState.projects.find((project) => project.id === draftProject.id)?.status).toBe(
      "scheduled"
    );
    expect(counts.seededUnaffectedProjectCount).toBe(0);
    expect(counts.reusedSpanCount).toBeGreaterThan(0);
  });

  test("normal load hydrates once and skips the full rescheduler", async () => {
    createTempPlannerDbDir();
    await closeDb();
    const fixture = buildPlannerDemoState(new Date(2026, 2, 25, 12));
    await ensureDbReady();
    await replacePersistentState(getDb(), plannerStateToPersistentState(fixture));

    const probe = createPlannerPerfProbe();
    const snapshot = await withPlannerPerfProbeAsync(probe, () =>
      loadPlannerSnapshot("perf-probe-load")
    );
    const counts = snapshotPlannerPerfProbe(probe);

    expect(snapshot.projects.filter(isScheduledProject).length).toBeGreaterThan(0);
    expect(counts.loadHydrateCallCount).toBe(1);
    expect(counts.fullRescheduleCallCount).toBe(0);
  });
});

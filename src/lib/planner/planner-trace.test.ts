import { describe, expect, test } from "bun:test";

import {
  approximateJsonByteSize,
  buildPlannerCaptureServerSummaryFromMetrics,
  createPlannerTraceContext,
  extendPlannerTraceContext,
  measurePlannerTraceStep,
  measurePlannerTraceStepAsync,
  summarizePlannerSnapshot,
} from "@/lib/planner/planner-trace";

describe("planner trace helpers", () => {
  test("summarizePlannerSnapshot reports planner counts and approximate bytes", () => {
    const summary = summarizePlannerSnapshot({
      teams: [{ id: "team-1" }, { id: "team-2" }],
      holidaySources: [{ id: "holiday-1" }],
      projects: [
        { status: "scheduled" },
        { status: "draft" },
        { status: "scheduled" },
      ],
      dependencies: [{ id: "dep-1" }],
      closures: [{ id: "closure-1" }, { id: "closure-2" }],
      customClosures: [{ id: "custom-1" }],
      history: {
        canUndo: true,
        canRedo: false,
      },
    });

    expect(summary).toMatchObject({
      teamCount: 2,
      holidaySourceCount: 1,
      projectCount: 3,
      scheduledProjectCount: 2,
      draftProjectCount: 1,
      dependencyCount: 1,
      closureCount: 2,
      customClosureCount: 1,
      canUndo: true,
      canRedo: false,
    });
    expect(summary.approxJsonBytes).toBeGreaterThan(0);
  });

  test("approximateJsonByteSize counts serialized payload bytes", () => {
    expect(approximateJsonByteSize({ title: "abc" })).toBeGreaterThan(
      approximateJsonByteSize({ title: "a" })
    );
  });

  test("disabled trace contexts are no-op for sync and async measurement", async () => {
    const traceContext = createPlannerTraceContext({
      source: "load",
      enabled: false,
    });

    expect(traceContext).toBeNull();
    expect(
      measurePlannerTraceStep(traceContext, "planner.trace.sync", () => 42)
    ).toBe(42);
    await expect(
      measurePlannerTraceStepAsync(traceContext, "planner.trace.async", async () => 7)
    ).resolves.toBe(7);
  });

  test("createPlannerTraceContext defaults captureId to traceId", () => {
    const traceContext = createPlannerTraceContext({
      source: "sheet-edit",
      enabled: true,
      traceId: "trace-default-capture",
    });

    expect(traceContext).toMatchObject({
      traceId: "trace-default-capture",
      captureId: "trace-default-capture",
    });
  });

  test("extendPlannerTraceContext preserves capture fields while overriding runtime and phase", () => {
    const traceContext = createPlannerTraceContext({
      source: "drag-move",
      enabled: true,
      traceId: "trace-1",
      captureId: "capture-1",
      runtime: "browser",
      metadata: {
        selectionSize: 1,
      },
    });

    const nextContext = extendPlannerTraceContext(traceContext, {
      runtime: "server",
      phase: "store",
      metadata: {
        sessionId: "session-1",
      },
    });

    expect(nextContext).toMatchObject({
      traceId: "trace-1",
      captureId: "capture-1",
      runtime: "server",
      phase: "store",
      source: "drag-move",
      metadata: {
        selectionSize: 1,
        sessionId: "session-1",
      },
    });
  });

  test("buildPlannerCaptureServerSummaryFromMetrics buckets store and persistence stages", () => {
    const summary = buildPlannerCaptureServerSummaryFromMetrics({
      actionTotalMs: 123.4,
      stageMetrics: [
        {
          stage: "planner.store.commit.transaction",
          count: 1,
          totalMs: 80,
          maxMs: 80,
          lastMs: 80,
          lastPayload: null,
        },
        {
          stage: "planner.store.commit.replacePersistentState",
          count: 1,
          totalMs: 20,
          maxMs: 20,
          lastMs: 20,
          lastPayload: null,
        },
        {
          stage: "planner.store.commit.insertActionLog",
          count: 1,
          totalMs: 5,
          maxMs: 5,
          lastMs: 5,
          lastPayload: null,
        },
        {
          stage: "planner.persistence.delete.projects",
          count: 1,
          totalMs: 3,
          maxMs: 3,
          lastMs: 3,
          lastPayload: {
            rowCount: 200,
          },
        },
        {
          stage: "planner.persistence.insert.projects",
          count: 1,
          totalMs: 7,
          maxMs: 7,
          lastMs: 7,
          lastPayload: {
            rowCount: 200,
          },
        },
      ],
    });

    expect(summary).toEqual({
      action: {
        totalMs: 123.4,
      },
      store: {
        transactionMs: 80,
        writePersistentDeltaMs: 0,
        replacePersistentStateMs: 20,
        actionLogInsertMs: 5,
      },
      persistence: {
        deleteRowsByTable: {
          projects: 200,
        },
        updateRowsByTable: {},
        insertRowsByTable: {
          projects: 200,
        },
      },
    });
  });
});

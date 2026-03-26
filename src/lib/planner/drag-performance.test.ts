import { describe, expect, test } from "bun:test";

import { buildPlannerCaptureBrowserSummaryFromMetrics } from "@/lib/planner/drag-performance";

describe("planner drag performance capture summary", () => {
  test("buckets preview, optimistic, render, and server stages", () => {
    const summary = buildPlannerCaptureBrowserSummaryFromMetrics({
      stageMetrics: [
        { stage: "drag.preview.fast", totalMs: 25 },
        { stage: "drag.preview.exact.scheduler", totalMs: 120 },
        { stage: "drag.preview.exact.delta", totalMs: 30 },
        { stage: "planner.client.optimistic.compute", totalMs: 200 },
        { stage: "timeline.reactCommit.TimelineCanvas.update", totalMs: 75 },
        { stage: "timeline.static.render", totalMs: 40 },
        { stage: "planner.client.serverAction.await", totalMs: 900 },
        { stage: "planner.client.serverAction.reconcile", totalMs: 12 },
      ],
      counters: {
        "planner.client.optimistic.compute.invocations": 2,
      },
    });

    expect(summary).toEqual({
      preview: {
        fastMs: 25,
        exactMs: 150,
      },
      optimistic: {
        computeMs: 200,
        computeInvocationCount: 2,
      },
      render: {
        commitMs: 115,
      },
      server: {
        awaitMs: 900,
        reconcileMs: 12,
      },
    });
  });
});

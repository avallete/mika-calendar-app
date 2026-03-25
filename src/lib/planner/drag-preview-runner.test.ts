import { describe, expect, test } from "bun:test";

import {
  createPlannerExactPreviewRunnerState,
  finishPlannerExactPreviewRunnerWork,
  isPlannerExactPreviewResultStale,
  queuePlannerExactPreviewRunnerWork,
  settlePlannerExactPreviewRunnerAfterPaint,
  startPlannerExactPreviewRunnerWork,
} from "@/lib/planner/drag-preview-runner";

type TestWork = {
  signature: string;
  dueAt: number;
};

describe("drag preview runner", () => {
  test("replaces scheduled work when a newer signature arrives before execution", () => {
    let state = createPlannerExactPreviewRunnerState<TestWork>();

    const firstTransition = queuePlannerExactPreviewRunnerWork(
      state,
      {
        signature: "sig-a",
        dueAt: 120,
      },
      0
    );
    state = firstTransition.nextState;

    const replacementTransition = queuePlannerExactPreviewRunnerWork(
      state,
      {
        signature: "sig-b",
        dueAt: 180,
      },
      30
    );

    expect(replacementTransition.counter).toBe("drag.preview.exact.replaced");
    expect(replacementTransition.nextState.phase).toBe("scheduled");
    expect(replacementTransition.nextState.scheduledWork?.signature).toBe("sig-b");
    expect(replacementTransition.delayMs).toBe(150);
  });

  test("keeps only the latest queued signature while one exact run is active", () => {
    let state = createPlannerExactPreviewRunnerState<TestWork>();

    state = queuePlannerExactPreviewRunnerWork(
      state,
      {
        signature: "sig-a",
        dueAt: 20,
      },
      0
    ).nextState;

    const started = startPlannerExactPreviewRunnerWork(state);
    state = started.nextState;

    const queuedOnce = queuePlannerExactPreviewRunnerWork(
      state,
      {
        signature: "sig-b",
        dueAt: 90,
      },
      40
    );
    state = queuedOnce.nextState;

    const queuedTwice = queuePlannerExactPreviewRunnerWork(
      state,
      {
        signature: "sig-c",
        dueAt: 130,
      },
      70
    );
    state = queuedTwice.nextState;

    expect(queuedOnce.counter).toBe("drag.preview.exact.running-skip");
    expect(queuedTwice.counter).toBe("drag.preview.exact.running-skip");
    expect(state.phase).toBe("running");
    expect(state.queuedWork?.signature).toBe("sig-c");

    state = finishPlannerExactPreviewRunnerWork(state);

    const settled = settlePlannerExactPreviewRunnerAfterPaint(state, 100);
    expect(settled.nextState.phase).toBe("scheduled");
    expect(settled.nextState.scheduledWork?.signature).toBe("sig-c");
    expect(settled.delayMs).toBe(30);
  });

  test("marks stale results when drag identity, signature, or generation changed", () => {
    expect(
      isPlannerExactPreviewResultStale({
        expectedDragId: "drag-1",
        expectedSignature: "sig-a",
        runGeneration: 2,
        currentDragId: "drag-1",
        currentSignature: "sig-a",
        currentGeneration: 2,
      })
    ).toBe(false);

    expect(
      isPlannerExactPreviewResultStale({
        expectedDragId: "drag-1",
        expectedSignature: "sig-a",
        runGeneration: 2,
        currentDragId: "drag-2",
        currentSignature: "sig-a",
        currentGeneration: 2,
      })
    ).toBe(true);

    expect(
      isPlannerExactPreviewResultStale({
        expectedDragId: "drag-1",
        expectedSignature: "sig-a",
        runGeneration: 2,
        currentDragId: "drag-1",
        currentSignature: "sig-b",
        currentGeneration: 2,
      })
    ).toBe(true);

    expect(
      isPlannerExactPreviewResultStale({
        expectedDragId: "drag-1",
        expectedSignature: "sig-a",
        runGeneration: 2,
        currentDragId: "drag-1",
        currentSignature: "sig-a",
        currentGeneration: 3,
      })
    ).toBe(true);
  });
});

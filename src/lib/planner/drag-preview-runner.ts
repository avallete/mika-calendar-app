export type PlannerExactPreviewRunnerPhase =
  | "idle"
  | "scheduled"
  | "running"
  | "post-publish-paint";

type PlannerExactPreviewRunnerWorkBase = {
  signature: string;
  dueAt: number;
};

export type PlannerExactPreviewRunnerState<
  TWork extends PlannerExactPreviewRunnerWorkBase,
> = {
  phase: PlannerExactPreviewRunnerPhase;
  scheduledWork: TWork | null;
  queuedWork: TWork | null;
  runningWork: TWork | null;
};

export type PlannerExactPreviewRunnerTransition<
  TWork extends PlannerExactPreviewRunnerWorkBase,
> = {
  nextState: PlannerExactPreviewRunnerState<TWork>;
  counter: "drag.preview.exact.replaced" | "drag.preview.exact.running-skip" | null;
  delayMs: number | null;
};

export function createPlannerExactPreviewRunnerState<
  TWork extends PlannerExactPreviewRunnerWorkBase,
>(): PlannerExactPreviewRunnerState<TWork> {
  return {
    phase: "idle",
    scheduledWork: null,
    queuedWork: null,
    runningWork: null,
  };
}

export function queuePlannerExactPreviewRunnerWork<
  TWork extends PlannerExactPreviewRunnerWorkBase,
>(
  state: PlannerExactPreviewRunnerState<TWork>,
  work: TWork,
  now: number
): PlannerExactPreviewRunnerTransition<TWork> {
  if (state.phase === "idle") {
    return {
      nextState: {
        phase: "scheduled",
        scheduledWork: work,
        queuedWork: null,
        runningWork: null,
      },
      counter: null,
      delayMs: Math.max(work.dueAt - now, 0),
    };
  }

  if (state.phase === "scheduled") {
    return {
      nextState: {
        ...state,
        scheduledWork: work,
      },
      counter:
        state.scheduledWork?.signature === work.signature
          ? null
          : "drag.preview.exact.replaced",
      delayMs: Math.max(work.dueAt - now, 0),
    };
  }

  return {
    nextState: {
      ...state,
      queuedWork: work,
    },
    counter:
      state.queuedWork?.signature === work.signature
        ? null
        : "drag.preview.exact.running-skip",
    delayMs: null,
  };
}

export function startPlannerExactPreviewRunnerWork<
  TWork extends PlannerExactPreviewRunnerWorkBase,
>(state: PlannerExactPreviewRunnerState<TWork>) {
  if (state.phase !== "scheduled" || !state.scheduledWork) {
    return {
      nextState: state,
      work: null,
    };
  }

  return {
    nextState: {
      phase: "running",
      scheduledWork: null,
      queuedWork: state.queuedWork,
      runningWork: state.scheduledWork,
    } satisfies PlannerExactPreviewRunnerState<TWork>,
    work: state.scheduledWork,
  };
}

export function finishPlannerExactPreviewRunnerWork<
  TWork extends PlannerExactPreviewRunnerWorkBase,
>(state: PlannerExactPreviewRunnerState<TWork>) {
  if (state.phase !== "running") {
    return state;
  }

  return {
    phase: "post-publish-paint",
    scheduledWork: null,
    queuedWork: state.queuedWork,
    runningWork: null,
  } satisfies PlannerExactPreviewRunnerState<TWork>;
}

export function settlePlannerExactPreviewRunnerAfterPaint<
  TWork extends PlannerExactPreviewRunnerWorkBase,
>(
  state: PlannerExactPreviewRunnerState<TWork>,
  now: number
) {
  if (state.phase !== "post-publish-paint") {
    return {
      nextState: state,
      delayMs: null,
    };
  }

  if (!state.queuedWork) {
    return {
      nextState: createPlannerExactPreviewRunnerState<TWork>(),
      delayMs: null,
    };
  }

  return {
    nextState: {
      phase: "scheduled",
      scheduledWork: state.queuedWork,
      queuedWork: null,
      runningWork: null,
    } satisfies PlannerExactPreviewRunnerState<TWork>,
    delayMs: Math.max(state.queuedWork.dueAt - now, 0),
  };
}

export function resetPlannerExactPreviewRunnerState<
  TWork extends PlannerExactPreviewRunnerWorkBase,
>() {
  return createPlannerExactPreviewRunnerState<TWork>();
}

export function isPlannerExactPreviewResultStale(args: {
  expectedDragId: string;
  expectedSignature: string;
  runGeneration: number;
  currentDragId: string | null;
  currentSignature: string | null;
  currentGeneration: number;
}) {
  return (
    args.expectedDragId !== args.currentDragId ||
    args.expectedSignature !== args.currentSignature ||
    args.runGeneration !== args.currentGeneration
  );
}

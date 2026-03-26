"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
} from "react";

import {
  createClosureAction,
  createTeamAction,
  deleteClosureAction,
  deleteProjectAction,
  deleteTeamAction,
  loadPlannerSnapshotAction,
  placeProjectAction,
  placeProjectsAction,
  redoPlannerActionAction,
  resetDemoDataAction,
  saveProjectAction,
  setHolidaySourceEnabledAction,
  undoPlannerActionAction,
  unscheduleProjectAction,
  updateTeamAction,
} from "@/lib/planner/actions";
import {
  completePlannerPerformanceCapture,
  incrementPlannerPerformanceCounter,
  measurePlannerPerformance,
  measurePlannerPerformanceAsync,
} from "@/lib/planner/drag-performance";
import { buildPlannerMetrics } from "@/lib/planner/scheduler";
import {
  placeProjectInState,
  placeProjectsInState,
} from "@/lib/planner/state-mutations";
import {
  createPlannerTraceContext,
  extendPlannerTraceContext,
  finishPlannerTrace,
  measurePlannerTraceStep,
  measurePlannerTraceStepAsync,
  startPlannerTrace,
  summarizePlannerSnapshot,
  type PlannerTraceContext,
} from "@/lib/planner/planner-trace";
import type {
  ClosureFormState,
  PlannerState,
  ProjectDeleteMode,
  ProjectEditorState,
  ProjectPlacement,
  ProjectPlacementOptions,
  ProjectPlacementRequest,
  TeamEditorState,
} from "@/lib/planner/types";
import {
  getDefaultPlannerViewportPreferences,
  readPlannerViewportPreferencesFromLocalStorage,
} from "@/lib/planner/viewport-preferences";

const SESSION_STORAGE_KEY = "planner-session-id";

function getOrCreateSessionId() {
  if (typeof window === "undefined") {
    return null;
  }

  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const nextSessionId = window.crypto.randomUUID();
  window.localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
  return nextSessionId;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest("input, textarea, [contenteditable='true'], [contenteditable='']")
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Une erreur inattendue est survenue.";
}

type PlannerContextValue = {
  state: PlannerState;
  metrics: ReturnType<typeof buildPlannerMetrics>;
  isPending: boolean;
  sessionId: string | null;
  upsertProject: (
    values: ProjectEditorState,
    projectId?: string,
    traceContext?: PlannerTraceContext | null
  ) => void;
  placeProject: (
    projectId: string,
    placement: ProjectPlacement,
    options?: ProjectPlacementOptions,
    traceContext?: PlannerTraceContext | null
  ) => void;
  placeProjects: (
    placements: ProjectPlacementRequest[],
    options?: ProjectPlacementOptions,
    traceContext?: PlannerTraceContext | null
  ) => void;
  unscheduleProject: (projectId: string, traceContext?: PlannerTraceContext | null) => void;
  deleteProject: (
    projectId: string,
    mode?: ProjectDeleteMode,
    traceContext?: PlannerTraceContext | null
  ) => void;
  addClosure: (values: ClosureFormState, traceContext?: PlannerTraceContext | null) => void;
  removeClosure: (closureId: string, traceContext?: PlannerTraceContext | null) => void;
  createTeam: (values: TeamEditorState, traceContext?: PlannerTraceContext | null) => void;
  updateTeam: (
    teamId: string,
    values: TeamEditorState,
    traceContext?: PlannerTraceContext | null
  ) => void;
  deleteTeam: (teamId: string, traceContext?: PlannerTraceContext | null) => void;
  setHolidaySourceEnabled: (
    sourceCode: string,
    enabled: boolean,
    traceContext?: PlannerTraceContext | null
  ) => void;
  resetDemoData: (traceContext?: PlannerTraceContext | null) => void;
  undo: (traceContext?: PlannerTraceContext | null) => void;
  redo: (traceContext?: PlannerTraceContext | null) => void;
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

function getClientTraceEnabled() {
  return readPlannerViewportPreferencesFromLocalStorage(
    getDefaultPlannerViewportPreferences()
  ).traceEnabled;
}

function resolveClientTraceContext(args: {
  source: string;
  traceContext?: PlannerTraceContext | null;
  metadata?: Record<string, unknown>;
}) {
  if (args.traceContext) {
    return extendPlannerTraceContext(args.traceContext, {
      runtime: "browser",
      metadata: args.metadata,
    });
  }

  return createPlannerTraceContext({
    source: args.source,
    enabled: getClientTraceEnabled(),
    runtime: "browser",
    metadata: args.metadata,
  });
}

export function PlannerProvider({
  children,
  initialState,
}: {
  children: React.ReactNode;
  initialState: PlannerState;
}) {
  const [state, setState] = useState(initialState);
  const [sessionId] = useState<string | null>(() => getOrCreateSessionId());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const traceContext = resolveClientTraceContext({
      source: "load",
      metadata: {
        phase: "clientReload",
        sessionId,
      },
    });
    const trace = startPlannerTrace("planner.load.clientReload", traceContext, {
      sessionId,
    });

    measurePlannerTraceStep(trace, "planner.client.transition.dispatch", () => {
      startTransition(() => {
        void measurePlannerTraceStepAsync(
          trace,
          "planner.client.serverAction.await",
          () => loadPlannerSnapshotAction(sessionId, traceContext),
          {
            sessionId,
          }
        )
          .then((snapshot: PlannerState) => {
            measurePlannerTraceStep(trace, "planner.client.serverAction.reconcile", () => {
              setState(snapshot);
            }, {
              snapshotSummary: summarizePlannerSnapshot(snapshot),
            });
            finishPlannerTrace(trace, {
              sessionId,
              snapshotSummary: summarizePlannerSnapshot(snapshot),
            });
          })
          .catch((error: unknown) => {
            finishPlannerTrace(trace, {
              sessionId,
              error: getErrorMessage(error),
            });
            window.alert(getErrorMessage(error));
          });
      });
    });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const modifierPressed = event.ctrlKey || event.metaKey;
      if (!modifierPressed || event.altKey || event.key.toLowerCase() !== "z") {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        const traceContext = resolveClientTraceContext({
          source: "redo",
          metadata: {
            sessionId,
            trigger: "keyboard",
          },
        });
        const trace = startPlannerTrace("planner.client.redo", traceContext, {
          sessionId,
          trigger: "keyboard",
        });
        measurePlannerTraceStep(trace, "planner.client.transition.dispatch", () => {
          startTransition(() => {
            void measurePlannerTraceStepAsync(
              trace,
              "planner.client.serverAction.await",
              () => redoPlannerActionAction(sessionId, traceContext),
              {
                sessionId,
                trigger: "keyboard",
              }
            )
              .then((snapshot: PlannerState) => {
                measurePlannerTraceStep(
                  trace,
                  "planner.client.serverAction.reconcile",
                  () => {
                    setState(snapshot);
                  },
                  {
                    snapshotSummary: summarizePlannerSnapshot(snapshot),
                  }
                );
                finishPlannerTrace(trace, {
                  sessionId,
                  trigger: "keyboard",
                  snapshotSummary: summarizePlannerSnapshot(snapshot),
                });
              })
              .catch((error: unknown) => {
                finishPlannerTrace(trace, {
                  sessionId,
                  trigger: "keyboard",
                  error: getErrorMessage(error),
                });
                window.alert(getErrorMessage(error));
              });
          });
        });
        return;
      }

      const traceContext = resolveClientTraceContext({
        source: "undo",
        metadata: {
          sessionId,
          trigger: "keyboard",
        },
      });
      const trace = startPlannerTrace("planner.client.undo", traceContext, {
        sessionId,
        trigger: "keyboard",
      });
      measurePlannerTraceStep(trace, "planner.client.transition.dispatch", () => {
        startTransition(() => {
          void measurePlannerTraceStepAsync(
            trace,
            "planner.client.serverAction.await",
            () => undoPlannerActionAction(sessionId, traceContext),
            {
              sessionId,
              trigger: "keyboard",
            }
          )
            .then((snapshot: PlannerState) => {
              measurePlannerTraceStep(
                trace,
                "planner.client.serverAction.reconcile",
                () => {
                  setState(snapshot);
                },
                {
                  snapshotSummary: summarizePlannerSnapshot(snapshot),
                }
              );
              finishPlannerTrace(trace, {
                sessionId,
                trigger: "keyboard",
                snapshotSummary: summarizePlannerSnapshot(snapshot),
              });
            })
            .catch((error: unknown) => {
              finishPlannerTrace(trace, {
                sessionId,
                trigger: "keyboard",
                error: getErrorMessage(error),
              });
              window.alert(getErrorMessage(error));
            });
        });
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sessionId]);

  const runMutation = (
    source: string,
    mutator: (
      session: string,
      traceContext?: PlannerTraceContext | null
    ) => Promise<PlannerState>,
    traceContextArg?: PlannerTraceContext | null
  ) => {
    if (!sessionId) {
      return;
    }

    const traceContext = resolveClientTraceContext({
      source,
      traceContext: traceContextArg,
      metadata: {
        sessionId,
      },
    });
    const browserTraceContext = extendPlannerTraceContext(traceContext, {
      phase: "server-action",
    });
    const actionTraceContext = extendPlannerTraceContext(traceContext, {
      phase: "server-action",
    });
    const trace = startPlannerTrace(`planner.client.${source}`, browserTraceContext, {
      sessionId,
    });

    measurePlannerTraceStep(trace, "planner.client.transition.dispatch", () => {
      startTransition(() => {
        void measurePlannerTraceStepAsync(
          trace,
          "planner.client.serverAction.await",
          () => mutator(sessionId, actionTraceContext),
          {
            sessionId,
          }
        )
          .then((snapshot: PlannerState) => {
            measurePlannerTraceStep(trace, "planner.client.serverAction.reconcile", () => {
              setState(snapshot);
            }, {
              snapshotSummary: summarizePlannerSnapshot(snapshot),
            });
            finishPlannerTrace(trace, {
              sessionId,
              snapshotSummary: summarizePlannerSnapshot(snapshot),
            });
          })
          .catch((error: unknown) => {
            finishPlannerTrace(trace, {
              sessionId,
              error: getErrorMessage(error),
            });
            window.alert(getErrorMessage(error));
          });
      });
    });
  };

  const runOptimisticPlacementMutation = (
    source: string,
    optimisticMutator: (
      current: PlannerState,
      traceContext?: PlannerTraceContext | null
    ) => PlannerState,
    mutator: (
      session: string,
      traceContext?: PlannerTraceContext | null
    ) => Promise<PlannerState>,
    traceContextArg?: PlannerTraceContext | null
  ) => {
    if (!sessionId) {
      return;
    }

    const traceContext = resolveClientTraceContext({
      source,
      traceContext: traceContextArg,
      metadata: {
        sessionId,
      },
    });
    const optimisticTraceContext = extendPlannerTraceContext(traceContext, {
      phase: "optimistic",
    });
    const actionTraceContext = extendPlannerTraceContext(traceContext, {
      phase: "server-action",
    });
    const trace = startPlannerTrace(`planner.client.${source}`, optimisticTraceContext, {
      sessionId,
    });
    let previousState: PlannerState | null = null;
    measurePlannerTraceStep(trace, "planner.client.optimistic.setState", () => {
      measurePlannerPerformance("planner.client.optimistic.setState", () => {
        setState((current) => {
          previousState = current;
          incrementPlannerPerformanceCounter(
            "planner.client.optimistic.compute.invocations"
          );
          return measurePlannerPerformance(
            "planner.client.optimistic.compute",
            () =>
              measurePlannerTraceStep(
                trace,
                "planner.client.optimistic.compute",
                () => optimisticMutator(current, optimisticTraceContext),
                {
                  currentSnapshotSummary: summarizePlannerSnapshot(current),
                }
              ),
            {
              currentSnapshotSummary: summarizePlannerSnapshot(current),
            }
          );
        });
      });
    });

    measurePlannerTraceStep(trace, "planner.client.transition.dispatch", () => {
      measurePlannerPerformance("planner.client.transition.dispatch", () => {
        startTransition(() => {
          void measurePlannerPerformanceAsync(
            "planner.client.serverAction.await",
            () =>
              measurePlannerTraceStepAsync(
                trace,
                "planner.client.serverAction.await",
                () => mutator(sessionId, actionTraceContext),
                {
                  sessionId,
                }
              ),
            {
              sessionId,
            }
          )
          .then((snapshot: PlannerState) => {
            measurePlannerPerformance(
              "planner.client.serverAction.reconcile",
              () =>
                measurePlannerTraceStep(
                  trace,
                  "planner.client.serverAction.reconcile",
                  () => {
                    setState(snapshot);
                  },
                  {
                    snapshotSummary: summarizePlannerSnapshot(snapshot),
                  }
                ),
              {
                snapshotSummary: summarizePlannerSnapshot(snapshot),
              }
            );
            finishPlannerTrace(trace, {
              sessionId,
              snapshotSummary: summarizePlannerSnapshot(snapshot),
            });
            if (optimisticTraceContext?.captureId) {
              completePlannerPerformanceCapture(optimisticTraceContext.captureId, {
                sessionId,
                snapshotSummary: summarizePlannerSnapshot(snapshot),
                outcome: "committed",
              });
            }
          })
          .catch((error: unknown) => {
            measurePlannerPerformance(
              "planner.client.serverAction.rollback",
              () =>
                measurePlannerTraceStep(
                  trace,
                  "planner.client.serverAction.rollback",
                  () => {
                    if (previousState) {
                      setState(previousState);
                    }
                  },
                  {
                    previousSnapshotSummary: previousState
                      ? summarizePlannerSnapshot(previousState)
                      : null,
                  }
                ),
              {
                previousSnapshotSummary: previousState
                  ? summarizePlannerSnapshot(previousState)
                  : null,
              }
            );
            finishPlannerTrace(trace, {
              sessionId,
              error: getErrorMessage(error),
            });
            if (optimisticTraceContext?.captureId) {
              completePlannerPerformanceCapture(optimisticTraceContext.captureId, {
                sessionId,
                error: getErrorMessage(error),
                outcome: "rolled-back",
                snapshotSummary: previousState
                  ? summarizePlannerSnapshot(previousState)
                  : null,
              });
            }
            window.alert(getErrorMessage(error));
          });
        });
      });
    });
  };

  const value: PlannerContextValue = {
    state,
    metrics: buildPlannerMetrics(state),
    isPending,
    sessionId,
    upsertProject(values, projectId, traceContext) {
      runMutation(
        "project-save",
        (session, actionTraceContext) =>
          saveProjectAction(session, values, projectId, actionTraceContext),
        traceContext
      );
    },
    placeProject(projectId, placement, options, traceContext) {
      runOptimisticPlacementMutation(
        options?.source ?? "sheet-edit",
        (current, optimisticTraceContext) =>
          placeProjectInState(
            current,
            projectId,
            placement,
            options,
            optimisticTraceContext
          ),
        (session, actionTraceContext) =>
          placeProjectAction(session, projectId, placement, options, actionTraceContext),
        traceContext
      );
    },
    placeProjects(placements, options, traceContext) {
      runOptimisticPlacementMutation(
        options?.source ?? "drag-move",
        (current, optimisticTraceContext) =>
          placeProjectsInState(current, placements, options, optimisticTraceContext),
        (session, actionTraceContext) =>
          placeProjectsAction(session, placements, options, actionTraceContext),
        traceContext
      );
    },
    unscheduleProject(projectId, traceContext) {
      runMutation(
        "sheet-edit",
        (session, actionTraceContext) =>
          unscheduleProjectAction(session, projectId, actionTraceContext),
        traceContext
      );
    },
    deleteProject(projectId, mode, traceContext) {
      runMutation(
        "sheet-edit",
        (session, actionTraceContext) =>
          deleteProjectAction(session, projectId, mode, actionTraceContext),
        traceContext
      );
    },
    addClosure(values, traceContext) {
      runMutation(
        "sheet-edit",
        (session, actionTraceContext) =>
          createClosureAction(session, values, actionTraceContext),
        traceContext
      );
    },
    removeClosure(closureId, traceContext) {
      runMutation(
        "sheet-edit",
        (session, actionTraceContext) =>
          deleteClosureAction(session, closureId, actionTraceContext),
        traceContext
      );
    },
    createTeam(values, traceContext) {
      runMutation(
        "sheet-edit",
        (session, actionTraceContext) =>
          createTeamAction(session, values, actionTraceContext),
        traceContext
      );
    },
    updateTeam(teamId, values, traceContext) {
      runMutation(
        "sheet-edit",
        (session, actionTraceContext) =>
          updateTeamAction(session, teamId, values, actionTraceContext),
        traceContext
      );
    },
    deleteTeam(teamId, traceContext) {
      runMutation(
        "sheet-edit",
        (session, actionTraceContext) =>
          deleteTeamAction(session, teamId, actionTraceContext),
        traceContext
      );
    },
    setHolidaySourceEnabled(sourceCode, enabled, traceContext) {
      runMutation(
        "sheet-edit",
        (session, actionTraceContext) =>
          setHolidaySourceEnabledAction(
            session,
            sourceCode,
            enabled,
            actionTraceContext
          ),
        traceContext
      );
    },
    resetDemoData(traceContext) {
      runMutation(
        "reset",
        (session, actionTraceContext) =>
          resetDemoDataAction(session, actionTraceContext),
        traceContext
      );
    },
    undo(traceContext) {
      runMutation(
        "undo",
        (session, actionTraceContext) =>
          undoPlannerActionAction(session, actionTraceContext),
        traceContext
      );
    },
    redo(traceContext) {
      runMutation(
        "redo",
        (session, actionTraceContext) =>
          redoPlannerActionAction(session, actionTraceContext),
        traceContext
      );
    },
  };

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner() {
  const context = useContext(PlannerContext);
  if (!context) {
    throw new Error("usePlanner must be used inside PlannerProvider.");
  }

  return context;
}
